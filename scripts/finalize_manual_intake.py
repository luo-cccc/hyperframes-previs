#!/usr/bin/env python3
"""Seal explicitly transcribed evidence; never parse or migrate free-text authority."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
sys.dont_write_bytecode = True
from intake_storyboard import read_json, require, finite, local_ref, section_text


def finalize(draft_file, output):
    draft = read_json(draft_file)
    for field in ('project_id', 'formal_id', 'prompt_version', 'budget_version'):
        require(isinstance(draft.get(field), str) and draft[field].strip(), f'{field} must come from the actual upstream delivery.')
    settings = draft.get('production_settings', {})
    for key in ('video_aspect_ratio', 'visual_style', 'segment_max_s'):
        row = settings.get(key, {})
        require(row.get('status') == 'CONFIRMED' and row.get('selected') is not None and row.get('decision_ref'), f'{key} requires the actual confirmed choice and decision_ref.')
    maximum = settings['segment_max_s']['selected']
    maximum = maximum.get('value') if isinstance(maximum, dict) else maximum
    require(finite(maximum) and maximum > 0, 'segment_max_s must be positive.')
    budget = draft.get('budget', {})
    require(all(budget.get(k) == draft[k] for k in ('formal_id', 'prompt_version', 'budget_version')), 'Budget identity/version differs from the transcribed delivery.')
    require(budget.get('time_basis') == 'SEGMENT' and finite(budget.get('duration_s')) and 0 < budget['duration_s'] <= maximum, 'Budget needs the unchanged segment-relative duration.')
    require(finite(budget.get('target_max_s')) and abs(budget['target_max_s']-maximum) < 1e-6, 'Budget limit differs from the confirmed setting.')
    previous, ids = 0, set()
    require(isinstance(budget.get('shots'), list) and budget['shots'], 'Actual budget shots are required.')
    for shot in budget['shots']:
        start, end, length = shot.get('start_s'), shot.get('end_s'), shot.get('duration_s')
        require(isinstance(shot.get('id'), str) and shot['id'] and shot['id'] not in ids, 'Shot IDs must be explicit and unique.')
        require(all(finite(v) for v in (start, end, length)) and end > start and abs(start-previous) < 1e-6 and abs(end-start-length) < 1e-6, 'Budget shots must be continuous with consistent segment times.')
        ids.add(shot['id']); previous = end
    require(abs(previous-budget['duration_s']) < 1e-6, 'Budget does not cover the actual duration.')
    snapshot = draft.get('upstream_snapshot', {})
    coverage = snapshot.get('coverage', {})
    require(all(coverage.get(k) == draft[k] for k in ('formal_id', 'prompt_version', 'budget_version')), 'Transcribed coverage identity/version is missing or mismatched.')
    require(coverage.get('status') == 'DONE' and coverage.get('start_state') is not None and coverage.get('end_state') is not None, 'Actual effective delivery and segment start/end evidence are required; do not turn a draft into DONE.')
    sources, master = [], None
    rows = draft.get('sources', [])
    require(isinstance(rows, list), 'sources must be explicit local evidence records.')
    roles = {row.get('role') for row in rows}
    require({'state', 'budget', 'master', 'source_script', 'text_evidence'} <= roles, 'Provide all five source roles: state, budget, master, source_script, text_evidence.')
    require(len([r for r in rows if r.get('role') == 'master']) == 1, 'Provide exactly one unambiguous mother-script source.')
    for row in rows:
        file, fragment = local_ref(row.get('path'), draft_file.parent)
        try:
            ref = os.path.relpath(file, output.parent).replace(os.sep, '/')
        except ValueError:
            ref = file.as_posix()
        source = {'role': row['role'], 'path': ref, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'original_ref': row.get('original_ref', row['path'])}
        if row['role'] == 'master':
            master = section_text(file.read_text(encoding='utf-8-sig'), fragment)
            beginning = master.find('场《')
            require(beginning >= 0, 'Mother-script evidence needs an explicit complete mother script, not an assistant summary.')
            master = master[beginning:]
            source['fragment'] = fragment
        sources.append(source)
    for marker in ('【全片风格】', '【整体描述】', '【禁止项】'):
        require(marker in master, f'Mother-script structure is incomplete: {marker}')
    duration = re.search(r'总时长\s*[:：]\s*([\d.]+)\s*秒', master)
    require(duration and abs(float(duration[1])-budget['duration_s']) < 1e-6, 'Mother-script duration differs from the actual budget.')
    blocks = re.split(r'镜头(?:[一二三四五六七八九十百零〇]+|\d+)\s*[{｛]', master)[1:]
    require(len(blocks) == len(budget['shots']), 'Mother-script shot count differs from the budget.')
    for block, shot in zip(blocks, budget['shots']):
        interval = re.search(r'时间\s*[:：]\s*([\d.]+)\s*[-–—~～至]\s*([\d.]+)\s*秒', block)
        require(interval and abs(float(interval[1])-shot['start_s']) < 1e-6 and abs(float(interval[2])-shot['end_s']) < 1e-6, 'Mother-script shot clock differs from the budget.')
    packet = {k: copy.deepcopy(draft[k]) for k in ('project_id', 'formal_id', 'prompt_version', 'budget_version', 'production_settings', 'budget', 'upstream_snapshot')}
    for field in ('episode_id', 'scene_id', 'asset_catalog', 'transcription_notes'):
        if field in draft: packet[field] = copy.deepcopy(draft[field])
    packet.update(schema_version='STORYBOARD_PREVIS_ADAPTER_V1', adapter_version='0.4.0', input_mode='MANUAL_TRANSCRIPTION', validation_profile='MANUAL_EVIDENCE_V1', sources=sources, master={'ref': draft.get('master', {}).get('ref') or next(row['original_ref'] for row in sources if row['role'] == 'master'), 'text': master, 'text_sha256': hashlib.sha256(master.encode('utf-8')).hexdigest()}, semantic_review='NOT_RUN', upstream_writes=False)
    return packet


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--draft', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        output = args.out.resolve()
        require(not output.exists(), 'Output exists; preserve the previous evidence packet and use a new revision.')
        packet = finalize(args.draft.resolve(), output)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(packet, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write('\n')
        print(json.dumps({'ok': True, 'output': str(output), 'semantic_review': 'NOT_RUN', 'upstream_writes': False}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, AttributeError) as error:
        print(json.dumps({'ok': False, 'error': str(error), 'upstream_writes': False}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
