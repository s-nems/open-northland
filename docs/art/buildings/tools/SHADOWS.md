# Building shadows

Finished buildings use a separate transparent shadow PNG registered to the body's entrance, at the
same world scale. Its larger canvas allows roof shadows outside the body bounds. The renderer's
shadow lane excludes these pixels from selection and picking. Construction keeps its authored layers.

Each package's `source/shadow-v1/calibration.json` records model, ground registration and doorway
measurements. Reproduce a shadow with Blender 5.2.1 LTS from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python docs/art/buildings/tools/render-shadow.py -- docs/art/buildings/house-2/source/shadow-v1
```

The retained geometry approximates the painted silhouette. Shared upper-left daylight, 9° sun and
0.48 opacity are artistic choices, not recovered original-game lighting. Headquarters rotates both
geometry and light to match its retained camera. Reference-image doorway measurements are manual
estimates. Body pixels, entrance anchors and scale remain unchanged; there is no added soil layer.
House 1 retains the exact shadow pixels accepted in the initial comparison.

Separate model-rendered shadow layers follow the production approach described in
[Factorio FFF-227](https://www.factorio.com/blog/post/fff-227). Camera/light consistency also appears in
[OpenTTD's archived graphics guide](https://wiki.openttd.org/en/Archive/Old%2032bpp/How%20to%20Create%2032bpp%20Graphics%20with%20Extra%20Zoom).
These are workflow references; the geometry and artwork are our own.
