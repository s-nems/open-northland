# House 1: elevated C candidate

Projection correction of the selected compact C design for 1 families.
The package recipe targets this candidate; final presentation awaits map review.

The retained calibrated model and full-detail render are in `../compact-c/geometry/`.

The final 1024px RGBA uses a bounded GPT Image 1.5 alpha export after correcting the door crossbar. All painting stages and exact prompts are retained in `paint/`.
The canonical muted House A is the primary finish reference.
`paint/generation.json` records ordered references, hashes and prompts;
`paint/calibration.json` records the manually measured 48-world-pixel doorway and entrance.
`paint/projection-review.json` checks painted structural directions against the working
28.5° elevation / 22.5° azimuth camera. Its edge fit is approximate, not renderer metadata.

`shadow/` retains the separate shared-light render and runtime registration.
Reproduce shadows with the shared [renderer](../../../tools/SHADOWS.md).
Painted geometry, hand-measured anchors and model shadows remain visual approximations.
Generation preserves the design but can alter small surface details.

[Build and review workflow](../../../../PIPELINE.md).
