# Building sprite pipeline

Style and world-scale rules: [WORLD-STYLE.md](../WORLD-STYLE.md).
Asset rules: [AGENTS.md](../AGENTS.md).
Runtime schema and export: [OWN-ASSET-RUNTIME.md](../OWN-ASSET-RUNTIME.md#building-delivery).

## Inputs and geometry

1. Select the individual architecture before integrating a replacement building.
2. Prepare consistent front, right, back and left views. Preserve native source resolution.
3. Reconstruct with Meshy or author geometry in Blender. Keep the raw model and request settings.
4. Measure the entrance and orient the model before camera calibration. Save model transforms,
   orthographic camera elevation, azimuth, framing and the editable scene.
5. Render a matte RGBA image for painting. Check roof thickness, openings and door proportions.

House reconstruction settings are in [request.json](house-1/source/geometry/request.json).
The house `source/geometry/finish.py` scripts import `raw.glb` and create calibrated renders.

## Painting and transparency

Use [House 1](house-1/house-painted-runtime.png) as the primary material, palette and lighting reference.
Supply the calibrated render or existing sprite as the edit target. Label each input's role.
For finish corrections, preserve architecture, silhouette, camera, doorway, canvas and margins.
Save the exact prompt and ordered input paths with the output.

Request genuine transparent RGBA. Check the alpha channel and inspect the image on light,
dark and terrain backgrounds. A painted checkerboard or background halo fails delivery.
Use the imagegen skill and the workspace's API authorization for transparent export.
Preserve generated alpha; background keying or authored silhouette masks require explicit authorization.

Optional camera-space projection is implemented in [project-paint.py](farm/source/geometry/project-paint.py).
It uses a depth pass and material fallback for unseen surfaces. Check packed textures by reopening the
saved scene. Projection does not provide painted hidden surfaces or UV baking.

## Calibration and delivery

Measure the final clear door opening and ground entrance anchor in source pixels.
Generated painting can move them even when the input geometry is unchanged.

```text
source-to-world scale = target screen door height / (source door height × review zoom)
```

The world-view trial uses zoom ×2, approximately 96px doors beside an 88px civilian.
Preserve map cells, footprints and simulation units. Record measurement uncertainty and whole-building
bounds; camera magnification does not add source detail.

```sh
uv run --with pillow python docs/art/buildings/tools/inspect-sprite.py path/to/sprite.png
npm run art -- build buildings/<slot>
npm run art -- review buildings/<slot>
npm run art -- publish buildings/<slot>
```

Verify tribe/type and door offset against readable owned content and generated IR.
Check exported file identity, then review the real map with `assets=own&zoom=2`:
entrance alignment, walking actors, depth sorting, elevation and readability at lower zoom.
Store captures containing original UI in ignored `content/`.

## Construction

The [farm](farm/README.md) has a static site base, timber/equipment layer and final painting,
revealed by authored timing masks. All layers share canvas, scale and entrance.
`build-frame.py` generates structural renders; `export.py` creates the delivery bundle.
Temporary equipment disappears at completion. Timing is an artistic approximation.
Other building packages have no delivered construction layers.
