# Trees and stump

Two pines and two beeches use `atlas-alpha.png` and `asset.json`. Each has three growth frames at
scale 0.5 and the original frame dimensions. Younger states reuse reduced mature artwork; roots and
procedural breeze are artistic approximations. `stump.png` and `stump.runtime.json` supply the
post-felling remnant, with their own `stump.prompt.txt` and `stump-generation.json`. The stump is
not collectible timber.

Run `npm run art -- build terrain/woodland`, then `npm run art -- review terrain/woodland`. Publish the approved candidate with `npm run art -- publish terrain/woodland`. The stump master
is delivered unchanged.
