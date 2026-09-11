# Own-art tool contract

This package prepares our artwork from retained sources. It does not decode original game data.
Follow the root contract and `docs/art/AGENTS.md`; command and recipe rules live in `docs/art/PIPELINE.md`.

- Build into `.art-build/`; only explicit publication writes runtime assets.
- Share delivery schemas with the browser through `@open-northland/art-contracts`.
- Keep provider generation separate from reproducible local build operations.
- Preserve source alpha, source resolution, calibration and animation timing unless a reviewed recipe changes them.
- Never infer visual approval from a successful build or test. Approval identifies actual pixels and metadata.
- Test failed validation, ownership, stale inputs and interrupted publication before changing delivery behavior.
