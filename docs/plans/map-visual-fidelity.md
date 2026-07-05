# Faithful map visuals — map-import completion plan (agent prompts)

Goal: a decoded original map rendered in Vinland should be **visually indistinguishable from the
original game** (short of animation cadence a static shot can't judge). The import already lands
1:1 ground patterns (`empa`/`empb`), placed objects with growth states (`emla`+`lmlv`), authored
buildings/settlers (`StaticObjects`), and the MEASURED projection (cell 68×38 native px, staggered
raster — docs/FIDELITY.md "projection"). This plan closes the remaining gaps, ordered by visual
impact and dependency.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs (steps 4–8 are mostly independent of each
other; 1→2→3 is a hard chain). Prompts are self-contained; they also tell the agent to re-verify
facts against the sources (this doc is research output, not ground truth).

Three conventions that keep the relay honest across fresh instances:
- **The executing agent updates THIS file in its own branch**: tick your step's checkbox and append
  one line to the **Progress log** at the bottom (what landed, key measured values, any deviation
  from the prompt) — the next step's agent starts by reading that log instead of re-deriving.
- **Investigate-first steps (3, 7, 9) have two legitimate outcomes**: implement, or
  defer-with-evidence (survey numbers + a FIDELITY/SOURCES note). "We measured it and it's not
  the engine's behaviour" counts as done; silent skips don't.
- **Every step ends at the owner's eyes**: gates green is necessary, the side-by-side against the
  reference corpus is the actual exit. Delete this file when all steps land.

- [ ] 1. Pipeline: emit the `lmhe` elevation lane
- [x] 2. Render: elevation lift across every projection consumer
- [ ] 3. Pipeline+render: the `embr` brightness lane (slope shading + likely the map-edge fade)
- [ ] 4. App: authored buildings draw their authored `EditName` variant (the HQ bob-44 fix)
- [ ] 5. App: palisades/walls join into continuous runs
- [ ] 6. Building animations (mill sails & friends)
- [ ] 7. Survey: `emt3`/`emt4` overlay lanes (+ the rocky-ground layout question)
- [ ] 8. App/sim: place `setanimal` herds
- [ ] 9. Water & waves audit (phase, `fx wave*`, shore bands)
- [ ] 10. Final audit + full-strip panorama sign-off

Out of scope for this plan: `lmpa`/`lmpb` → sim water/walkability (gameplay, not look), the
`addgoods`/`setproducedgood`/`setguide` stock verbs, the minimap, and the `laco`/`lasw`/`lafm`
record lists (unknown editor data). No decoded bytes are ever committed — `content/` stays
gitignored.

## Shared verification kit (read before every step)

- **Reference corpus** (owner-supplied screenshots of the original, OUTSIDE the repo, read-only):
  `~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-{1..7}.png` — the full 250-column
  top strip of the map `specjalna_mosty_na_rzece` (decoded twin:
  `content/maps/specjalna_mosty_na_rzece.json`, 250×200), left→right with small overlaps, capture
  scale **exactly 1.25×** native art px (pinned by 5 building templates, docs/FIDELITY.md).
- **Pinned viewport mapping for `mosty-5.png`** (the north base; sub-pixel lattice fit, 19
  buildings): `img_x = −11996.0 + 42.4958·hx`, `img_y = 240.2 + 23.766·hy − 1.547·elev(hx/2, hy/2)`
  where `(hx,hy)` are half-cells and `elev` the per-cell `lmhe` value (bilinear). Native px =
  image px ÷ 1.25.
- **Our matching frame**: `npm run dev` →
  `http://localhost:5173/?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25` at a 3172×1784
  viewport ≈ the same frame as `mosty-5.png` (residual offset ≈ (−59, −15) px + per-area elevation
  lift until step 2 lands). Compose an aligned side-by-side for the user — **the owner is the pixel
  oracle; never self-sign a visual**.
- Template matching that works on this corpus: masked `TM_SQDIFF_NORMED` (invert to a score),
  alpha mask eroded 2px, sprites cropped from the served atlases
  (`content/Data/engine2d/bin/bobs/<stem>.<palette>.{atlas.json,png}`). OpenCV via a scratchpad
  venv (`python3 -m venv … && pip install opencv-python numpy`).
- Pipeline steps regenerate shared data: `content/` in a worktree is a **symlink to the primary
  checkout's `content/`** — regenerating (`npm run pipeline -- --game "../Cultures 8th Wonder"
  --mod DataCnmd --out content`) rewrites it for every session. That's fine (it's generated), but
  say so in the report, and never commit any of it.

---

## Step 1 — pipeline: emit the `lmhe` elevation lane

The single biggest missing ingredient: terrain height. Everything downstream (lift, shading,
shoreline silhouettes) consumes it. Data-only step — no render change.

### Prompt 1

```text
Add the map.dat `lmhe` elevation lane to the asset-pipeline map output, as a new optional
`elevation` lane in `content/maps/<id>.json`.

Context (re-verify against the sources; game root = "../Cultures 8th Wonder", read-only):
- docs/SOURCES.md "map.dat" documents the container: `lmhe` is an RLE-packed X8el byte plane,
  per-CELL (1 byte per cell, values 0..~240) — unlike the half-cell lanes. The decoder already
  exists: `tools/asset-pipeline/src/decoders/mapdat.ts` (`unpackMapLayer`). Confirm the per-cell
  resolution empirically: unpacked length must equal width·height (not 4·W·H) across several maps.
- Assembly point: `tools/asset-pipeline/src/stages/maps.ts` (`mapDatToTerrain`) — follow the
  existing `objects.levels` pattern (a lane that is simply carried through, omitted when absent).
- Schema: `packages/data/src/schema.ts` `TerrainMapFile` — add `elevation` as an optional
  `z.array(z.number().int().nonnegative())` with a `.refine` pinning length === width·height
  (mirror the existing ground/levels refines). Document the lane semantics in the docstring:
  per-cell terrain height, 0..~240; the render lift (≈1.24 native px/unit, measured — see
  docs/FIDELITY.md "projection") lands in the NEXT step, so nothing consumes it yet.
- Unit tests at the lowest level: extend the pipeline map-stage tests + the schema tests
  (synthetic fixtures only, never real game bytes — see the existing lane tests for the pattern).

Verification:
1. npm test / npm run check / npm run build green.
2. Regenerate content (npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd
   --out content) and confirm content/maps/specjalna_mosty_na_rzece.json carries `elevation`
   with length 250·200; report min/max/mean and the value at cell (col 124, row 23) (the bridge
   deck) and around (col 160, rows 5..30) (the north-base hill, expect ~20..34).
3. Update docs/SOURCES.md ("Remaining:" line) + docs/DATA-FORMAT.md if it lists the map JSON
   lanes; FIDELITY: extend the projection row's deferred-elevation note to "lane emitted, lift
   pending". Conventional Commit, no AI attribution. Stop before merge and report.
```

---

## Step 2 — render: elevation lift across every projection consumer

Applies the measured ≈**1.24 native px per elevation unit** upward lift. This is what makes hills
read as hills, collapses the remaining vertical mismatches vs the corpus (buildings on the hill sat
~25–40 img px off), and gives shorelines their silhouette.

### Prompt 2

```text
Lift the rendered world by terrain elevation: screen_y = projected_y − LIFT·elev, with
LIFT ≈ 1.24 px per unit (native art px; the calibration evidence and exact fitted numbers are in
docs/FIDELITY.md "projection" — E = 1.547 img px/unit at 1.25× capture, y-rms 5.0→1.2 with the
term). The `elevation` lane (per-cell, from step 1) is in content/maps/<id>.json.

Design constraints (read packages/render/CLAUDE.md first):
- ONE sampling seam: a small pure elevation sampler (bilinear over cell centres, clamped at map
  edges) lives in render's data layer; every consumer goes through it. Fractional positions
  (walking settlers) sample bilinearly — no snapping.
- Consumers to cover: (a) the terrain mesh — lift each diamond-corner vertex (corners sit between
  cell centres; bilinear sample at the corner's world coordinate; bake into the mesh ONCE at
  build, no per-frame work); (b) map objects (packages/app/src/content/objects.ts projects via
  halfCellToScreen at load — add the lift there); (c) entity sprites (the tileToScreen consumers
  in the scene/sprite path — lift at the projection call sites, sim NEVER sees it); (d) terrain
  chunk AABBs + the viewport row band — pad by maxElev·LIFT so culling never clips a lifted
  chunk/sprite (keep the pad map-wide-max, computed once); (e) picking (worldToTile) — invert
  with a 2-pass: estimate the cell from the unlifted inverse, sample its elevation, re-solve;
  add a round-trip property test incl. steep-slope cells.
- DEPTH: the painter key must stay the PRE-LIFT feet y (row order) — a tree on a hill must still
  occlude by map position, not by its lifted screen y. Add a test pinning that a lifted-up sprite
  on a nearer row still draws in front.
- Zero per-frame regressions: elevation sampling is O(1) per projected item; the mesh is baked.
  Determinism untouched (render-only; sim never reads elevation yet).

Verification:
1. Unit tests for the sampler, the depth rule, the picking round-trip, the cull pad.
2. Hands-on vs the corpus: render
   http://localhost:5173/?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25 at 3172×1784 and
   compose an aligned side-by-side against
   ~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-5.png (the pinned mapping incl.
   the elevation term is in docs/plans/map-visual-fidelity.md "Shared verification kit"). The
   buildings/trees on the hill should now sit at the original's heights (residuals ≲ a few px);
   the rock hill on the right should visibly rise. Show the user, they judge.
3. FIDELITY: move elevation from deferred to implemented in the projection row (lift value +
   method pointer); ROADMAP: tick the lmhe sub-item. Stop before merge.
```

---

## Step 3 — pipeline+render: the `embr` brightness lane

The original's slope/relief look is almost certainly the **`embr` map lane** (per-cell u8,
~127-centred — a baked brightness/shading plane, docs/SOURCES.md). Strong secondary hypothesis:
the smooth fade-to-black at the map border seen across all 7 corpus shots is ALSO baked into
`embr` (falling values near the edge). If confirmed, one lane closes both the "rocky terrain reads
flat/different" report and the ugly sawtooth map edge.

### Prompt 3

```text
Decode and render the map.dat `embr` brightness lane: emit it from the pipeline as an optional
`brightness` lane in content/maps/<id>.json (per-cell u8, ~127-centred; same carry-through
pattern as `elevation` — see stages/maps.ts + the TerrainMapFile schema refines), and multiply it
into the terrain render as per-vertex colour.

Investigate FIRST, implement second:
1. Dump `embr` for specjalna_mosty_na_rzece: overall histogram; values along the top edge (rows
   0..4) and left/right edges — does it fall toward 0 at the border (the corpus shots all fade to
   black over the last ~1–2 rows)? Values across the rocky hill (cols ~150..175, rows ~5..30) —
   does the lit/shadow slope pattern appear?
2. Pin the response curve against the corpus: the mosty-5 viewport mapping is in
   docs/plans/map-visual-fidelity.md "Shared verification kit"; sample aligned pixel pairs
   (original vs our flat render) over textured ground and regress luminance ratio vs embr —
   expect something near ratio = embr/127, but MEASURE it (report the fit + residuals). Record
   the pinned curve in docs/FIDELITY.md (calibration-by-observation) — the ground row.
3. Check whether OBJECTS/buildings are shaded too: compare a tree standing on a dark slope vs one
   on lit ground in the corpus. If objects are shaded, apply the same multiplier to map-object
   sprites/batches (tint) and building/settler sprites at their anchor cell; if not, terrain only.
   Either way record the finding.
4. Implementation: per-vertex colour on the terrain mesh (corner = bilinear embr sample, like the
   elevation lift from step 2 — share the sampler seam), baked at mesh build; Pixi mesh colour or
   vertex-colour attribute — keep batching intact (packages/render/CLAUDE.md; no per-sprite
   filters). If the border fade is NOT in embr, measure the falloff (width in rows + curve) from
   the corpus top edges and implement it as an explicit border multiplier — record it as
   approximated (engine-side, not map data) in FIDELITY.

Verification: unit tests for the sampler/curve mapping; the mosty-5 side-by-side (rock hill
shading + the top-edge fade should now match; the sawtooth silhouette should disappear into
black); also eyeball mosty-1 (map corner) and mosty-7 (right edge). Show the user. Update
SOURCES ("Remaining"), FIDELITY, ROADMAP. Stop before merge.
```

---

## Step 4 — app: authored buildings draw their authored `EditName` variant

Small, high-visibility fix: the bridge map authors `"viking headquarters house"` (bob 44 — the
longhouse with the glowing door, confirmed by template match at 0.966 in the corpus), but the
import collapses placements to typeId and the canonical binding draws `"viking headquarters"`
(bob 34, the crane-roofed variant). Both names occur across the 13 entity-bearing maps (29 vs 6),
so the authored NAME must survive to the renderer — flipping the canonical would just break the
other maps.

### Prompt 4

```text
Make authored building placements draw the exact `[GfxHouse]` variant their map names, instead of
the typeId-canonical bob. Today: resolveAuthoredPlacements (packages/app/src/slice/
vertical-slice.ts) joins entities.buildings[].name+level → buildingBobs → typeId, then the render
binding (packages/app/src/content/building-gfx.ts, buildingBobRefsByType + CANONICAL_EDIT_NAME)
picks ONE bob per typeId — wrong for maps authoring the non-canonical variant (docs/FIDELITY.md
"Authored entity placements", deviation (e); docs/ROADMAP.md corpus-comparison follow-ups (a)).

Hard constraint: gfx must NOT enter the sim (packages/sim/CLAUDE.md — no render data in
components). Design a seam on the app side, e.g.: resolveAuthoredPlacements already knows the
buildingBobs row (bmd/palette/bobId) per placement — carry that ref alongside the placement,
and after runAuthoredSlice's sim.run(0) build an entityId→BuildingBobRef override map by matching
the sim's building entities to placements (deterministic: match by cell + typeId; placement is
file-ordered and cells are unique per building). Pass the override map into the renderer through
the same channel the SpriteSheet bindings travel; the sprite pool consults it before the per-type
binding. Keep the fallback path (no entities / no override) byte-identical.

Watch out: the variant's bob may live in a family/palette the sheet loader does not load yet
(BUILDING_FAMILIES gates what may be layer-qualified — see the lesson in docs/lessons/render.md
about unloaded families falling through to the wrong layer). Only override with refs whose family
is actually loaded; count + report the rest.

Tests: unit-test the override-map construction (authored name wins; unknown/unloaded → canonical;
demo slice unaffected). Verify hands-on: in the mosty-5 comparison frame the HQ must now draw the
longhouse variant (bob 44 @ ls_houses_viking4.house02); show the user the side-by-side. Also
spot-check a map authoring "viking headquarters" (6 placements across the corpus — find one via
content/maps/*.json) still draws bob 34. Quick timeboxed check while in here: does any placed
building family carry per-rotation graphics that the authored `rot` field could pick? If none,
note it in FIDELITY (rot stays decoded-unused) and move on. Stop before merge.
```

---

## Step 5 — app: palisades/walls join into continuous runs

The original's palisade is a signature look: single posts join into an unbroken fence. We draw one
`wall_03` post per placement (the map only ever places `wall_03` on the bridge map), so runs read
as separate poles. The variants `wall_03/04/05` ("Mur h" / "Mur V" naming in the IR) are almost
certainly orientation segments the ENGINE picks per neighbour direction. Bonus trail:
docs/FIDELITY.md notes the wall cells carry `lmlp` values 4/5 — that lane may literally encode the
orientation.

### Prompt 5

```text
Make placed palisade/wall objects join into continuous runs like the original. Evidence base:
~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-5.png shows the north base's
palisade as an unbroken fence; our render (same frame,
?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25) draws isolated posts every half-cell.

Investigate first:
1. The data: which wall EditNames exist in landscapeGfx (wall_01..05?) and their GfxFrames/sizes
   (wall_03 is 15×71 — a single post). Which does the map place (only wall_03 on the bridge map),
   at which half-cell adjacencies (dump the wall placements' neighbour graph — are runs 1
   half-cell apart along N-S? E-W? diagonals?).
2. The `lmlp` lane trail: the wall cells carry lmlp 4/5 (docs/FIDELITY.md "Landscape-object
   layer"). Decode lmlp for those cells (decoders/mapdat.ts) and test the correlation: does 4 vs 5
   split by run direction? If yes, the lane IS the orientation — pipeline-emit it for wall cells
   (or resolve at load) instead of inferring from neighbours.
3. The look: template-match wall_03/04/05 frames against the corpus palisade run to see which
   sprites the original actually composes per direction (masked TM_SQDIFF_NORMED at 1.25×, crops
   from content/Data/engine2d/bin/bobs/ls_wall.goods_wood.*).

Implement the join in the app's object binding (packages/app/src/content/objects.ts) — a
per-placement variant/frame pick from the neighbour directions (or the lane), still one sprite
per placement, deterministic, load-time only. If the original's rule can't be fully pinned,
implement the closest neighbour-direction rule, and record the split (pinned vs approximated) in
FIDELITY. Tests: unit-test the direction rule on synthetic placement sets. Verify: side-by-side
of the palisade area vs mosty-5; show the user. Stop before merge.
```

---

## Step 6 — building animations (mill sails & friends)

The original's mill has rotating sails; our mill draws the static drum (bob 70). Other buildings
likely animate too (fires, smoke, the HQ door glow). The building draw path has no animation lane
today.

### Prompt 6

```text
Wire building animations: the original's windmill shows rotating sails
(~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-5.png, center-left); our render
of the same frame draws only the static mill body (bob 70 @ ls_houses_viking.housemiller01) —
docs/ROADMAP.md corpus-comparison follow-ups (b).

Investigate the data first (re-verify, don't trust this summary): the mod's
DataCnmd/budynki12/houses/houses.ini [GfxHouse] records — which fields describe animation
(frame lists per level? separate anim bob ranges? an overlay layer?). Cross-check the atlas: dump
the frames around bob 70 in ls_houses_viking.housemiller01 (content/Data/engine2d/bin/bobs/) —
consecutive sail-position frames nearby would pin the layout. Compare how [GfxLandscape] records
express loop animation (GfxLoopAnimation + GfxFrames state lists — the map-object path already
plays those at sim tick rate) and whether [GfxHouse] mirrors that shape. The OpenVikings oracle
(../OpenVikings_reversing) may document the GfxHouse fields — formats only, don't port code.

Then: extend the pipeline's extractBuildingGraphics IR (tools/asset-pipeline) with the animation
fields if it drops them today, and teach the building sprite path (packages/render sprite pool +
packages/app/src/content/building-gfx.ts) to play a building's loop frames at the sim tick rate,
exactly like map objects do — same cadence, deterministic, no per-frame allocation (pool the
layer sprite, swap textures). Scope: viking buildings that carry an anim lane; a static record
stays a static sprite (byte-identical path).

Tests: unit-test the IR extraction + the frame-selection (pure), pin one mill sequence. Verify
hands-on: the mill in the mosty-5 frame shows sails (static shot) and animates live (the user
judges the motion + speed at http://localhost:5173/?map=specjalna_mosty_na_rzece&center=160,15 —
they know the original's pace). FIDELITY: new row or extend the building-graphics row (what is
pinned: frames/layout; what approximated: cadence). Stop before merge.
```

---

## Step 7 — survey: `emt3`/`emt4` overlay lanes (+ the rocky-ground layout question)

`emt1..emt4` (u8 per cell, 255 = none) are sparse pattern overlays (roads / house foundations —
docs/SOURCES.md), currently unconsumed. Separately, the owner reported the rocky area's LAYOUT
reads different from the original — steps 2+3 (elevation + embr) may fully explain that; this step
settles what remains.

### Prompt 7

```text
Two-part investigation step (implementation only if the evidence demands it):

Part A — rocky-ground layout: after the elevation lift + embr shading landed, re-compare the
rocky hill area (right side of
~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-5.png, cols ~150..178) against our
render of the same frame (?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25, 3172×1784;
mapping in docs/plans/map-visual-fidelity.md). Diff structurally: same pattern names per triangle
(that part is verbatim data), so any remaining difference must be shading/overlay/object-level —
identify WHICH (aligned crops + difference heatmap). Report; fix only if the cause is one of the
lanes below.

Part B — emt3/emt4: decode the lanes (u8 per cell, 255=none; unpackMapLayer) across ALL decoded
maps and survey: how many maps carry non-255 values, how many cells, which pattern-dictionary
indices they reference (they are u8-ranged indices into the map's eapd pattern list — re-verify).
Visualize 2–3 carriers (draw the lane over our ground render). Decide with evidence: do they
change the LOOK (roads/foundations the ground lanes don't already carry)? If yes, emit them from
the pipeline (same optional-lane pattern as elevation/brightness) and draw as an overlay triangle
pass over the ground (same UV machinery as empa/empb — packages/render/src/data/terrain.ts).
If they are editor leftovers that the baked empa/empb already superseded (the SOURCES hypothesis),
document that with the survey numbers in docs/SOURCES.md + FIDELITY and DEFER.

Either way: tests for whatever lands, gates green, side-by-side for any visual change, honest
ledger updates. Stop before merge.
```

---

## Step 8 — app/sim: place `setanimal` herds

433 animals are authored on the bridge map alone (deer, hares, …) — visible life the import
currently defers. The decoded records exist (`entities.animals`: species + half-cell); the animal
atlases exist (`cr_ani_body_00.{bear01,cattle01,deer01,chicken01,wolves01,…}`).

### Prompt 8

```text
Place a map's authored setanimal records as visible animals. Current state: the pipeline decodes
entities.animals (species name + half-cell) but resolveAuthoredPlacements skips them
(docs/FIDELITY.md "Authored entity placements", deferred (a) — the original's animal system is
herd/AI-driven, so they must not become settlers).

Scope this step deliberately SMALL: standing animals, no behaviour. Sim side: a minimal Animal
archetype (Position + an AnimalSpecies component carrying the species typeId; no jobs, no AI —
idle only), spawned via a new spawnAnimal command following the spawnSettler pattern
(discriminated union + assertNever — adding the variant must break compilation until handled;
fuzz/golden obligations per packages/sim/CLAUDE.md). Deterministic placement in file order.
Resolve species names against the IR animals table (by-name join like humans; count + skip
unresolvable). Render side: bind the cr_ani_body_00.<species> atlases (they exist in content/;
check the IR animal graphics rows for the species→palette join) and draw the idle/stand frames —
follow how settler bindings resolve body atlases (packages/app/src/content/settler-gfx.ts) but
keep it a separate, simpler binding. Wandering/AI + herds stay DEFERRED (FIDELITY note).

Tests: sim unit test for spawnAnimal determinism (golden-adjacent: same seed+map → identical
state), app unit test for the species join. Hands-on: ?map=specjalna_mosty_na_rzece — deer/hares
visible at authored spots (the corpus shots show animals in the top strip — point the user at a
matching one); count placed vs authored in the report. Perf: animals join the same pooled sprite
path (no new per-frame cost class). Stop before merge.
```

---

## Step 9 — water & waves audit

The sea/river surface IS placed wave objects (`wave */fx wave*` records). Two open questions
recorded in FIDELITY: our wave loop **phase** is a deliberate deviation (a spatial `hx+hy`
gradient; the original may play neighbours in identical phase), and the `fx wave*` records
(24 085 of 65 953 placements on the bridge map!) are entirely undrawn (they point at
`test_effect.bmd` with no palette — engine-fx placeholders).

### Prompt 9

```text
Audit and fix the water surface against the original. Evidence: the river crosses the corpus's
top strip (~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-3.png and mosty-4.png,
around map col 124) — wave sprites are visible at 1.25×. If open-sea look can't be judged from
the strip, ask the owner for one coastal screenshot instead of guessing.

1. PHASE: in ONE original shot, template-match the wave frames (the wave records' GfxFrames lists,
   atlases under content/Data/engine2d/bin/bobs/) over a patch of water and read WHICH frame each
   neighbouring wave shows. Same frame everywhere → the original plays in unison and our spatial
   gradient (packages/app/src/content/objects.ts, phase: hx+hy — logged deviation, FIDELITY
   "Landscape-object layer" (b)) must revert to phase 0; a spatial pattern → pin it. Decide from
   pixels, not taste; update the code + FIDELITY to match the finding.
2. `fx wave*`: investigate what the engine does with them (OpenVikings formats + the records'
   fields; they sit on lmlt=1 void cells). If they are runtime-effect spawn points (foam,
   sparkle) we cannot reproduce yet, document precisely and defer; if they alias to drawable art,
   draw them.
3. Shore bands: compare the shallow-water/shore transition vs the original (the lmms ring lanes
   are decoded but unconsumed — check whether the baked empa/empb patterns already carry the
   whole shore look, i.e. nothing to do).
4. While in the water code: verify the wave alpha (our 0.5 reading of GfxDynamicBackground) against
   an aligned corpus patch — measure, don't eyeball; update the constant + FIDELITY if off.

Tests for any behavioural change (phase selection is pure). Side-by-side of a river patch
(mosty-3/4) for the user. Stop before merge.
```

---

## Step 10 — final audit + full-strip panorama sign-off

The closing gate: every remaining sub-1% gap hunted down, then the whole top strip compared
side-by-side so the owner can sign off "maps look like the original".

### Prompt 10

```text
Final map-visuals audit + the acceptance artifact.

1. RESOLVE-RATE: loading specjalna_mosty_na_rzece logs "N placements had no resolvable graphics"
   (776/43477 at the time of writing). Rank the unresolved types by count, resolve what's real
   (usually a missing extractor binding — see the lesson: a "missing asset" is usually a .bmd on
   disk that no extractor binds; mirror the nearest extractor + wire into
   resolveGraphicsBindings), and document the legitimately-undrawable rest (fx placeholders) in
   FIDELITY. Target: every remaining skip is explained, none is silent.
2. VEGETATION: verify species/palette variants land (e.g. OrangeTree 01 vs 02, yew 01 vs 02 →
   different palettes of the same bmd — the yellow/green canopy mix). Compare a forest patch of
   mosty-5/6 vs ours; if the mix reads off, chase the palette join.
3. PANORAMA: build the acceptance artifact — render our top strip as 7 frames at the corpus
   shots' viewports (derive each shot's offsets by template-matching one landmark per shot, or
   fit like mosty-5 — the kit in docs/plans/map-visual-fidelity.md) and compose aligned
   original-vs-ours pairs for ALL SEVEN shots (mosty-1..7). Present them to the owner in one
   gallery; also hand them the live URL to pan the full map.
4. LEDGER SWEEP: FIDELITY's terrain/object/entity rows must state exactly what is now
   faithful/approximated/deferred (no stale claims); ROADMAP's map-import items ticked with
   archive pointers per the ledger discipline; docs/plans/map-visual-fidelity.md checkboxes all
   done → per its own header, DELETE the plan file in this final commit.

The owner signs off the look (they are the oracle). Fix-forward anything they flag before
closing. Stop before merge.
```

---

## Progress log (one line per merged step — appended by the executing agent)

Format: `N. <date> — <what landed>; <key numbers/findings>; <deviations from the prompt, if any>.`

- 2. 2026-07-05 — elevation lift landed render-side: `screen_y = projected_y − LIFT·elev`,
  `LIFT = 1.547/1.25 = 1.2376` native px/unit (`render/data/elevation.ts` `ELEVATION_LIFT`). ONE
  bilinear sampler seam (`makeElevationField().liftAt`, edge-clamped) feeds every consumer: the ground
  mesh (per-corner lift at a watertight canonical cell coordinate, `diamondCornerLifts`, baked once),
  map objects (at the half-cell), entity sprites (at the projection call sites), the cull pad
  (`maxLift = max(elev)·LIFT` on chunk AABBs + the viewport), and picking (`worldToTile` iterated
  inverse, round-trips steep cells). DEPTH stays PRE-LIFT (painter key = un-lifted feet row → a lifted
  sprite on a nearer row still occludes correctly; pinned by a test). Hands-on vs mosty-5: north-base
  buildings sit at the original's heights, the right-side rock hill visibly rises. Known-and-deferred
  to step 3: the un-faded map-edge sawtooth + un-shaded slopes (the `embr` lane). No deviation from the
  prompt. maxLift on this map ≈ 234·1.2376 ≈ 290 px.
- 0. 2026-07-05 — baseline for this plan: pitch 68×38 + staggered raster merged (main `4acd7eb`);
  `lmlv` level counts up from the lowest state (`index = N − level`); elevation lift measured
  ≈1.24 native px/unit (unrendered); reference corpus + mosty-5 viewport fit pinned (see the
  verification kit above); known open gaps = exactly this plan's steps.
