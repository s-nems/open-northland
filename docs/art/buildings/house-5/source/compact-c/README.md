# Compact C home 5

Selected C architecture for 5 families; proportions adjusted against the owned original sprite
envelope. Tribe 1 / type 6, original bob 41, verified through owned
`DataCnmd/budynki12/houses/houses.ini`, its decoder and `content/ir.json`.
The original door (-2, 3) receives the existing home (+1, 0) app shift.

`generation.json` retains the selection, prompts and reference roles. `geometry/` contains
the generated reconstruction views, Meshy 7 request, losslessly compressed full GLB,
manual doorway measurements and editable calibrated shadow scene. The model depth is
shortened in `calibration.json`; hidden sides and reconstruction are approximations.
The superseded painting and shadow trials are retained in Git history. Current delivery sources
are linked from the [package README](../../README.md).

Run `docs/art/buildings/tools/render-home.py` in Blender with the geometry directory after
`--`; `--inspect` renders cardinal views. Initial doorway pixels reference the retained
untransformed inspection and its recorded orthographic scale. `compact-home.py` reduces
the editable shadow scene after the full-detail body render. Render current shadows through
`render-shadow.py` with the active delivery source shadow directory.

This directory retains architecture and reconstruction provenance, not an active runtime recipe.
No construction layers are delivered.
