# Script vertex tints

How a map's vertex colours reach the screen: the author's own `emvc` lane and a script's
`SetVertexColor point range index` / `SetVertexColorOnLand` writes over it. Presentation only; the
sim stores one palette index per map cell, as the original does, and never reads the look.

## What the op does

Original behavior (`packages/sim/src/systems/landscape/edits.ts`, `setVertexColors`): the point's
cell takes the index, and so do `range >> 1` less one rings of cells around it, so a range under 4
paints one cell, 6 paints 19 cells and 900 the whole map. The disc is clamped to the map, so a point
off the map still paints what lies on it (piracka_utopia's chain, copied from a 500x500 map). The
`OnLand` variant paints only land cells off the map border ([MISSIONS.md](MISSIONS.md#mutable-landscape-and-terrain)).
A cell's colour sits on its corner node and the ground shades each triangle between its three corners
(`cellColorsToCorners`, `packages/app/src/view/script/tints.ts`).

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
local decor on the rest. A cell starts from its authored entry and a script write replaces it, so the
victory resets of czarnoksieznik_z_szeolu and mroczny_swiat (a whole-map `0`, six discs of `0`) lift
an authored darkness, which is what the resets read as (observation from the scripts, unconfirmed
against the running original). A whole-map authored tint is a scene grade like a scripted one;
czarnoksieznik_z_szeolu's four darks of 12..33% each stay on the ground.

## What we draw

The original engine could tint only the ground mesh, so a scripted "night" left every building and
settler in daylight. We read the author's intent instead:

- The index covering at least 60% of the map's cells (`WHOLE_MAP_SHARE`,
  `packages/app/src/view/script/tints.ts`) is the scene grade: its palette colour multiplied
  over everything the stage draws below the HUD (`packages/render/src/gpu/lighting/scene-light.ts`).
  Cells the author's disc missed (the corners of wielka_kolonizacja and krwawa_rzeka) take the grade
  too, as their paired rain square does. An `OnLand` write that reaches the share grades the water
  with the land: the author dimmed the map, and the original's water simply could not take a tint.
- Channels above 1 ("sunlight" 123..126, "clearing" 52) cannot multiply a sprite past its colour.
  They draw as one additive quad at `OVERBRIGHT_SHARE` (a quarter) of their excess: a warm lift that
  keeps the shadows. Tuned by eye against the alternatives: the script's literal 1.34 red as a true
  multiply on the ground, or a half share of the lift, both read as the yellow wash players reported.
- A darkening grade draws with most of its darkness taken out (`shownGrade`,
  `packages/render/src/data/lighting/grade.ts`): a sunset keeps its hue at about 0.94 luma instead of
  0.84, and a night keeps more of its darkness (0.56 shows at about 0.63) and leans blue. Tuned by
  eye after players found the literal sunset too dark and the night flat.
- As the grade darkens past dusk, the world draws into a texture and composites
  (`world-renderer/offscreen-world.ts`): the unlit world multiplies by a light map cleared to the
  grade, with a low warm pool at the foot of each finished house and a brighter flickering pool with a
  visible flame at each map object drawn with the `fire` palette (`light-sites.ts`). Settlers and
  vehicles with an owner, and the houses, mark their own body layers lit: the world's programs write
  a lit mask beside the colour in the same draw (`lighting/night-mask.ts`), so a figure keeps part of
  its daylight colours with no light on the ground around it, a house's walls glow from its foot,
  fading toward the roof, and what the painter draws in front covers a mark again. Houses light up one
  by one through the dusk; their walls hold steady while their pools flicker slightly. The house
  palettes draw windows and doors with the same wood and plaster ramps as the beams and walls, so the
  glow follows the whole figure rather than its openings.
- The graphics setting "Day and night cycle" (`dayNight`) turns the composite off: what night remains
  (a cave's mood, a siege attack) draws as the flat shown grade, with no pools, flames or lit figures.
- Every other index stays on the terrain as its palette colour divided by the scene's multiply, so
  the product on screen is what the script asked for. Under a darkening grade a brightening local
  tint (the glow under a fire) keeps a fifth of its excess instead (`LOCAL_GLOW_SHARE`): the fire's
  own light brightens that ground again, and the divided glow blew out under it.
- A step fades exponentially over about 4 game seconds (`LIGHT_FADE_SECONDS`); a load or seek snaps.
  The terrain's local tints take their new divisor at once, so a glow runs a few seconds ahead of the
  scene it is divided by. An approximation: fading the ground too would be a per-frame pass over the
  map's nodes.
- `?tint=<index>` holds an index as the whole-map tint for review (`docs/DEVELOPMENT.md`).

## Day and night rule

The match rule `dayNight` (`map`, `on`, `off`, `?daynight=`) and the player's graphics setting choose
what the scene grade does (`packages/app/src/view/script/tints.ts`, `day-night.ts`). Presentation
only: the sim's tint state and the script keep running either way.

- A script runs a cycle when its whole-map writes (`WHOLE_MAP_RANGE`) reach both a full night
  (`FULL_NIGHT`, `nightLevel` 1) and a sun brighter than plain day: cn_2_dni, przekleta_kraina,
  straznicypolnocy and wielka_inwazja. A lone dark write is a static mood, and a weather ramp
  (bogata_kotlina's rain reaches 58) has no sun.
- A script that sets weather and writes more than one whole-map colour moves its tint with the
  weather (magiczny_las, krwawa_rzeka). The weather rule's `off`, or the player's weather setting off,
  clears that tint as well. A colour written once is the map's look and stays.
- `off`, or the player's setting off, holds a cycling script at daylight. A static mood, a weather
  ramp and a siege attack's night stay.
- `on` runs the game's own cycle on a map without one. It is straznicypolnocy's chain, step for step
  (50 minutes), read from the match tick, so a save and every client agree. The map's whole-map tint
  lies over it: a weather ramp or a static mood darkens the cycle, and what it would brighten is
  dropped, so rain at night is darker than either alone. Local tints are divided by that tint alone
  and darken with the cycle.

The tint state crosses the sim worker as one `Uint8Array` over map cells; the app spreads it over the
mesh nodes and the renderer rewrites only the nodes whose colour changed.
