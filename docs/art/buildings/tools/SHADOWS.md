# Building shadows

Finished buildings use a separate transparent shadow PNG registered to the body's entrance, at the
same world scale. Its larger canvas allows roof shadows outside the body bounds. The renderer's
shadow lane excludes these pixels from selection and picking. Construction keeps its authored layers.

Each package's shadow calibration records model, ground registration and doorway measurements.
Older packages use `source/shadow-v1/`; the woven farm uses `source/wattle-e/shadow/`.
Reproduce a shadow with Blender 5.2.1 LTS from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python docs/art/buildings/tools/render-shadow.py -- docs/art/buildings/house-2/source/shadow-v1
```

The retained geometry approximates the painted silhouette. The exporter reads the shared [lighting profile](../../lighting.json) and converts its reference
shadow direction for the actual camera, including headquarters. The 9° sun and 0.48 opacity are
artistic choices, not recovered original-game lighting. Model rotation remains independent; legacy
`lightRotationDegrees` no longer controls the ray. See the exact screen direction in
[WORLD-STYLE.md](../../WORLD-STYLE.md#shared-cast-shadow-lighting). Reference-image doorway measurements are manual
estimates. Body pixels, entrance anchors and scale remain unchanged; there is no added soil layer.
House 1 retains the exact shadow pixels accepted in the initial comparison.

Separate model-rendered shadow layers follow the production approach described in
[Factorio FFF-227](https://www.factorio.com/blog/post/fff-227). Camera/light consistency also appears in
[OpenTTD's archived graphics guide](https://wiki.openttd.org/en/Archive/Old%2032bpp/How%20to%20Create%2032bpp%20Graphics%20with%20Extra%20Zoom).
These are workflow references; the geometry and artwork are our own.

Calibration may set `samples` above the default 32 for a larger shadow canvas. The woven farm uses
128 samples and a wider canvas to retain the roof shadow beyond the building's right edge.
Its `alphaFloor` of 0.04 removes the faint shadow-catcher tail at the canvas boundary in the Blender
compositor. This affects only the separate model-rendered shadow; the generated building alpha is unchanged.
