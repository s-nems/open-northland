# Viking farm — woven grain dryer

Runtime slot `farm`: tribe 1 / type 12.
[Manifest](source/wattle-e/runtime.json) · [Sprite](source/wattle-e/final.png) · [Gallery and maps](../../OWN-ASSET-RUNTIME.md#review-locations)

Selected architecture E is a compact grain-drying workplace with woven lower walls, ventilated
upper poles and an open entrance. [Generation record](source/wattle-e/generation.json) retains
the selected concept, exact prompts, reference roles and hashes, Meshy request and export settings.
The user approved the final published building after gallery and real-map review.

`source/wattle-e/` contains the raw Meshy GLB, editable calibrated Blender scene, painted master,
genuine-alpha export, construction scene and separate model-derived shadow. Rebuild derived sources
from the repository root with Blender 5.2.1 LTS:

```sh
uv run --with numpy --with pillow python docs/art/buildings/farm/source/wattle-e/export.py
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python docs/art/buildings/farm/source/wattle-e/construction.py
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python docs/art/buildings/tools/render-shadow.py -- docs/art/buildings/farm/source/wattle-e/shadow
```

Normal delivery uses the retained layers and does not require Blender or Python.
Export and review procedure: [PIPELINE.md](../PIPELINE.md).

`source/wattle-e/render.py` reconstructs the calibrated scene from `model.glb`; painting and alpha
export remain retained provider outputs. The final clear doorway is manually measured at 296 ±8
source pixels, targeting 96 screen pixels beside an 88-pixel civilian at zoom ×2. The painted body
displays about 284 ×281 pixels, compared with the original reference canvas at 258 ×300.
Camera, registration, hidden geometry and construction timing are artistic approximations.
Construction is authored for this design. The previous architecture and obsolete authoring sources
remain in Git history. `source/references/previous-farm.png` is retained solely as a material reference
used by the existing house, headquarters and stonemason generation records.
