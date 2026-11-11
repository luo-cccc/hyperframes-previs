#!/usr/bin/env python3
"""Seal an explicit generic storyboard source or human transcription, read-only."""
import argparse
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from storyboard_contract import create_packet, require, section_text


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--project', type=Path, help='PREVIS_STORYBOARD_SOURCE_V1 single-unit map and actual source text reference.')
    choice.add_argument('--draft', type=Path, help='PREVIS_STORYBOARD_DRAFT_V1 human transcription; no workflow state is invented.')
    parser.add_argument('--out', required=True, type=Path, help='New sealed packet; existing evidence is never overwritten.')
    parser.add_argument('--source', action='append', default=[], help='Extra explicit role=local-file evidence, relative to the source directory; a Markdown #fragment is supported.')
    args = parser.parse_args(argv)
    try:
        out = args.out.resolve()
        require(not args.out.is_symlink(), 'Intake output is an existing symbolic link; use a new revision file.')
        require(not out.exists(), 'Intake output already exists; use a new adapter revision rather than silently overwriting provenance.')
        packet = create_packet(args.draft or args.project, out, draft_mode=args.draft is not None,
                               additional_sources=args.source)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(packet, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
        print(json.dumps({'ok': True, 'output': str(out), 'provider': packet['provider'],
                          'unit_id': packet['unit']['id'], 'semantic_review': 'NOT_RUN',
                          'upstream_writes': False}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, OverflowError, UnicodeError) as error:
        print(json.dumps({'ok': False, 'error': str(error), 'upstream_writes': False}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
