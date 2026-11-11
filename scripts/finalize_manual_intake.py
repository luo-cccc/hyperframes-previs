#!/usr/bin/env python3
"""Seal a PREVIS_STORYBOARD_DRAFT_V1 human transcription as generic evidence."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from intake_storyboard import main
from storyboard_contract import create_packet


def finalize(draft_file, output):
    return create_packet(Path(draft_file), Path(output), draft_mode=True)


if __name__ == '__main__':
    arguments = sys.argv[1:]
    if any(argument == '--project' or argument.startswith('--project=') for argument in arguments):
        raise SystemExit('Use --draft with PREVIS_STORYBOARD_DRAFT_V1; --project belongs to intake_storyboard.py.')
    raise SystemExit(main(arguments))
