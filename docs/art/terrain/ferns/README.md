# Ferns

`asset.json` exports two fern sprites from `atlas-alpha.png`. The atlas also contains unused grass
and flower cells; keep its full dimensions because the recipe uses absolute crop coordinates.

Run `npm run art -- build terrain/ferns`, then `npm run art -- review terrain/ferns`. Publish the approved candidate with `npm run art -- publish terrain/ferns`. The
understory command also exports grass, flowers and mushrooms.
