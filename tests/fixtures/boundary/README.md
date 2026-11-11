# Boundary evidence fixtures

`fixture.mjs` generates small, actual H.264 FFmpeg test-pattern videos at test time. Every fixture, source text, lineage and receipt is synthetic and explicitly labeled. Bound cases use the current generic storyboard Python intake and JavaScript binding, without workflow state or completion labels. They test extraction and source/integrity contracts, and establish no real upstream authorization, semantic review or HyperFrames render acceptance.

Run `node --test tests/boundary-pack.test.mjs` from the repository. Requires only standard Node.js, ffmpeg and ffprobe on PATH. Tests retain their own projects, original videos, extracted samples and per-case summary in `outputs/boundary-tests-<date>-<id>/`. They do not modify earlier smoke-test outputs or production fixtures, install dependencies, render a new previs scene or push changes.
