# Viking headquarters

Runtime slot `headquarters`: tribe 1 / type 1.
[Manifest](source/weathered-projection-v3/runtime.json) · [Sprite](source/weathered-projection-v3/final.png) · [Gallery and maps](../../OWN-ASSET-RUNTIME.md#review-locations)

`repaint/generation.json` records the material repaint and transparent export.
`repaint/calibration.json` records measured door and entrance coordinates.

`raw.glb` is the reconstruction source; `calibrated.blend` is the editable camera-calibrated scene.
Run `../tools/headquarters-inspect.py` with this directory after Blender’s `--` argument to create
`inspection.blend`, then run `finish.py` with the same argument to regenerate the calibrated render.
`review-map.mjs` captures Magiczny Las at zoom ×2 through the server on port 5173.

Export and review procedure: [PIPELINE.md](../PIPELINE.md).

Approved weathered finish: `source/weathered-projection-v3/` retains the painting, transparent master,
exact prompts, reference hashes and runtime calibration. The package recipe builds the approved
delivery. Earlier paintings needed as generation references remain source inputs.

`source/weathered-projection-v3/render.py` regenerates the camera-calibrated geometry reference.
`projection-check.json` in that folder records measured edge slopes in the final painting.
