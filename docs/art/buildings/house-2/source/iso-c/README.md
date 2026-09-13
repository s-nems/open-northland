# House 2: elevated C candidate

Projection correction of the selected compact C design for 2 families.
The package recipe targets this candidate; final presentation awaits map review.

The calibrated mesh is reduced in width by 18%, depth by 15%, and height above the doorway by 22%. Door height is preserved. `geometry/reshape.json` records the transforms; `geometry/house-finished.blend` retains the editable result. Reproduce it with Blender and `docs/art/buildings/tools/reshape-home.py -- <this folder>/geometry` from the repository root.

The final 1254px RGBA is native built-in imagegen output, without an extra alpha export or raster edits.
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
