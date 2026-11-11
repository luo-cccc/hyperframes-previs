"""Independent checks and scoped retention for the optional fight 1.3 layers."""
import math
import re

LAYER_FIELDS = ('tracks', 'vfx', 'forms', 'transitions')
PROFILE = 'FIGHT_SELECTED_SCOPE_V2'


def validate_layers(project, identities, fields, text, number, strings, need, eps):
    """Check declared author records; do not infer effects, animation or acceptance."""
    assets = {row['id']: row for row in project['assets']}
    beats = {row['id']: row for row in project['beats']}
    shots = {row['id']: row for row in project['shots']}
    costs = {row['id']: row for row in project.get('cost', [])}
    texts = []

    def rows(group, required, optional=()):
        if group not in project:
            return []
        value = project[group]
        need(isinstance(value, list) and bool(value), group + ': expected nonempty array')
        for row in value:
            fields(row, required, optional, group)
            identity = row['id']
            text(identity, group + '.id')
            need(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', identity) is not None and identity not in identities, group + '.id: invalid or repeated global ID')
            identities.add(identity)
        return value

    def refs(values, mapping, label):
        strings(values, label, True, True)
        need(all(value in mapping for value in values), label + ': unknown reference')

    tracks = rows('tracks', ('id', 'kind', 'name', 'time_relation'))
    track_map = {row['id']: row for row in tracks}
    if tracks:
        need(sum(row['kind'] == 'world' for row in tracks) == 1 and any(row['kind'] == 'inner' for row in tracks), 'tracks: one world and at least one inner required')
        for row in tracks:
            need(row['kind'] in ('world', 'inner'), 'tracks.kind: unsupported')
            texts.extend((row['name'], row['time_relation']))
    previous_by_track = {}
    previous = None
    for beat in project['beats']:
        need((beat.get('track') in track_map) if tracks else 'track' not in beat, 'beats.track: must match declared tracks')
    for shot in project['shots']:
        track = shot.get('track')
        need((track in track_map) if tracks else 'track' not in shot and 'outer_state' not in shot, 'shots.track: must match declared tracks')
        if tracks:
            need(all(beats[identity].get('track') == track for identity in shot['beat_ids']), 'shots.beat_ids: track differs from beat')
            inner = track_map[track]['kind'] == 'inner'
            need(('outer_state' in shot) == inner, 'shots.outer_state: required only on inner track')
            if inner:
                text(shot['outer_state'], 'shots.outer_state')
            prior = previous_by_track.get(track)
            returning = not inner and previous is not None and track_map[previous['track']]['kind'] == 'inner'
            if returning:
                need(shot['opening_state'] == previous['outer_state'], 'shots: return to world differs from latest outer_state')
            elif prior:
                need(prior['end_state'] == shot['opening_state'] and prior['execution']['end_state'] == shot['execution']['opening_state'], 'shots: track states are not literally continuous')
            previous_by_track[track] = shot
        previous = shot

    for row in rows('vfx', ('id', 'owner', 'name', 'layer', 'scale', 'function', 'look', 'lifecycle', 'spends', 'route', 'shot_ids'), ('asset_id',)):
        need(row['owner'] in assets, 'vfx.owner: unknown asset')
        need(row['layer'] in ('world', 'post') and row['scale'] in ('micro', 'body', 'field', 'heaven') and row['route'] in ('one_pass', 'composite', 'asset'), 'vfx: unsupported layer, scale or route')
        for key in ('name', 'function', 'look', 'spends'):
            text(row[key], 'vfx.' + key)
        refs(row['shot_ids'], shots, 'vfx.shot_ids')
        fields(row['lifecycle'], ('release',), ('omen', 'travel', 'contact', 'result', 'residue', 'fade'), 'vfx.lifecycle')
        for value in row['lifecycle'].values():
            text(value, 'vfx.lifecycle')
        need(not (row['layer'] == 'post' and any(key in row['lifecycle'] for key in ('contact', 'residue'))), 'vfx.lifecycle: post cannot contact or leave residue')
        need(row['layer'] != 'world' or any(key in row['lifecycle'] for key in ('residue', 'fade')), 'vfx.lifecycle: world needs residue or fade')
        need(('asset_id' in row) == (row['route'] == 'asset'), 'vfx.asset_id: required only for asset route')
        if 'asset_id' in row:
            need(row['asset_id'] in assets, 'vfx.asset_id: unknown asset')
        texts.extend((row['name'], row['look'], *row['lifecycle'].values()))

    forms = rows('forms', ('id', 'actor', 'from_asset', 'to_asset', 'beat_id', 'shot_ids', 'method', 'ladder', 'shared_anchors', 'cost_id', 'duration', 'exit'))
    for row in forms:
        need(row['actor'] in assets and assets[row['actor']]['kind'] in ('character', 'creature', 'manifestation'), 'forms.actor: expected acting asset')
        need(row['from_asset'] in assets and row['to_asset'] in assets and row['from_asset'] != row['to_asset'], 'forms: two different registered assets required')
        need(row['beat_id'] in beats and 'pivotal' in beats[row['beat_id']].get('marks', []), 'forms.beat_id: expected pivotal beat')
        need(row['cost_id'] in costs and costs[row['cost_id']]['owner'] == row['actor'], 'forms.cost_id: cost belongs to transforming actor')
        need(row['method'] in ('occlusion', 'morph', 'cut'), 'forms.method: unsupported')
        strings(row['ladder'], 'forms.ladder', True)
        need(len(row['ladder']) >= 3, 'forms.ladder: at least three stages required')
        strings(row['shared_anchors'], 'forms.shared_anchors', True, True)
        need(all(anchor in assets[row['from_asset']]['anchors'] and anchor in assets[row['to_asset']]['anchors'] for anchor in row['shared_anchors']), 'forms.shared_anchors: anchor not literal in both assets')
        for key in ('duration', 'exit'):
            text(row[key], 'forms.' + key)
        refs(row['shot_ids'], shots, 'forms.shot_ids')
        for identity in row['shot_ids']:
            shot = shots[identity]
            need(row['beat_id'] in shot['beat_ids'] and all(identity in shot['asset_ids'] for identity in (row['from_asset'], row['to_asset'])), 'forms.shot_ids: needs beat and both form assets')
            need(row['method'] != 'morph' or shot['risk'] == 'high', 'forms: morph requires high risk shots')
        texts.extend((*row['ladder'], *row['shared_anchors']))

    transitions = rows('transitions', ('id', 'from_shot', 'to_shot', 'method', 'layer', 'keeps', 'changes', 'cut_condition', 'route'), ('occluder',))
    need(len(transitions) <= 2 * math.ceil(project['duration_sec'] / 30), 'transitions: density limit exceeded')
    indices = {row['id']: index for index, row in enumerate(project['shots'])}
    cuts = set()
    carriers = {'occlusion', 'medium_pass', 'cloud_pass', 'space_tear', 'ink_bleed'}
    methods = carriers | {'match_graphic', 'match_action', 'whip', 'eyeline', 'sound_bridge', 'dissolve'}
    for row in transitions:
        need(row['from_shot'] in shots and row['to_shot'] in shots and indices[row['to_shot']] == indices[row['from_shot']] + 1, 'transitions: adjacent shots required')
        cut = (row['from_shot'], row['to_shot'])
        need(cut not in cuts, 'transitions: one registration per cut')
        cuts.add(cut)
        need(row['method'] in methods and row['layer'] in ('world', 'post') and row['route'] in ('cut', 'composite', 'bridge'), 'transitions: unsupported method, layer or route')
        need(('occluder' in row) == (row['method'] in carriers), 'transitions.occluder: required only for carrier method')
        for key in ('keeps', 'changes'):
            strings(row[key], 'transitions.' + key, True)
            texts.extend(row[key])
        for key in ('cut_condition',) + (('occluder',) if 'occluder' in row else ()):
            text(row[key], 'transitions.' + key)
            texts.append(row[key])
        before, after = shots[row['from_shot']], shots[row['to_shot']]
        if row['layer'] == 'post':
            need(before.get('track') == after.get('track'), 'transitions: post cannot cross tracks')
            need(not any(before['id'] in form['shot_ids'] and after['id'] in form['shot_ids'] for form in forms), 'transitions: post cannot occur within a form switch')
        need(row['route'] != 'bridge' or before['risk'] == after['risk'] == 'high', 'transitions: bridge requires both shots high risk')
    return texts


def select_layers(project, selection):
    """Keep persistent prior effects and explicit endpoint/track prerequisites."""
    chosen = {row['id'] for row in selection['shots']}
    end = selection['shots'][-1]['end']
    shots = {row['id']: row for row in project['shots']}
    effects = [row for row in project.get('vfx', []) if any(shots[identity]['start'] < end for identity in row['shot_ids'])]
    forms = [row for row in project.get('forms', []) if any(shots[identity]['start'] < end for identity in row['shot_ids'])]
    transitions = [row for row in project.get('transitions', []) if row['from_shot'] in chosen or row['to_shot'] in chosen]
    dependency_ids = {identity for row in effects + forms for identity in row['shot_ids']}
    dependency_ids.update(identity for row in transitions for identity in (row['from_shot'], row['to_shot']))
    if project.get('tracks'):
        dependency_ids.update(row['id'] for row in project['shots'] if row['start'] < end)
    dependencies = [row for row in project['shots'] if row['id'] in dependency_ids and row['id'] not in chosen]
    frame_ids = {row['id'] for row in selection['keyframes']}
    frame_ids.update(row['id'] for row in project['keyframes'] if row['shot_id'] in dependency_ids)
    selection['keyframes'] = [row for row in project['keyframes'] if row['id'] in frame_ids]
    beat_ids = {row['id'] for row in selection['beats']}
    all_beats = {row['id']: row for row in project['beats']}
    def include_beat(identity):
        if identity not in beat_ids:
            beat_ids.add(identity)
            for prerequisite in all_beats[identity]['requires']:
                include_beat(prerequisite)
    for row in dependencies:
        for identity in row['beat_ids']:
            include_beat(identity)
    form_cost_ids = {row['cost_id'] for row in forms}
    for row in project.get('cost', []):
        if row['id'] in form_cost_ids and row not in selection['cost']:
            selection['cost'].append(row)
            include_beat(row['from_beat'])
    groups = (('cost', project.get('cost', [])), ('attrition', project['scene'].get('attrition', [])), ('knowledge', project.get('knowledge', [])))
    resource_ids = {name: {row['id'] for row in selection[name]} for name, _ in groups}
    while True:
        previous = (len(beat_ids), sum(len(value) for value in resource_ids.values()))
        for name, rows in groups:
            for row in rows:
                if row['from_beat'] in beat_ids or row.get('resolved_by') in beat_ids:
                    resource_ids[name].add(row['id'])
                    include_beat(row['from_beat'])
                    if 'resolved_by' in row:
                        include_beat(row['resolved_by'])
        if previous == (len(beat_ids), sum(len(value) for value in resource_ids.values())):
            break
    for name, rows in groups:
        selection[name] = [row for row in rows if row['id'] in resource_ids[name]]
    asset_ids = {row['id'] for row in selection['assets']}
    for row in selection['keyframes']:
        asset_ids.update(row['asset_ids'])
    for identity in beat_ids:
        asset_ids.update(all_beats[identity]['actors'])
    asset_ids.update(row['owner'] for row in selection['cost'])
    asset_ids.update(row['holder'] for row in selection['knowledge'])
    for row in effects:
        asset_ids.add(row['owner'])
        if 'asset_id' in row:
            asset_ids.add(row['asset_id'])
    for row in forms:
        asset_ids.update(row[key] for key in ('actor', 'from_asset', 'to_asset'))
    for row in dependencies:
        asset_ids.update(row['asset_ids'])
    selection.update(schema_version=PROFILE, tracks=project.get('tracks', []), vfx=effects, forms=forms, transitions=transitions, layer_dependencies={'shots': dependencies})
    selection['beats'] = [row for row in project['beats'] if row['id'] in beat_ids]
    selection['assets'] = [row for row in project['assets'] if row['id'] in asset_ids]
    for boundary in selection['transition_context']['boundaries']:
        before, after = shots[boundary['from_shot_id']], shots[boundary['to_shot_id']]
        boundary.update(from_track=before.get('track'), to_track=after.get('track'), outer_state=before.get('outer_state'), transitions=[row for row in transitions if row['from_shot'] == before['id'] and row['to_shot'] == after['id']])
    return selection


def layer_fragments(selection):
    chosen = {row['id'] for row in selection['shots']}
    result = []
    def add(group, row, key, value):
        result.append({'pointer': '/' + group + '/@' + row['id'] + '/' + key, 'text': value})
    for row in selection.get('tracks', []):
        if any(shot.get('track') == row['id'] for shot in selection['shots']):
            for key in ('name', 'time_relation'):
                add('tracks', row, key, row[key])
    for row in selection.get('vfx', []):
        if chosen.intersection(row['shot_ids']):
            for key in ('name', 'look'):
                add('vfx', row, key, row[key])
            for key, value in row['lifecycle'].items():
                add('vfx', row, 'lifecycle/' + key, value)
    for row in selection.get('forms', []):
        if chosen.intersection(row['shot_ids']):
            for index, value in enumerate(row['ladder']):
                add('forms', row, 'ladder/' + str(index), value)
            for index, value in enumerate(row['shared_anchors']):
                add('forms', row, 'shared_anchors/' + str(index), value)
    for row in selection.get('transitions', []):
        for key in ('keeps', 'changes', 'cut_condition', 'occluder'):
            if key in row:
                if isinstance(row[key], list):
                    for index, value in enumerate(row[key]):
                        add('transitions', row, key + '/' + str(index), value)
                else:
                    add('transitions', row, key, row[key])
    return result
