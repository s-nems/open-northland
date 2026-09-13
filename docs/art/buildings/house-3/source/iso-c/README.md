# House 3: elevated C source

Projection correction of the selected compact C design for 3 families.
The painting is retained as the geometry reference for the approved finish-c revision.

The retained calibrated model and full-detail render are in `../compact-c/geometry/`.

The final 1254px RGBA is native built-in imagegen output, without an extra alpha export or raster edits.
The canonical muted House A is the primary finish reference.
`paint/generation.json` records ordered references, hashes and prompts;
`paint/calibration.json` records the manually measured 48-world-pixel doorway and entrance.
`paint/projection-review.json` checks painted structural directions against the working
28.5° elevation / 22.5° azimuth camera. Its edge fit is approximate, not renderer metadata.

The active shared-light shadow and runtime registration are in `../finish-c/shadow/`.
Reproduce shadows with the shared [renderer](../../../tools/SHADOWS.md).
Painted geometry, hand-measured anchors and model shadows remain visual approximations.
Generation preserves the design but can alter small surface details.

[Build and review workflow](../../../../PIPELINE.md).
