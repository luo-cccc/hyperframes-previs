"""Read-only generic storyboard intake, independent of any author's workflow.

The source is an explicit single-unit timing/asset map plus an actual text
artifact. A draft records human transcription; neither mode establishes source
workflow authority or narrative/media acceptance.
"""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct

ADAPTER_VERSION = '0.7.0'

SOURCE_SCHEMA = 'PREVIS_STORYBOARD_SOURCE_V1'
DRAFT_SCHEMA = 'PREVIS_STORYBOARD_DRAFT_V1'
PACKET_SCHEMA = 'PREVIS_STORYBOARD_ADAPTER_V1'
PROVIDER = 'storyboard'
HASH_PROFILE = 'STORYBOARD_CANONICAL_V1'


def reject_constant(value):
    raise ValueError(f"Non-finite JSON value: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(file):
    return json.loads(file.read_text(encoding="utf-8-sig"),
                      parse_constant=reject_constant, object_pairs_hook=unique_object)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def local_ref(ref, base):
    require(isinstance(ref, str) and ref.strip(), "A nonempty local source reference is required.")
    raw, _, fragment = ref.partition("#")
    require(not re.match(r"^(https?|chat|conversation|user-message):", raw, re.I),
            f"Save/read the actual referenced content explicitly before CLI intake: {ref}")
    file = Path(raw)
    file = file.resolve() if file.is_absolute() else (base / file).resolve()
    require(file.is_file(), f"Referenced file is missing: {file}")
    return file, fragment


def section_text(text, fragment):
    if not fragment:
        return text
    anchor = re.search(r'<a\s+id=["\']' + re.escape(fragment) + r'["\']\s*>\s*</a>', text, re.I)
    if anchor:
        start = anchor.end()
        heading = re.match(r"\s*(#{1,6})[ \t]+[^\r\n]+(?:\r?\n|$)", text[start:])
        if heading:
            search_start = start + heading.end()
            boundary = re.search(r"(?m)^#{1," + str(len(heading[1])) + r"}[ \t]+", text[search_start:])
            if not boundary:
                return text[start:]
            end = search_start + boundary.start()
            # An incoming section anchor belongs to the next heading, not this one.
            for previous in re.finditer(r'<a\s+id=["\'][^"\']+["\']\s*>\s*</a>', text[start:end], re.I):
                if not text[start + previous.end():end].strip():
                    end = start + previous.start()
                    break
            return text[start:end]
        next_anchor = re.search(r'<a\s+id=', text[start:], re.I)
        return text[start:start + next_anchor.start()] if next_anchor else text[start:]
    for match in re.finditer(r"(?m)^(#{1,6})\s+(.+?)\s*$", text):
        slug = re.sub(r"[^\w\- ]", "", match[2].lower()).replace(" ", "-")
        if fragment in (match[2], slug):
            rest = text[match.end():]
            boundary = re.search(r"(?m)^#{1," + str(len(match[1])) + r"}\s+", rest)
            selected = rest[:boundary.start()] if boundary else rest
            if boundary:
                for previous in re.finditer(r'<a\s+id=["\'][^"\']+["\']\s*>\s*</a>', selected, re.I):
                    if not selected[previous.end():].strip():
                        return selected[:previous.start()]
            return selected
    raise ValueError(f"Cannot unambiguously locate Markdown fragment #{fragment}; use a dedicated source file.")


def _text(value, label):
    require(isinstance(value, str) and value.strip(), label + ': nonempty text is required.')
    # Reject isolated UTF-16 surrogates before producing portable evidence.
    value.encode('utf-8')


def selection_sha256(value):
    """JSON semantic hash shared with the JavaScript generic consumer."""
    def encode(item):
        if item is None:
            return 'null'
        if isinstance(item, bool):
            return 'true' if item else 'false'
        if isinstance(item, (int, float)):
            number = float(item)
            require(math.isfinite(number) and abs(number) <= 9007199254740991,
                    'Source number exceeds the exact JavaScript numeric range.')
            return 'n' + struct.pack('>d', 0.0 if number == 0 else number).hex()
        if isinstance(item, str):
            item.encode('utf-8')
            return json.dumps(item, ensure_ascii=False, separators=(',', ':'))
        if isinstance(item, list):
            return '[' + ','.join(encode(row) for row in item) + ']'
        require(isinstance(item, dict), 'Only JSON values may enter a source selection.')
        keys = sorted(item, key=lambda key: key.encode('utf-16-be', errors='surrogatepass'))
        return '{' + ','.join(encode(key) + ':' + encode(item[key]) for key in keys) + '}'
    return hashlib.sha256((HASH_PROFILE + '\n' + encode(value)).encode('utf-8')).hexdigest()


def validate_source(source, *, draft_mode=False):
    require(isinstance(source, dict), 'Storyboard source must be an explicit JSON object.')
    schema = DRAFT_SCHEMA if draft_mode else SOURCE_SCHEMA
    require(source.get('schema_version') == schema, 'Expected explicit ' + schema + '. Use --draft only for a human transcription.')
    _text(source.get('id'), 'id')
    require(source.get('time_basis') == 'SEGMENT', 'time_basis must explicitly be SEGMENT; normalize other clocks once and record that mapping.')
    duration = source.get('duration_s')
    require(finite(duration) and 0 < duration <= 9007199254740991, 'duration_s must be finite and positive.')
    shots = source.get('shots')
    require(isinstance(shots, list) and shots, 'shots must contain the actual continuous source shot map.')
    previous, ids = 0, set()
    for index, shot in enumerate(shots):
        require(isinstance(shot, dict), 'shots entries must be objects.')
        _text(shot.get('id'), f'shots[{index}].id')
        require(shot['id'] not in ids, 'Shot IDs must be unique; preserve actual source IDs.')
        ids.add(shot['id'])
        start, end = shot.get('start_s'), shot.get('end_s')
        require(all(finite(value) and abs(value) <= 9007199254740991 for value in (start, end))
                and end > start and abs(start - previous) <= 1e-6,
                f'Invalid, overlapping or gapped shot time: {shot["id"]}.')
        if 'duration_s' in shot:
            require(finite(shot['duration_s']) and abs(shot['duration_s'] - (end - start)) <= 1e-6,
                    f'Shot duration differs from its interval: {shot["id"]}.')
        previous = end
    require(abs(previous - duration) <= 1e-6, 'Shots must cover the exact declared duration.')
    require(isinstance(source.get('master'), dict), 'master.path must reference the actual source text artifact.')
    _text(source['master'].get('path'), 'master.path')
    settings = source.get('production_settings', {})
    require(isinstance(settings, dict), 'production_settings must be an object when supplied.')
    if 'video_aspect_ratio' in settings:
        ratio = settings['video_aspect_ratio']
        match = re.fullmatch(r'\s*([\d.]+)\s*[:：/]\s*([\d.]+)\s*', ratio) if isinstance(ratio, str) else None
        require(match and all(math.isfinite(float(value)) and float(value) > 0 for value in match.groups()),
                'production_settings.video_aspect_ratio must be an explicit positive ratio.')
    if 'visual_style' in settings:
        _text(settings['visual_style'], 'production_settings.visual_style')
    catalog = source.get('asset_catalog', {})
    require(isinstance(catalog, dict), 'asset_catalog must be an object when supplied.')
    for kind in ('actors', 'scenes', 'props'):
        rows = catalog.get(kind, [])
        require(isinstance(rows, list), f'asset_catalog.{kind} must be an array.')
        seen = set()
        for row in rows:
            require(isinstance(row, dict), f'asset_catalog.{kind} entries must be objects.')
            _text(row.get('id'), f'asset_catalog.{kind}.id')
            require(row['id'] not in seen, f'Duplicate {kind} asset ID: {row["id"]}.')
            seen.add(row['id'])
            for field in ('height_cm', 'height_m'):
                if field in row:
                    require(finite(row[field]) and row[field] > 0, f'{row["id"]}.{field} must be positive when explicitly supplied.')
            if 'height_cm' in row and 'height_m' in row:
                require(abs(row['height_cm'] / 100 - row['height_m']) <= 1e-6,
                        f'{row["id"]}: explicit height_cm and height_m conflict.')
    if 'assumptions' in source:
        require(isinstance(source['assumptions'], list), 'assumptions must be an explicit array when supplied.')
    # Validate all retained extension values rather than silently emitting NaN or
    # numbers that change on the JavaScript side of the handoff.
    selection_sha256(source)
    return source


def selected_records(source, master_sha256):
    unit = {'id': source['id'], 'duration_s': source['duration_s'], 'source_start_s': 0,
            'source_end_s': source['duration_s']}
    budget = {'time_basis': 'SEGMENT', 'duration_s': source['duration_s'], 'shots': [
        {'id': row['id'], 'start_s': row['start_s'], 'end_s': row['end_s'],
         'duration_s': row['end_s'] - row['start_s']} for row in source['shots']]}
    return {'unit': unit, 'budget': budget, 'shots': copy.deepcopy(source['shots']),
            'production_settings': copy.deepcopy(source.get('production_settings', {})),
            'asset_catalog': {kind: copy.deepcopy(source.get('asset_catalog', {}).get(kind, []))
                              for kind in ('actors', 'scenes', 'props')},
            'states': {key: copy.deepcopy(source.get(key)) for key in ('start_state', 'end_state')},
            'assumptions': copy.deepcopy(source.get('assumptions', [])), 'master_sha256': master_sha256}


def create_packet(input_file, output, *, draft_mode=False, additional_sources=()):
    input_file, output = Path(input_file).resolve(), Path(output).resolve()
    source = validate_source(read_json(input_file), draft_mode=draft_mode)
    rows = []

    def add_source(role, file, fragment='', original_ref=None):
        try:
            reference = os.path.relpath(file, output.parent).replace(os.sep, '/')
            path_kind = 'RELATIVE_REFERENCE'
        except ValueError:
            reference, path_kind = file.as_posix(), 'ABSOLUTE_LIVE_REFERENCE'
        row = {'role': role, 'path': reference, 'path_kind': path_kind,
               'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
        if original_ref is not None:
            row['original_ref'] = original_ref
        if fragment:
            selected = section_text(file.read_text(encoding='utf-8-sig'), fragment).strip()
            require(selected, f'{role}: selected Markdown fragment is empty.')
            row['selector'] = {'kind': 'MARKDOWN_FRAGMENT_V1', 'fragment': fragment,
                               'normalization': 'LF_STRIP_BOUNDARY_WHITESPACE'}
            row['selected_sha256'] = hashlib.sha256(selected.encode('utf-8')).hexdigest()
        rows.append(row)

    master_file, fragment = local_ref(source['master']['path'], input_file.parent)
    master_text = section_text(master_file.read_text(encoding='utf-8-sig'), fragment)
    require(master_text.strip(), 'The actual storyboard/director text artifact is empty.')
    master = {'ref': source['master'].get('original_ref') or source['master']['path'],
              'text': master_text, 'text_sha256': hashlib.sha256(master_text.encode('utf-8')).hexdigest()}
    add_source('input', input_file)
    add_source('master', master_file, fragment, master['ref'])
    for entry in additional_sources:
        role, separator, reference = entry.partition('=')
        require(separator and re.fullmatch(r'[a-z][a-z0-9_-]*', role)
                and role not in ('input', 'master'),
                'Additional --source must be role=actual-local-path with a distinct evidence role.')
        file, extra_fragment = local_ref(reference, input_file.parent)
        add_source(role, file, extra_fragment, reference)
    selection = selected_records(source, master['text_sha256'])
    lineage = {'source_kind': PROVIDER, 'unit_id': source['id'],
               'source_revision': rows[0]['sha256'], 'unit_revision': selection_sha256(selection)}
    for field in ('project_id', 'version'):
        if field in source:
            _text(source[field], field)
            lineage[field] = source[field]
    diagnostics = []
    for key in ('video_aspect_ratio', 'visual_style'):
        if key not in selection['production_settings']:
            diagnostics.append({'code': 'SOURCE_SETTING_NOT_PROVIDED', 'field': key,
                                'message': 'Choose and record a local execution assumption if this setting is needed.'})
    for key, value in selection['states'].items():
        if value is None:
            diagnostics.append({'code': 'SOURCE_STATE_NOT_PROVIDED', 'field': key,
                                'message': 'Do not invent a source state; record local execution assumptions or the specific unresolved dependency.'})
    return {'schema_version': PACKET_SCHEMA, 'adapter_version': ADAPTER_VERSION, 'provider': PROVIDER,
            'input_mode': 'STORYBOARD_TRANSCRIPTION' if draft_mode else 'STORYBOARD_JSON',
            'validation_profile': 'STORYBOARD_EXPLICIT_SOURCE_V1', 'hash_profile': HASH_PROFILE,
            'unit': selection['unit'], 'lineage': lineage, 'budget': selection['budget'],
            'production_settings': selection['production_settings'], 'asset_catalog': selection['asset_catalog'],
            'states': selection['states'], 'assumptions': selection['assumptions'],
            'source_snapshot': copy.deepcopy(source), 'selection': selection, 'master': master,
            'sources': rows, 'diagnostics': diagnostics, 'semantic_review': 'NOT_RUN',
            'structural_status': 'MAPPED_ONLY' if draft_mode else 'EXPLICIT_SOURCE_CHECKED',
            'upstream_writes': False,
            'scope': 'Read-only explicit storyboard mapping and source integrity; does not establish workflow authority or narrative/media acceptance.'}
