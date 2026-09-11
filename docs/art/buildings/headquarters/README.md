# Viking headquarters

Runtime slot `headquarters`: tribe 1 / type 1.
[Manifest](runtime.json) · [Sprite](final-muted.png) · [Preview](index.html)

`repaint/generation.json` records the material repaint and transparent export.
`repaint/calibration.json` records measured door and entrance coordinates.

`raw.glb` is the reconstruction source; `calibrated.blend` is the editable camera-calibrated scene.
Run `../tools/headquarters-inspect.py` with this directory after Blender’s `--` argument to create
`inspection.blend`, then run `finish.py` with the same argument to regenerate the calibrated render.
`review-map.mjs` captures Magiczny Las at zoom ×2 through the server on port 5173.

Export and review procedure: [PIPELINE.md](../PIPELINE.md).
