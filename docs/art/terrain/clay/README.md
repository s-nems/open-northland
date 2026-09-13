# Clay deposits

Two independent clay deposits replace `clay mine 01` and `clay mine 02`, each with five states ordered
least to most material. Compatibility names, state counts and offsets were checked against the owned
`landscapes.cif`, extractor and local IR/atlas metadata. Original reference pixels are excluded from Git.

`source/selected/master.png` retains the genuine-alpha GPT Image master. `generation.json` records
its prompt, reference roles and export settings. The selected olive-brown K direction uses shallow,
torn clay sheets. Each deposit has a compact gradient of the companion clay terrain texture beneath
it, darkened to avoid a glowing halo on grass. Shape, camera and material finish are artistic approximations.

Run `node docs/art/terrain/clay/source/selected/export.mjs` to reproduce the retained atlases from the
master, layout and [ground texture](../meadow-ground/source/clay/texture.png). `asset.json` delivers
those atlases with five 160×144 frames per mine, unchanged anchors and scale 0.5.
Then run `npm run art -- build terrain/clay` and `npm run art -- review terrain/clay`.

The selected presentation was accepted on Magiczny Las at zooms 1 and 2. Review both variants and all
five states in the terrain gallery. The field northwest of the starting headquarters is visible at
`?map=magiczny_las&assets=own&intro=off&zoom=2&center=34,35&fog=off`. Check ground contact, overlap and
the clay-to-meadow boundary. Publication and further revisions follow [the art pipeline](../../PIPELINE.md).
