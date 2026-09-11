# Grass review and soil

`soil.png` is the village-earth material used by the terrain renderer. `grass-base.png` supplies the
art-review entry; `map-bindings.json` supports the legacy grass binding checks. Both PNGs are copied
without processing.

Build with `npm run art -- build terrain/grass` and publish the approved candidate with `npm run art -- publish terrain/grass`. Generation prompts and reference roles are embedded
in `generation.json` and `soil-generation.json`.
