# Basic Viking home

Runtime slot `house-1`: tribe 1 / type 2.
[Manifest](source/weathered-v1/runtime.json) · [Sprite](source/weathered-v1/final.png) · [Gallery and maps](../../OWN-ASSET-RUNTIME.md#review-locations)

Geometry: `source/geometry/raw.glb` and `house-finished.blend`.
Run `source/geometry/finish.py` in Blender to regenerate the calibrated render.
`source/paint/` holds painting inputs. The package-root PNG is the canonical world finish; keep it unchanged.

Export and review procedure: [PIPELINE.md](../PIPELINE.md).

Approved weathered finish: `source/weathered-v1/` retains the painting, transparent master,
exact prompts, reference hashes and runtime calibration. The package recipe builds the approved
delivery. Earlier paintings needed as generation references remain source inputs.
