# Script vertex tints

How a map's vertex colours reach the screen: the author's own `emvc` lane and a script's
`SetVertexColor point range index` / `SetVertexColorOnLand` writes over it. Presentation only; the
sim stores one palette index per half-cell node and never reads the look.

## What the op does

Original behavior (`packages/sim/src/systems/landscape/edits.ts`, `setVertexColors`): the point's
cell takes the index, and so do `range >> 1` less one rings of cells around it, so a range under 4
paints one cell, 6 paints 19 cells and 900 the whole map. The disc is clamped to the map, so a point
off the map still paints what lies on it (piracka_utopia's chain, copied from a 500x500 map). The
`OnLand` variant skips water. The original keeps one index per cell; the sim keeps one per node and
gives every node a painted cell owns the index.

## What the shipped scripts do

430 ops across 45 maps, read from `content/maps/*.script.json`. The index points into
`content/terrain-palettes/vertexcolors.json` (channel / 128 is the multiplier, 128 neutral; entries
0, 53, 54 and 255 are neutral). Every whole-map write is a disc of range 255..1000 from one point,
covering 77..100% of the map; every local write is range 3..80. wielka_inwazja's day and night chain
was written with point (0,0) and range 0, one cell in a corner, which
`tools/asset-pipeline/corrections/wielka-inwazja-day-night-range.json` fixes.

| Intent | Maps | Palette |
| --- | --- | --- |
| Whole-map day and night, stepped every 1..10 min, looped | cn_2_dni (10 min), przekleta_kraina (42), straznicypolnocy, zimna_wojna (50), wielka_inwazja (broken: range 0) | day 0 -> sun 125/124/126 (up to 1.26, 1.12, 0.92) -> sunset 64/79 -> evening 133/134 -> night 58/59 (0.56 or 0.45 grey) -> morning 133 |
| Whole-map weather mood, paired with `SetWeather`, ramps of 15 s steps | magiczny_las x4, krwawa_rzeka, wielka_kolonizacja(_ii), piracka_utopia (broken: point off map) | overcast 55/56 (0.89 / 0.78 grey), clearing 52 (1.18), sunlight 125/123 (1.34, 1.15, 0.90) |
| Whole-map static mood, written once at load | 14 maps, mostly caves and sub-maps | darkness 58, red curse, dusk, desert sun |
| Local glow under fires and torches, re-painted after each whole-map step | the cycling maps, saracen sub-maps | 116..119, up to 1.8 red, range 4..10 |
| Local cursed ground, markers (flag points, shrines, teleport pads), water and sand decor | ~20 maps | dark 57/59/140/143, white, blue, green, ochre |
| Periodic local flash | saracen_4 (sunbeam, 15 s every 20 min) | 120, range 8 |

No whole-map write is shorter than 15 s.

## What the map authors painted

The `emvc` lane (`docs/formats/MAPDAT.md`) is the same palette per cell, written in the editor. 38 of
the shipped maps tint a cell with it (39 `map.dat` files, one a duplicate the pipeline skips): whole
caves and cursed lands (czarnoksieznik_z_szeolu 98%, straznicypolnocy_sub1 78%, mroczny_swiat 34%),
local decor on the rest. A node starts from its cell's entry and a script write replaces it, so the
victory resets of czarnoksieznik_z_szeolu and mroczny_swiat (a whole-map `0`, six discs of `0`) lift
an authored darkness, which is what the resets read as (observation from the scripts, unconfirmed
against the running original). A whole-map authored tint is a scene grade like a scripted one;
czarnoksieznik_z_szeolu's four darks of 12..33% each stay on the ground.

## What we draw

The original engine could tint only the ground mesh, so a scripted "night" left every building and
settler in daylight. We read the author's intent instead:

- The index covering at least 60% of the map's nodes (`WHOLE_MAP_SHARE`,
  `packages/app/src/view/runtime/script-tints.ts`) is the scene grade: its palette colour multiplied
  over everything the stage draws below the HUD (`packages/render/src/gpu/lighting/scene-light.ts`).
  Nodes the author's disc missed (the corners of wielka_kolonizacja and krwawa_rzeka) take the grade
  too, as their paired rain square does. An `OnLand` write that reaches the share grades the water
  with the land: the author dimmed the map, and the original's water simply could not take a tint.
- Channels above 1 ("sunlight" 123..126, "clearing" 52) cannot multiply a sprite past its colour.
  They draw as one additive quad at `OVERBRIGHT_SHARE` (a quarter) of their excess: a warm lift that
  keeps the shadows. Tuned by eye against the alternatives: the script's literal 1.34 red as a true
  multiply on the ground, or a half share of the lift, both read as the yellow wash players reported.
- Every other index stays on the terrain as its palette colour divided by the scene's multiply, so
  the product on screen is exactly what the script asked for.
- A step fades exponentially over about 4 game seconds (`LIGHT_FADE_SECONDS`); a load or seek snaps.
  The terrain's local tints take their new divisor at once, so a glow runs a few seconds ahead of the
  scene it is divided by. An approximation: fading the ground too would be a per-frame pass over the
  map's nodes.
- `?tint=<index>` holds an index as the whole-map tint for review (`docs/DEVELOPMENT.md`).

The tint state crosses the sim worker as one `Uint8Array` over node ids and the renderer rewrites only
the nodes that changed. Measured on magiczny_las at its first whole-map step (`SetVertexColor 180 260
900 55`, 182400 nodes) with the browser frame probe (`docs/DEVELOPMENT.md`, `debug=perf`): the step's
frame fell from 405 ms to 28-35 ms, the worker answer from 4.7 MB of node objects to 182 KB.
