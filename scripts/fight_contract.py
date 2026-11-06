#!/usr/bin/env python3
"""Independent read-only fight input contract; no upstream implementation is imported.

Field vocabulary follows the declared 1.1/1.2 delivery contract. Structural
checks do not establish choreography, reference observation, or media quality.
"""
import base64
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
from intake_storyboard import section_text

PROVIDER = 'xianxia-fight-director'
ADAPTER_VERSION = '0.6.0'
SCHEMA = 'PREVIS_FIGHT_ADAPTER_V1'
PROFILE = 'FIGHT_SELECTED_SCOPE_V1'
EPS = 1e-6
ACTORS = {'character', 'creature', 'manifestation'}
KINDS = ACTORS | {'scene', 'prop', 'formation'}
ROLES = {'design', 'assets', 'storyboard', 'keyframes', 'execution', 'review'}


class FightContractError(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise FightContractError(message)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'Duplicate JSON key: ' + key)
        result[key] = value
    return result


def _constant(value):
    raise FightContractError('Non-finite JSON constant: ' + value)


def read_json(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'),
                      object_pairs_hook=_pairs, parse_constant=_constant)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    """Portable canonical hash: sorted keys and IEEE754 numbers, including 1 == 1.0.

    This avoids Python/JavaScript decimal/exponent spelling differences. Source
    byte hashes remain separate and are never replaced with this identity.
    """
    def encode(item):
        if item is None:
            return 'null'
        if isinstance(item, bool):
            return 'true' if item else 'false'
        if isinstance(item, (int, float)):
            number = float(item)
            need(math.isfinite(number), 'Non-finite canonical number')
            return 'n' + struct.pack('>d', 0.0 if number == 0 else number).hex()
        if isinstance(item, str):
            return json.dumps(item, ensure_ascii=False, separators=(',', ':'))
        if isinstance(item, list):
            return '[' + ','.join(encode(v) for v in item) + ']'
        need(isinstance(item, dict), 'Cannot hash non-JSON value')
        return '{' + ','.join(encode(k) + ':' + encode(item[k]) for k in sorted(item)) + '}'
    return sha256(('FIGHT_CANONICAL_V1\n' + encode(value)).encode('utf-8'))


def fields(value, required, optional=(), at='project'):
    need(isinstance(value, dict), at + ': expected object')
    required, optional = set(required), set(optional)
    need(not required - value.keys(), at + ': missing fields ' + ', '.join(sorted(required - value.keys())))
    need(not value.keys() - required - optional, at + ': unknown fields ' + ', '.join(sorted(value.keys() - required - optional)))


def text(value, at):
    need(isinstance(value, str) and bool(value.strip()), at + ': expected nonempty text')
    try:
        value.encode('utf-8', 'strict')
    except UnicodeError as error:
        raise FightContractError(at + ': invalid Unicode') from error


def number(value, at):
    need(isinstance(value, (int, float)) and not isinstance(value, bool), at + ': expected finite number, not boolean')
    try:
        need(math.isfinite(value), at + ': expected finite number')
        need(abs(value) <= 9007199254740991, at + ': timing exceeds exact JavaScript numeric range; no rounded adaptation is permitted')
    except OverflowError as error:
        raise FightContractError(at + ': number overflows finite double') from error


def strings(value, at, nonempty=False, unique=False):
    need(isinstance(value, list) and (not nonempty or bool(value)), at + ': expected ' + ('nonempty ' if nonempty else '') + 'text array')
    for item in value:
        text(item, at)
    if unique:
        need(len(set(value)) == len(value), at + ': duplicate references')


def validate_project(project):
    """Validate both supported declared versions, rejecting unknown fields at every level."""
    base = 'schema_version title duration_sec aspect_ratio style assumptions constraints design assets scene beats shots segments keyframes'.split()
    fields(project, base, ('cost', 'knowledge', 'review'))
    version = project['schema_version']
    need(version in ('1.1', '1.2'), 'schema_version: only explicit 1.1 or 1.2 is supported')
    modern = version == '1.2'
    if not modern:
        need('cost' not in project and 'knowledge' not in project, '1.1 cannot contain 1.2 cost/knowledge fields')
    for key in ('title', 'aspect_ratio', 'style'):
        text(project[key], key)
    number(project['duration_sec'], 'duration_sec')
    duration = project['duration_sec']
    need(duration > 0, 'duration_sec: must be positive')
    for key in ('assumptions', 'constraints'):
        strings(project[key], key)
    fields(project['design'], ('goals', 'rules', 'turns', 'outcome'), ('viewing_tasks',), 'design')
    for key in ('goals', 'rules', 'turns', 'viewing_tasks'):
        if key in project['design']:
            strings(project['design'][key], 'design.' + key, True)
    text(project['design']['outcome'], 'design.outcome')
    if 'review' in project:
        review = project['review']
        fields(review, ('scope', 'fixed', 'pending', 'invalidated', 'verification'), ('media_observations',), 'review')
        for key in ('scope', 'verification'):
            text(review[key], 'review.' + key)
        for key in ('fixed', 'pending', 'invalidated'):
            strings(review[key], 'review.' + key)
        if 'media_observations' in review:
            need(isinstance(review['media_observations'], list), 'review.media_observations: expected array')
            for observation in review['media_observations']:
                fields(observation, ('source', 'kind', 'observation', 'limitations'), at='review.media_observations')
                for key, value in observation.items():
                    text(value, 'review.media_observations.' + key)
                need(observation['kind'] in ('image', 'video', 'audio'), 'review.media_observations.kind: unsupported')

    shapes = {
        'assets': ('id kind name anchors states image_prompt', 'reference'),
        'beats': ('id start end actors action response result requires', 'marks' if modern else ''),
        'shots': ('id start end beat_ids asset_ids opening_state camera effects sound end_state execution' + (' light risk' if modern else ''), 'fallback' if modern else ''),
        'segments': ('id shot_ids opening_state closing_state prompt_context', ''),
        'keyframes': ('id shot_id time_sec asset_ids state prompt' + (' role' if modern else ''), ''),
    }
    if modern:
        shapes['cost'] = ('id owner item from_beat irreversible consequence', '')
        if 'knowledge' in project:
            shapes['knowledge'] = ('id holder belief truth from_beat cue', 'resolved_by')
    identities, maps = set(), {}
    for group, (required, optional) in shapes.items():
        rows = project.get(group)
        need(isinstance(rows, list) and bool(rows), group + ': expected nonempty array')
        maps[group] = {}
        for row in rows:
            fields(row, required.split(), optional.split(), group)
            identity = row['id']
            text(identity, group + '.id')
            need(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', identity) is not None, group + '.id: invalid ID')
            need(identity not in identities, group + '.id: ID is not globally unique: ' + identity)
            identities.add(identity)
            maps[group][identity] = row
    fields(project['scene'], ('asset_id', 'geography') + (('attrition',) if modern else ()), at='scene')
    text(project['scene']['geography'], 'scene.geography')
    asset_map, beat_map, shot_map = maps['assets'], maps['beats'], maps['shots']

    def refs(values, table, at, allow_empty=False, actors=False):
        strings(values, at, not allow_empty, True)
        for identity in values:
            need(identity in table, at + ': unknown reference ' + identity)
            if actors:
                need(table[identity]['kind'] in ACTORS, at + ': expected character, creature or manifestation')

    def interval(row, at):
        for key in ('start', 'end'):
            number(row[key], at + '.' + key)
        need(0 <= row['start'] < row['end'] <= duration + EPS, at + ': invalid battle interval')

    for asset in project['assets']:
        need(asset['kind'] in KINDS, 'assets.kind: unsupported')
        for key in ('name', 'image_prompt'):
            text(asset[key], 'assets.' + key)
        strings(asset['anchors'], 'assets.anchors', True)
        strings(asset['states'], 'assets.states')
        if 'reference' in asset:
            fields(asset['reference'], ('source', 'control', 'keep', 'exclude'), at='assets.reference')
            for key, value in asset['reference'].items():
                text(value, 'assets.reference.' + key)
    refs([project['scene']['asset_id']], asset_map, 'scene.asset_id')
    need(asset_map[project['scene']['asset_id']]['kind'] == 'scene', 'scene.asset_id: expected scene asset')
    for beat in project['beats']:
        interval(beat, 'beats.' + beat['id'])
        refs(beat['actors'], asset_map, 'beats.actors', actors=True)
        refs(beat['requires'], beat_map, 'beats.requires', allow_empty=True)
        for key in ('action', 'response', 'result'):
            text(beat[key], 'beats.' + key)
        if 'marks' in beat:
            strings(beat['marks'], 'beats.marks', True, True)
            need(set(beat['marks']) <= {'pivotal', 'breath', 'adaptation'}, 'beats.marks: unsupported mark')
        for dependency in beat['requires']:
            need(dependency != beat['id'] and beat_map[dependency]['end'] <= beat['start'] + EPS, 'beats.requires: self or unfinished dependency')
    # Positive intervals and nonfuture completed prerequisites imply a DAG. Check
    # it explicitly too, so future contract changes cannot admit a recursion loop.
    completed, pending = set(), set(beat_map)
    while pending:
        ready = {identity for identity in pending if set(beat_map[identity]['requires']) <= completed}
        need(bool(ready), 'beats.requires: dependency cycle')
        completed.update(ready)
        pending.difference_update(ready)

    executable_texts = []
    coverage = {identity: [] for identity in beat_map}
    cursor, previous = 0, None
    for shot in project['shots']:
        interval(shot, 'shots.' + shot['id'])
        need(abs(shot['start'] - cursor) <= EPS, 'shots: gap, overlap or order mismatch')
        cursor = shot['end']
        refs(shot['asset_ids'], asset_map, 'shots.asset_ids')
        refs(shot['beat_ids'], beat_map, 'shots.beat_ids')
        for key in ('opening_state', 'end_state', 'camera', 'effects', 'sound') + (('light',) if modern else ()):
            text(shot[key], 'shots.' + key)
        if modern:
            need(shot['risk'] in ('low', 'high'), 'shots.risk: expected low or high')
            need(('fallback' in shot) == (shot['risk'] == 'high'), 'shots.fallback: required only for high risk')
            if 'fallback' in shot:
                executable_texts.append(shot['fallback'])
        execution = shot['execution']
        exec_keys = ('opening_state', 'end_state', 'camera', 'effects', 'sound') + (('light',) if modern else ())
        fields(execution, exec_keys + ('cues',), at='shots.execution')
        for key in exec_keys:
            text(execution[key], 'shots.execution.' + key)
            executable_texts.append(execution[key])
        cues = execution['cues']
        need(isinstance(cues, list) and bool(cues), 'execution.cues: expected nonempty array')
        cue_cursor = shot['start']
        for cue in cues:
            fields(cue, ('start', 'end', 'text'), at='execution.cues')
            number(cue['start'], 'cue.start')
            number(cue['end'], 'cue.end')
            text(cue['text'], 'cue.text')
            need(shot['start'] - EPS <= cue['start'] < cue['end'] <= shot['end'] + EPS, 'execution.cues: outside owning shot')
            need(abs(cue['start'] - cue_cursor) <= EPS, 'execution.cues: must cover shot continuously in order')
            cue_cursor = cue['end']
            executable_texts.append(cue['text'])
        need(abs(cue_cursor - shot['end']) <= EPS, 'execution.cues: missing shot end')
        if previous:
            need(previous['end_state'] == shot['opening_state'], 'shots: world states are not literally continuous')
            need(previous['execution']['end_state'] == execution['opening_state'], 'shots: execution states are not literally continuous')
        previous = shot
        for identity in shot['beat_ids']:
            beat = beat_map[identity]
            start, end = max(shot['start'], beat['start']), min(shot['end'], beat['end'])
            need(start < end, 'shots.beat_ids: beat has no positive overlap with shot')
            coverage[identity].append((start, end))
    need(abs(cursor - duration) <= EPS, 'shots: timeline does not cover battle duration')
    for identity, windows in coverage.items():
        edge = beat_map[identity]['start']
        for start, end in sorted(windows):
            need(start <= edge + EPS, 'beats: uncovered reference window for ' + identity)
            edge = max(edge, end)
        need(edge >= beat_map[identity]['end'] - EPS, 'beats: incomplete reference coverage for ' + identity)
    assigned = []
    for segment in project['segments']:
        refs(segment['shot_ids'], shot_map, 'segments.shot_ids')
        for key in ('opening_state', 'closing_state', 'prompt_context'):
            text(segment[key], 'segments.' + key)
        need(segment['opening_state'] == shot_map[segment['shot_ids'][0]]['opening_state'], 'segments.opening_state: differs from first shot')
        need(segment['closing_state'] == shot_map[segment['shot_ids'][-1]]['end_state'], 'segments.closing_state: differs from last shot')
        assigned.extend(segment['shot_ids'])
        executable_texts.append(segment['prompt_context'])
    need(assigned == [shot['id'] for shot in project['shots']], 'segments: each whole shot must be assigned exactly once in original order')
    frame_counts = {identity: 0 for identity in shot_map}
    for frame in project['keyframes']:
        refs([frame['shot_id']], shot_map, 'keyframes.shot_id')
        refs(frame['asset_ids'], asset_map, 'keyframes.asset_ids')
        shot = shot_map[frame['shot_id']]
        need(set(frame['asset_ids']) <= set(shot['asset_ids']), 'keyframes.asset_ids: asset not registered in owning shot')
        number(frame['time_sec'], 'keyframes.time_sec')
        need(shot['start'] - EPS <= frame['time_sec'] <= shot['end'] + EPS, 'keyframes.time_sec: outside closed owning-shot interval')
        for key in ('state', 'prompt'):
            text(frame[key], 'keyframes.' + key)
        if modern:
            need(frame['role'] in ('single', 'prep', 'contact', 'result', 'handoff'), 'keyframes.role: unsupported')
        frame_counts[frame['shot_id']] += 1
        executable_texts.append(frame['prompt'])
    need(all(frame_counts.values()), 'keyframes: every shot needs a frame')
    if modern:
        attrition = project['scene']['attrition']
        need(isinstance(attrition, list) and bool(attrition), 'scene.attrition: expected nonempty array')
        for row in attrition:
            fields(row, ('id', 'mark', 'from_beat', 'consequence'), at='scene.attrition')
            text(row['id'], 'scene.attrition.id')
            need(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', row['id']) is not None and row['id'] not in identities, 'scene.attrition.id: invalid or repeated global ID')
            identities.add(row['id'])
            for key in ('mark', 'consequence'):
                text(row[key], 'scene.attrition.' + key)
            refs([row['from_beat']], beat_map, 'scene.attrition.from_beat')
        for group in ('cost', 'knowledge'):
            for row in project.get(group, []):
                owner = 'owner' if group == 'cost' else 'holder'
                refs([row[owner]], asset_map, group + '.' + owner, actors=True)
                refs([row['from_beat']], beat_map, group + '.from_beat')
                for key in (('item', 'consequence') if group == 'cost' else ('belief', 'truth', 'cue')):
                    text(row[key], group + '.' + key)
                if group == 'cost':
                    need(isinstance(row['irreversible'], bool), 'cost.irreversible: expected boolean')
                else:
                    need(row['belief'] != row['truth'], 'knowledge: belief and truth must differ')
                    if 'resolved_by' in row:
                        refs([row['resolved_by']], beat_map, 'knowledge.resolved_by')
                        need(row['resolved_by'] != row['from_beat'] and beat_map[row['resolved_by']]['start'] >= beat_map[row['from_beat']]['start'] - EPS, 'knowledge.resolved_by: same or earlier than origin')
        marked = {mark: [beat for beat in project['beats'] if mark in beat.get('marks', [])] for mark in ('pivotal', 'breath', 'adaptation')}
        need(all(marked.values()), 'beats.marks: pivotal, breath and adaptation records are required for 1.2')
        for beat in marked['pivotal']:
            triple = []
            for role in ('prep', 'contact', 'result'):
                times = [frame['time_sec'] for frame in project['keyframes'] if frame['role'] == role and beat['start'] - EPS <= frame['time_sec'] <= beat['end'] + EPS]
                need(bool(times), 'keyframes: pivotal beat missing ' + role)
                triple.append(min(times))
            need(triple[0] < triple[1] < triple[2], 'keyframes: pivotal prep/contact/result times must increase')
        for beat in marked['breath']:
            need('pivotal' not in beat.get('marks', []) and not any(beat['start'] < other['end'] - EPS and other['start'] < beat['end'] - EPS for other in marked['pivotal']), 'beats: breath overlaps pivotal')
        need(all(beat['requires'] for beat in marked['adaptation']), 'beats: adaptation requires a completed prerequisite')
        for segment in project['segments'][:-1]:
            last = shot_map[segment['shot_ids'][-1]]
            frames = [frame for frame in project['keyframes'] if frame['role'] == 'handoff' and abs(frame['time_sec'] - last['end']) <= EPS]
            need(bool(frames) and all(frame['shot_id'] == last['id'] for frame in frames), 'keyframes: handoff belongs to preceding segment final shot at its closed endpoint')
        need(len(project['shots']) == 1 or len({shot['light'] for shot in project['shots']}) >= 2, 'shots.light: multi-shot battle requires differing light registration')
        earliest = min(beat['start'] for beat in marked['pivotal'])
        need(any(beat_map[row['from_beat']]['end'] <= earliest + EPS for row in attrition), 'scene.attrition: no mark formed before earliest pivotal beat')
        need(any(row['irreversible'] for row in project['cost']) and len({row['owner'] for row in project['cost']}) >= 2, 'cost: irreversible expenditure and at least two owners required')
    # Only reject timecode syntax in copyable text, never derive actions from it.
    for value in executable_texts:
        text(value, 'copyable text')
        need(re.search(r'[0-9]+(?:\.[0-9]+)?\s*秒|[0-9]+(?:[:：][0-9]{1,2}){1,2}(?:\.[0-9]+)?', value) is None, 'copyable text: numeric timecode must stay in numeric cue fields')
        need(not any(identity in value for identity in identities if len(identity) >= 4), 'copyable text: contains internal registered ID')
    return project


def select_project(project, segment_id):
    """Collect complete related records without splitting beats or applying future states."""
    segments = project['segments']
    found = [row for row in segments if row['id'] == segment_id]
    need(len(found) == 1, 'segment: unknown or ambiguous original segment ID ' + str(segment_id))
    segment = found[0]
    all_shots = {row['id']: row for row in project['shots']}
    all_beats = {row['id']: row for row in project['beats']}
    shots = [all_shots[identity] for identity in segment['shot_ids']]
    start, end = shots[0]['start'], shots[-1]['end']
    beat_ids = set()

    def include(identity):
        if identity not in beat_ids:
            beat_ids.add(identity)
            for dependency in all_beats[identity]['requires']:
                include(dependency)
    for shot in shots:
        for identity in shot['beat_ids']:
            include(identity)
    # Prior resource/terrain/information can persist offscreen. A textual contract
    # cannot prove them independent, so retain all records established before the
    # segment end. Future unreferenced records remain outside this scope.
    related = lambda row: row['from_beat'] in beat_ids or all_beats[row['from_beat']]['start'] < end
    cost = [row for row in project.get('cost', []) if related(row)]
    attrition = [row for row in project['scene'].get('attrition', []) if related(row)]
    knowledge = [row for row in project.get('knowledge', []) if related(row)]
    for row in cost + attrition + knowledge:
        include(row['from_beat'])
        if 'resolved_by' in row:
            include(row['resolved_by'])
    selected_shot_ids = set(segment['shot_ids'])
    boundary_frames = []
    boundaries = []
    index = segments.index(segment)
    for prior_index in (index - 1, index):
        if not 0 <= prior_index < len(segments) - 1:
            continue
        before, after = segments[prior_index:prior_index + 2]
        last, first = all_shots[before['shot_ids'][-1]], all_shots[after['shot_ids'][0]]
        frames = [row for row in project['keyframes'] if row.get('role') == 'handoff' and row['shot_id'] == last['id'] and abs(row['time_sec'] - last['end']) <= EPS]
        boundary_frames.extend(frames)
        boundaries.append({'from_unit_id': before['id'], 'to_unit_id': after['id'], 'from_shot_id': last['id'], 'to_shot_id': first['id'], 'battle_time_s': last['end'], 'world_state': last['end_state'], 'execution_state': last['execution']['end_state'], 'keyframes': frames})
    frame_ids = {row['id'] for row in boundary_frames}
    for frame in project['keyframes']:
        owning = all_shots[frame['shot_id']]
        if frame['shot_id'] in selected_shot_ids or any(identity in beat_ids and all_beats[identity]['start'] - EPS <= frame['time_sec'] <= all_beats[identity]['end'] + EPS for identity in owning['beat_ids']):
            frame_ids.add(frame['id'])
    frames = [row for row in project['keyframes'] if row['id'] in frame_ids]
    asset_ids = {project['scene']['asset_id']}
    for shot in shots:
        asset_ids.update(shot['asset_ids'])
    for identity in beat_ids:
        asset_ids.update(all_beats[identity]['actors'])
    for frame in frames:
        asset_ids.update(frame['asset_ids'])
    for row in cost:
        asset_ids.add(row['owner'])
    for row in knowledge:
        asset_ids.add(row['holder'])
    selection = {
        'schema_version': PROFILE,
        'source_schema_version': project['schema_version'],
        'battle': {key: project[key] for key in ('title', 'aspect_ratio', 'style', 'assumptions', 'constraints', 'design')},
        'segment': segment, 'shots': shots,
        'beats': [row for row in project['beats'] if row['id'] in beat_ids],
        'assets': [row for row in project['assets'] if row['id'] in asset_ids],
        'keyframes': frames,
        'scene': {key: value for key, value in project['scene'].items() if key != 'attrition'},
        'cost': cost, 'attrition': attrition, 'knowledge': knowledge,
        'states': {'world': {'opening_state': shots[0]['opening_state'], 'end_state': shots[-1]['end_state']}, 'execution': {'opening_state': shots[0]['execution']['opening_state'], 'end_state': shots[-1]['execution']['end_state']}, 'segment': {'opening_state': segment['opening_state'], 'closing_state': segment['closing_state']}},
        'transition_context': {'schema_version': 'PREVIS_FIGHT_BOUNDARY_CONTEXT_V1', 'unit_id': segment_id, 'boundaries': boundaries},
    }
    return copy.deepcopy(selection)


def mapped_budget(selection):
    shots = selection['shots']
    start, end = shots[0]['start'], shots[-1]['end']
    unit = {'id': selection['segment']['id'], 'battle_start_s': start, 'battle_end_s': end, 'duration_s': end - start}
    budget = {'time_basis': 'SEGMENT', 'duration_s': end - start, 'shots': [{'id': shot['id'], 'start_s': shot['start'] - start, 'end_s': shot['end'] - start, 'duration_s': shot['end'] - shot['start'], 'battle_start_s': shot['start'], 'battle_end_s': shot['end']} for shot in shots]}
    return unit, budget


def execution_master(selection):
    """Join exact upstream field values, not full beat definitions or inferred action."""
    fragments = [{'pointer': '/segments/@' + selection['segment']['id'] + '/prompt_context', 'text': selection['segment']['prompt_context']}]
    for shot in selection['shots']:
        prefix = '/shots/@' + shot['id'] + '/execution/'
        execution = shot['execution']
        fragments.append({'pointer': prefix + 'opening_state', 'text': execution['opening_state']})
        fragments.extend({'pointer': prefix + 'cues/' + str(index) + '/text', 'text': cue['text']} for index, cue in enumerate(execution['cues']))
        for key in ('camera', 'effects', 'light', 'sound', 'end_state'):
            if key in execution:
                fragments.append({'pointer': prefix + key, 'text': execution[key]})
    content = '\n\n'.join(row['text'] for row in fragments)
    return {'text': content, 'text_sha256': sha256(content.encode('utf-8')), 'origin': 'SELECTED_EXECUTION_FIELDS', 'fragments': fragments}


def asset_catalog(selection):
    rows = selection['assets']
    return {'assets': rows, 'actors': [row for row in rows if row['kind'] in ACTORS], **{name: [row for row in rows if row['kind'] == kind] for name, kind in (('characters', 'character'), ('creatures', 'creature'), ('manifestations', 'manifestation'), ('props', 'prop'), ('formations', 'formation'), ('scenes', 'scene'))}}


def validate_draft(draft):
    fields(draft, ('schema_version', 'project', 'segment_id', 'mapping', 'assumptions'), at='draft')
    need(draft['schema_version'] == 'PREVIS_FIGHT_DRAFT_V1', 'draft.schema_version: expected PREVIS_FIGHT_DRAFT_V1')
    text(draft['segment_id'], 'draft.segment_id')
    strings(draft['assumptions'], 'draft.assumptions')
    validate_project(draft['project'])
    mapping = draft['mapping']
    need(isinstance(mapping, list) and bool(mapping), 'draft.mapping: explicit human evidence mapping required')
    registered_roles = set()
    for row in mapping:
        fields(row, ('target', 'role', 'locator'), at='draft.mapping')
        for key, value in row.items():
            text(value, 'draft.mapping.' + key)
        need(row['role'] in ROLES, 'draft.mapping.role: unsupported six-part role')
        need(row['target'] == '/project' or row['target'].startswith('/project/'), 'draft.mapping.target: expected /project JSON pointer')
        current = draft
        try:
            for part in row['target'].split('/')[1:]:
                part = part.replace('~1', '/').replace('~0', '~')
                if isinstance(current, list):
                    need(re.fullmatch(r'0|[1-9][0-9]*', part) is not None, 'draft.mapping.target: noncanonical array index ' + part)
                    current = current[int(part)]
                else:
                    current = current[part]
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise FightContractError('draft.mapping.target: unresolved explicit pointer ' + row['target']) from error
        registered_roles.add(row['role'])
    need(registered_roles == ROLES, 'draft.mapping: all six evidence roles need explicit locators')
    select_project(draft['project'], draft['segment_id'])
    return draft


def provenance(skill_dir=None):
    result = {'schema_version': 'PREVIS_UPSTREAM_PROVENANCE_V1', 'skill_name': PROVIDER, 'skill_version': 'UNKNOWN', 'git_commit': 'UNKNOWN', 'documents': [], 'scope': 'PACKAGE_EVIDENCE_ONLY'}
    if skill_dir is None:
        return result
    directory = Path(skill_dir).resolve()
    entry = directory / 'SKILL.md'
    need(entry.is_file(), '--upstream-skill-dir: actual SKILL.md is missing')
    content = entry.read_text(encoding='utf-8-sig')
    need(re.search(r'(?m)^name:\s*xianxia-fight-director\s*$', content) is not None, '--upstream-skill-dir: package does not name xianxia-fight-director')
    result['directory'] = directory.as_posix()
    docs = [entry, directory / 'README.md', directory / 'references/delivery-contract.md', directory / 'scripts/combat_plan.py']
    result['documents'] = [{'path': file.relative_to(directory).as_posix(), 'sha256': sha256(file.read_bytes())} for file in docs if file.is_file()]
    readme = directory / 'README.md'
    if readme.is_file():
        heading = readme.read_text(encoding='utf-8-sig').splitlines()[0]
        match = re.search(r'\bv(\d+(?:\.\d+)+)\b', heading)
        if match:
            result['skill_version'] = match[1]
    try:
        command = ['git', '-C', str(directory)]
        root = Path(subprocess.run(command + ['rev-parse', '--show-toplevel'], check=True, capture_output=True, text=True, timeout=10).stdout.strip()).resolve()
        relative = entry.relative_to(root).as_posix()
        subprocess.run(['git', '-C', str(root), 'ls-files', '--error-unmatch', '--', relative], check=True, capture_output=True, timeout=10)
        commit = subprocess.run(command + ['rev-parse', 'HEAD'], check=True, capture_output=True, text=True, timeout=10).stdout.strip()
        if re.fullmatch(r'[0-9a-f]{40,64}', commit):
            result['git_commit'] = commit
    except (OSError, ValueError, subprocess.SubprocessError):
        result['git_diagnostic'] = 'No tracked package Git identity; archive/document hashes remain evidence.'
    return result


def source_reference(file, output, role, data=None, selector=None):
    file = Path(file).resolve()
    need(file.is_file(), 'Missing explicitly supplied source: ' + str(file))
    try:
        reference = os.path.relpath(file, Path(output).parent).replace(os.sep, '/')
        path_kind = 'RELATIVE_REFERENCE'
    except ValueError:
        reference, path_kind = file.as_posix(), 'ABSOLUTE_LIVE_REFERENCE'
    row = {'role': role, 'path': reference, 'path_kind': path_kind, 'sha256': sha256(file.read_bytes() if data is None else data)}
    if selector is not None:
        row['selector'] = selector
    return row


def create_packet(input_path, segment_id, output_path, *, draft_mode=False, evidence=(), upstream_skill_dir=None):
    input_path, output_path = Path(input_path).resolve(), Path(output_path).resolve()
    need(input_path.is_file(), 'Input source is missing: ' + str(input_path))
    raw = input_path.read_bytes()
    document = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=_pairs, parse_constant=_constant)
    if draft_mode:
        validate_draft(document)
        need(segment_id is None or segment_id == document['segment_id'], '--segment differs from explicit draft.segment_id')
        segment_id = document['segment_id']
        project = document['project']
    else:
        need(segment_id is not None, '--segment must identify an original segment ID')
        project = validate_project(document)
    selection = select_project(project, segment_id)
    selected_sha = digest(selection)
    unit, budget = mapped_budget(selection)
    source = source_reference(input_path, output_path, 'draft' if draft_mode else 'project', raw, {'kind': 'FIGHT_SEGMENT_V1', 'segment_id': segment_id, 'profile': PROFILE})
    source['selected_sha256'] = selected_sha
    sources = [source]
    roles = set()
    evidence_snapshot = []
    for spec in evidence:
        role, separator, reference = spec.partition('=')
        need(separator and role in ROLES and bool(reference.strip()), '--evidence requires role=path using a six-part role')
        need(role not in roles, '--evidence role must be unique: ' + role)
        roles.add(role)
        raw_reference, separator, fragment = reference.partition("#")
        file = Path(raw_reference)
        if not file.is_absolute():
            file = input_path.parent / file
        need(file.is_file(), 'Missing explicitly supplied evidence: ' + str(file))
        evidence_bytes = file.read_bytes()
        need(bool(evidence_bytes.decode("utf-8-sig", errors="replace").strip()), "Empty original evidence is not a delivered six-part source: " + role)
        row = source_reference(file, output_path, role, evidence_bytes)
        if separator:
            need(bool(fragment.strip()), "Explicit evidence fragment is empty: " + role)
            selected_evidence = section_text(evidence_bytes.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n"), fragment).strip()
            need(bool(selected_evidence), "Selected evidence fragment is empty: " + role)
            row["selector"] = {"kind": "MARKDOWN_FRAGMENT_V1", "fragment": fragment, "normalization": "LF_STRIP_BOUNDARY_WHITESPACE"}
            row["selected_sha256"] = sha256(selected_evidence.encode("utf-8"))
        sources.append(row)
        evidence_snapshot.append({'role': role, 'sha256': sha256(evidence_bytes), 'bytes_base64': base64.b64encode(evidence_bytes).decode('ascii')})
    if draft_mode:
        need(roles == ROLES, 'FIGHT_TRANSCRIPTION requires all six original evidence files; missing ' + ', '.join(sorted(ROLES - roles)))
    diagnostics = [
        {'code': 'SEMANTIC_REVIEW_REQUIRED', 'scope': 'choreography, references, media', 'message': 'needs_review; structure is not action, reference-observation, or media acceptance.'},
        {'code': 'SOURCE_SCALE_NOT_DECLARED', 'scope': 'proxy geometry', 'message': 'No upstream height/LOOK requirement is invented. Local dimensions require explicit implementation assumptions.'},
    ]
    if draft_mode:
        diagnostics.append({'code': 'FIGHT_TRANSCRIPTION', 'scope': 'human mapping', 'message': 'Only the explicitly transcribed project structure is checked. No claim of upstream JSON or upstream structural PASS.'})
    if 'review' not in project:
        diagnostics.append({'code': 'UPSTREAM_REVIEW_NOT_REGISTERED', 'scope': 'author review', 'message': 'Original review absent; no semantic or media result is inferred.'})
    packet = {
        'schema_version': SCHEMA, 'adapter_version': ADAPTER_VERSION,
        'provider': PROVIDER, 'source_kind': PROVIDER,
        'input_mode': 'FIGHT_TRANSCRIPTION' if draft_mode else 'FIGHT_JSON',
        'validation_profile': PROFILE, 'semantic_status': 'needs_review', 'semantic_review': 'NOT_RUN',
        'structural_status': 'NOT_CLAIMED' if draft_mode else 'pass',
        'mapped_structural_status': 'pass', 'upstream_writes': False,
        'unit': unit,
        'lineage': {'source_kind': PROVIDER, 'battle_id': 'UNKNOWN', 'battle_title': project['title'], 'unit_id': segment_id, 'source_revision': 'sha256:' + source['sha256'], 'unit_revision': 'sha256:' + selected_sha},
        'budget': budget, 'master': execution_master(selection), 'sources': sources,
        'source_snapshot': copy.deepcopy(project), 'selection': selection,
        'source_selection': {'profile': PROFILE, 'segment_id': segment_id, 'selected_sha256': selected_sha, 'identity': 'FIGHT_CANONICAL_V1'},
        'asset_catalog': asset_catalog(selection), 'review': copy.deepcopy(project.get('review')),
        'evidence_snapshot': evidence_snapshot,
        'transition_context': selection['transition_context'],
        'upstream_provenance': provenance(upstream_skill_dir), 'diagnostics': diagnostics,
    }
    if draft_mode:
        packet['draft_snapshot'] = copy.deepcopy(document)
        packet['transcription'] = {'schema_version': 'PREVIS_FIGHT_DRAFT_V1', 'mapping': document['mapping'], 'assumptions': document['assumptions'], 'source_claim': 'HUMAN_TRANSCRIPTION_ONLY', 'sha256': digest({'mapping': document['mapping'], 'assumptions': document['assumptions'], 'segment_id': segment_id})}
    # Preserve input byte identities; intake never writes project or six-part files.
    need(input_path.read_bytes() == raw, 'Input changed while being collected; retry with a stable source')
    for row in sources[1:]:
        need(sha256((output_path.parent / row['path']).read_bytes()) == row['sha256'], 'Evidence changed while being collected')
    return packet
