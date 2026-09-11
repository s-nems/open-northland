# Rocks

Dark grey and light khaki deposits have separate map bindings, depletion frames and remnants.
`atlas-alpha.png` is the dark master; `atlas-light.png` is the light master. `asset.json` defines
both palettes and debris. Frame geometry comes from the light master and is shared by each palette
pair. Depletion shapes are artistic approximations. Light generation settings and prompts use the
`light-` prefix.

Run `npm run art -- build terrain/rocks`, then `npm run art -- review terrain/rocks`. Publish the approved candidate with `npm run art -- publish terrain/rocks`.
