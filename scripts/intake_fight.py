#!/usr/bin/env python3
"""Seal an explicit fight JSON or human transcription as a new read-only adapter packet."""
import argparse
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from fight_contract import FightContractError, create_packet


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--project', type=Path, help='Existing declared 1.1/1.2 JSON; never modified.')
    choice.add_argument('--draft', type=Path, help='Explicit PREVIS_FIGHT_DRAFT_V1 human mapping, not an upstream JSON claim.')
    parser.add_argument('--segment', help='Original segment ID; required with --project, must agree with draft if supplied.')
    parser.add_argument('--out', type=Path, required=True, help='New file; existing evidence is never overwritten.')
    parser.add_argument('--evidence', action='append', default=[], help='role=path, relative to input directory; six original roles required for --draft.')
    parser.add_argument('--upstream-skill-dir', type=Path, help='Actual package metadata only; omitted package version/commit remain UNKNOWN.')
    args = parser.parse_args(argv)
    try:
        if args.out.is_symlink():
            raise FightContractError('Output is an existing symbolic link; use a new revision file')
        output = args.out.resolve()
        if output.exists():
            raise FightContractError('Output exists; use a new revision file: ' + str(output))
        packet = create_packet(args.draft or args.project, args.segment, output,
                               draft_mode=args.draft is not None, evidence=args.evidence,
                               upstream_skill_dir=args.upstream_skill_dir)
        content = json.dumps(packet, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(content)
        print(json.dumps({'ok': True, 'output': str(output), 'provider': packet['provider'], 'input_mode': packet['input_mode'], 'unit': packet['unit'], 'structural_status': packet['structural_status'], 'mapped_structural_status': 'pass', 'semantic_status': 'needs_review', 'upstream_writes': False}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, TypeError, KeyError, OverflowError, RecursionError) as error:
        print(json.dumps({'ok': False, 'error': str(error), 'upstream_writes': False}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
