# Boundary evidence fixtures

`fixture.mjs` generates small, actual H.264 FFmpeg test-pattern videos at test time. Every fixture, source text, lineage, receipt and TEXT check is synthetic and explicitly labeled. It tests extraction and source/integrity contracts, and establishes no real upstream authorization, semantic review or HyperFrames render acceptance.

Run `node --test tests/boundary-pack.test.mjs` from the repository. Requires only standard Node.js, ffmpeg and ffprobe on PATH. Tests retain their own projects, original videos, extracted samples and per-case summary in `outputs/boundary-tests-<date>-<id>/`. They do not modify earlier smoke-test outputs or production fixtures, install dependencies, render a new previs scene or push changes.