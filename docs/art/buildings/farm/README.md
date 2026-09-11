# Viking farm

Runtime slot `farm`: tribe 1 / type 12.
[Manifest](source/weathered-v1/runtime.json) · [Sprite](source/weathered-v1/final.png) · [Gallery and maps](../../OWN-ASSET-RUNTIME.md#review-locations)

`build-frame.py` and `site_details.py` generate the structural layers.
`export.py` reads the static painting and calibration from `source/paint/` and writes the construction bundle.
`source/geometry/` contains the Meshy model, calibrated scene and projection scripts.
`render.py` creates `farm.blend`; `calibrate.py` creates `calibrated.blend`.

To rebuild construction sources from the repository root (overwrites the package's authored layers):

```sh
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python docs/art/buildings/farm/build-frame.py
uv run --with numpy --with pillow python docs/art/buildings/farm/export.py
```

Normal delivery uses the retained layers and does not require Blender or Python.
Export and review procedure: [PIPELINE.md](../PIPELINE.md).

Approved weathered finish: `source/weathered-v1/` retains the painting, transparent master,
exact prompts, reference hashes and runtime calibration. The package recipe builds the approved
delivery. Earlier paintings needed as generation references remain source inputs.
