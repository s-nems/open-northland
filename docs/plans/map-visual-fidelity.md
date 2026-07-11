# Faithful map visuals — map-import completion plan (agent prompts)

Goal: a decoded original map rendered in Vinland should be **visually indistinguishable from the
original game** (short of animation cadence a static shot can't judge). The import already lands
1:1 ground patterns (`empa`/`empb`), placed objects with growth states (`emla`+`lmlv`), authored
buildings/settlers (`StaticObjects`), and the MEASURED projection (cell 68×38 native px, staggered
raster — plan progress note "projection"). This plan closes the remaining gaps, ordered by visual
impact and dependency.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs (steps 4–8 are mostly independent of each
other; 1→2→3 is a hard chain). Prompts are self-contained; they also tell the agent to re-verify
facts against the sources (this doc is research output, not ground truth).

Three conventions that keep the relay honest across fresh instances:
- **The executing agent updates THIS file in its own branch**: tick your step's checkbox and append
  one line to the **Progress log** at the bottom (what landed, key measured values, any deviation
  from the prompt) — the next step's agent starts by reading that log instead of re-deriving. Delete the merged
  step's prompt block in the same commit (git history keeps it).
- **Investigate-first steps (3, 7, 9) have two legitimate outcomes**: implement, or
  defer-with-evidence (survey numbers + a plan progress note/SOURCES note). "We measured it and it's not
  the engine's behaviour" counts as done; silent skips don't.
- **Every step ends at the owner's eyes**: gates green is necessary, the side-by-side against the
  reference corpus is the actual exit. Delete this file when all steps land.

- [x] 1. Pipeline: emit the `lmhe` elevation lane
- [x] 2. Render: elevation lift across every projection consumer
- [x] 3. Pipeline+render: the `embr` brightness lane (slope shading + likely the map-edge fade)
- [ ] 4. App: authored buildings draw their authored `EditName` variant (the HQ bob-44 fix)
- [ ] 5. App: palisades/walls join into continuous runs
- [ ] 6. Building animations (mill sails & friends)
- [ ] 7. Survey: rocky-ground layout re-compare (the `emt*` half landed with the mesh rebuild)
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
  scale **exactly 1.25×** native art px (pinned by 5 building templates, plan progress note).
- **Pinned viewport mapping for `mosty-5.png`** (the north base; sub-pixel lattice fit, 19
  buildings): `img_x = −11996.0 + 42.4958·hx`, `img_y = 240.2 + 23.766·hy − 1.547·elev(hx/2, hy/2)`
  where `(hx,hy)` are half-cells and `elev` the per-cell `lmhe` value (bilinear). Native px =
  image px ÷ 1.25.
- **Our matching frame**: `npm run dev` →
  `http://localhost:5173/?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25` at a 3172×1784
  viewport ≈ the same frame as `mosty-5.png` (residual offset ≈ (−59, −15) px, measured before
  the step-2 elevation lift landed). Compose an aligned side-by-side for the user — **the owner is the pixel
  oracle; never self-sign a visual**.
- Template matching that works on this corpus: masked `TM_SQDIFF_NORMED` (invert to a score),
  alpha mask eroded 2px, sprites cropped from the served atlases
  (`content/Data/engine2d/bin/bobs/<stem>.<palette>.{atlas.json,png}`). OpenCV via a scratchpad
  venv (`python3 -m venv … && pip install opencv-python numpy`).
- Pipeline steps regenerate shared data: a worktree carries its own `content/` **copy** (`cp -Rc
  ../vinland/content content` — never a symlink; the pipeline writes in place). Regenerating
  (`npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`) touches
  only the worktree's copy; if outputs changed, regenerate the primary checkout's `content/`
  after merge. Never commit any of it.

---

## Step 4 — app: authored buildings draw their authored `EditName` variant

Small, high-visibility fix: the bridge map authors `"viking headquarters house"` (bob 44 — the
longhouse with the glowing door, confirmed by template match at 0.966 in the corpus), but the
import collapses placements to typeId and the canonical binding draws `"viking headquarters"`
(bob 34, the crane-roofed variant). Both names occur across the 122 entity-bearing maps (131 vs 60),
so the authored NAME must survive to the renderer — flipping the canonical would just break the
other maps.

### Prompt 4

```text
Make authored building placements draw the exact `[GfxHouse]` variant their map names, instead of
the typeId-canonical bob. Today: resolveAuthoredPlacements (packages/app/src/slice/
vertical-slice.ts) joins entities.buildings[].name+level → buildingBobs → typeId, then the render
binding (packages/app/src/content/building-gfx.ts, buildingBobRefsByType + CANONICAL_EDIT_NAME)
picks ONE bob per typeId — wrong for maps authoring the non-canonical variant. Record the source
basis and any remaining approximation in this plan's progress note.

Hard constraint: gfx must NOT enter the sim (packages/sim/AGENTS.md — no render data in
components). Design a seam on the app side, e.g.: resolveAuthoredPlacements already knows the
buildingBobs row (bmd/palette/bobId) per placement — carry that ref alongside the placement,
and after runAuthoredSlice's placement tick build an entityId→BuildingBobRef override map by matching
the sim's building entities to placements (deterministic: match by cell + typeId; placement is
file-ordered and cells are unique per building). Pass the override map into the renderer through
the same channel the SpriteSheet bindings travel; the sprite pool consults it before the per-type
binding. Keep the fallback path (no entities / no override) byte-identical.

Watch out: the variant's bob may live in a family/palette the sheet loader does not load yet
(BUILDING_FAMILIES gates what may be layer-qualified — see the lesson in AGENTS.md/render.md
about unloaded families falling through to the wrong layer). Only override with refs whose family
is actually loaded; count + report the rest.

Tests: unit-test the override-map construction (authored name wins; unknown/unloaded → canonical;
demo slice unaffected). Verify hands-on: in the mosty-5 comparison frame the HQ must now draw the
longhouse variant (bob 44 @ ls_houses_viking4.house02); show the user the side-by-side. Also
spot-check a map authoring "viking headquarters" (6 placements across the corpus — find one via
content/maps/*.json) still draws bob 34. Quick timeboxed check while in here: does any placed
building family carry per-rotation graphics that the authored `rot` field could pick? If none,
note it in plan progress note (rot stays decoded-unused) and move on. Stop before merge.
```

---

## Step 5 — app: palisades/walls join into continuous runs

The original's palisade is a signature look: single posts join into an unbroken fence. We draw one
`wall_03` post per placement (the map only ever places `wall_03` on the bridge map), so runs read
as separate poles. The variants `wall_03/04/05` ("Mur h" / "Mur V" naming in the IR) are almost
certainly orientation segments the ENGINE picks per neighbour direction. Bonus trail:
plan progress note notes the wall cells carry `lmlp` values 4/5 — that lane may literally encode the
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
2. The `lmlp` lane trail: the wall cells carry lmlp 4/5 (plan progress note "Landscape-object
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
plan progress note. Tests: unit-test the direction rule on synthetic placement sets. Verify: side-by-side
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
of the same frame draws only the static mill body (bob 70 @ ls_houses_viking.housemiller01).

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
they know the original's pace). Plan note: new row or extend the building-graphics row (what is
pinned: frames/layout; what approximated: cadence). Stop before merge.
```

---

## Step 7 — survey: rocky-ground layout re-compare

The original Part B of this step (the `emt3`/`emt4` lanes) is DONE out of band: the 2026-07-10
terrain-mesh rebuild pinned `emt1..emt4` as the per-triangle TRANSITION overlays (not
roads/foundations — the SOURCES hypothesis was wrong; see docs/SOURCES.md "terrain tessellation")
and consumes all four end-to-end. What remains is Part A — the owner-reported rocky-area layout
difference, which the mesh rebuild + transitions + the corrected elevation divisor may now fully
explain.

### Prompt 7

```text
Rocky-ground layout re-compare (implementation only if the evidence demands it): after the terrain
mesh rebuild (node tessellation + emt transitions + elevation/16 lift), re-compare the rocky hill
area (right side of ~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-5.png, cols
~150..178) against our render of the same frame
(?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25, 3172×1784; mapping in
docs/plans/map-visual-fidelity.md). Diff structurally: same pattern names per triangle (verbatim
data), so any remaining difference must be shading/overlay/object-level — identify WHICH (aligned
crops + difference heatmap). Report with numbers; fix only what the evidence pins. Tests for
whatever lands, gates green, side-by-side for any visual change, honest plan progress note. Stop
before merge.
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
(plan progress note "Authored entity placements", deferred (a) — the original's animal system is
herd/AI-driven, so they must not become settlers).

Scope this step deliberately SMALL: standing animals, no behaviour. Sim side: a minimal Animal
archetype (Position + an AnimalSpecies component carrying the species typeId; no jobs, no AI —
idle only), spawned via a new spawnAnimal command following the spawnSettler pattern
(discriminated union + assertNever — adding the variant must break compilation until handled;
fuzz/golden obligations per packages/sim/AGENTS.md). Deterministic placement in file order.
Resolve species names against the IR animals table (by-name join like humans; count + skip
unresolvable). Render side: bind the cr_ani_body_00.<species> atlases (they exist in content/;
check the IR animal graphics rows for the species→palette join) and draw the idle/stand frames —
follow how settler bindings resolve body atlases (packages/app/src/content/settler-gfx.ts) but
keep it a separate, simpler binding. Wandering/AI + herds stay DEFERRED (plan progress note).

Tests: sim unit test for spawnAnimal determinism (golden-adjacent: same seed+map → identical
state), app unit test for the species join. Hands-on: ?map=specjalna_mosty_na_rzece — deer/hares
visible at authored spots (the corpus shots show animals in the top strip — point the user at a
matching one); count placed vs authored in the report. Perf: animals join the same pooled sprite
path (no new per-frame cost class). Stop before merge.
```

---

## Step 9 — water & waves audit

The sea/river surface IS placed wave objects (`wave */fx wave*` records). Two open questions
recorded in Plan note: our wave loop **phase** is a deliberate deviation (a spatial `hx+hy`
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
   gradient (packages/app/src/content/objects.ts, phase: hx+hy — logged deviation, plan progress note
   "Landscape-object layer" (b)) must revert to phase 0; a spatial pattern → pin it. Decide from
   pixels, not taste; update the code + plan progress note to match the finding.
2. `fx wave*`: investigate what the engine does with them (OpenVikings formats + the records'
   fields; they sit on lmlt=1 void cells). If they are runtime-effect spawn points (foam,
   sparkle) we cannot reproduce yet, document precisely and defer; if they alias to drawable art,
   draw them.
3. Shore bands: compare the shallow-water/shore transition vs the original (the lmms ring lanes
   are decoded but unconsumed — check whether the baked empa/empb patterns already carry the
   whole shore look, i.e. nothing to do).
4. While in the water code: the wave translucency is now the Double8Bit bobs' PER-PIXEL alpha baked
   into the atlas (visible-pixel mean α ≈35/255 over `ls_water.wave01` bobs 0–1; the old flat 0.5
   approximation is deleted — progress log "soft decals"). Verify the resulting water against an
   aligned corpus patch — measure, don't eyeball; if the composite is off, the suspect is
   blending/phase, not a flat constant.

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
   plan progress note. Target: every remaining skip is explained, none is silent.
2. VEGETATION: verify species/palette variants land (e.g. OrangeTree 01 vs 02, yew 01 vs 02 →
   different palettes of the same bmd — the yellow/green canopy mix). Compare a forest patch of
   mosty-5/6 vs ours; if the mix reads off, chase the palette join.
3. PANORAMA: build the acceptance artifact — render our top strip as 7 frames at the corpus
   shots' viewports (derive each shot's offsets by template-matching one landmark per shot, or
   fit like mosty-5 — the kit in docs/plans/map-visual-fidelity.md) and compose aligned
   original-vs-ours pairs for ALL SEVEN shots (mosty-1..7). Present them to the owner in one
   gallery; also hand them the live URL to pan the full map.
4. PLAN SWEEP: the progress log must state exactly what is now faithful/approximated/deferred
   (no stale claims); docs/plans/map-visual-fidelity.md checkboxes all done -> per its own header,
   DELETE the plan file in this final commit.

The owner signs off the look (they are the oracle). Fix-forward anything they flag before
closing. Stop before merge.
```

---

## Progress log (one line per merged step — appended by the executing agent)

Format: `N. <date> — <what landed>; <key numbers/findings>; <deviations from the prompt, if any>.`

- (out of band) 2026-07-10 — soft decals (`fix/grass-patch-blend`, user-reported "dark-green placki
  on grass"): the harsh dark blobs were TYPE-4 (Double8Bit) bobs drawn opaque — the pipeline's
  `decodeBobFrame` skipped each pixel pair's SECOND byte, which is the pixel's 8-bit alpha
  (CBobManager `PrintBob_UsingShadedAlpha`: `[index, alpha]`, `a=alphaByte·(256−shade)/256`,
  src-over — the oracle's best-effort reconstruction, corroborated by the measured distributions;
  the oracle has no call sites, so WHICH records use which blit path is inferred per consumer class
  from those measurements + the corpus). Now `BobFrame.mask` carries 0–255 coverage and the RGB
  atlases bake it (visible-pixel mean α over the named atlas frames: ferns
  `ls_meadows.fern01` bob 24 ≈152, waves `ls_water.wave01` bobs 0–1 ≈35; trees/stones median 255 so
  solid art stays solid). Two OPAQUE exceptions: (a) `[GfxHouse]`-claimed `.bmd`s — their alpha
  bytes are NOT coverage (mean ≈100 over solid walls → 40% ghost buildings), keyed on the `.bmd`
  path alone so every recolour incl. the landscape twins bakes the same (`opaqueAlphaBmds`); (b) the
  INDEXED (player-LUT) atlases — GUI/goods/fonts — flatten because their one shader binarizes alpha
  at 0.5 (a graded bake erodes chrome/icons; graded-indexed = future follow-up with its own visual
  pass). The waves' flat `WAVE_ALPHA=0.5` approximation is DELETED — their translucency is the
  per-pixel data (step 9 item 4 updated). Gates green + real pipeline run; owner's pixel sign-off
  PENDING.
- (out of band) 2026-07-10 — terrain-mesh rebuild (`feat/terrain-mesh-rebuild`, user-authored /worktree
  task): the ground mesh moved off diamond-per-cell onto the ORIGINAL tessellation — triangles
  BETWEEN cell-centre nodes (A=[own,SE,SW], B=[own,E,SE]; source basis: the cultures2-gl/-wasm
  oracle, MIT — docs/SOURCES.md "terrain tessellation"); `emt1..emt4` pinned as per-triangle
  TRANSITION overlays (⌊v/6⌋ → `eatd` name → `transitions.cif` record, v%6 → one of 6 UV pairs;
  NOT roads/foundations — step 7's Part B closed, its prompt narrowed to Part A) and drawn as
  RGBA masked overlays (pipeline composes `tran_*.pcx` + `tran_*_a.pcx` → `<stem>.masked.png`,
  alpha = raw mask index) composited base → layer2 → layer1; ground pages now LINEAR-filtered;
  elevation lift re-pinned to the engine's `elev/16` half-row-steps (`TILE_HALF_H/32` = 1.1875
  px/unit, superseding the 1.2376 fit, which ran ≈4% higher) with border nodes clamped to 0 (a
  named watertight adaptation of the oracle's per-cell zeroing; border-ring elevation is 0 on all
  125 decoded maps); the old centre-split/diamond machinery deleted. Bridge-map lanes:
  8181/8184/267/269 non-empty overlay cells (emt1..4), 38-name eatd. Gates green + real pipeline run; owner's pixel sign-off PENDING
  (sand-grass seam must show organic transitions, no lattice edges).
- 3. 2026-07-08 — `embr` landed end-to-end: pipeline emits it as the optional per-cell `brightness`
  lane (`stages/maps.ts` `brightnessFromMapDat`, all 125 emitted maps carry it; schema refine in
  `@vinland/data`), and the ground shades by it per FRAGMENT — the lane rides as an R8 texture the
  shaded mesh shader samples at canonical-cell-coordinate UVs (`render/gpu/shading.ts`;
  rows padded to UNPACK_ALIGNMENT 4). Response curve MEASURED vs mosty-5: luminance × embr/127 (fit
  1/slope=127.3, intercept −0.06 over 50 aligned ground cells; border embr=0 is literally black in
  the corpus, values >127 brighten up to ≈2× so the multiplier is unclamped). The border fade IS the
  lane (outer 2–3 rows/cols = 0); canvas clear went 0x1a1410→black so the faded edge dissolves like
  the original (sawtooth gone). Geometry: each ground triangle splits at the cell CENTRE (extra
  vertex carrying the cell's own lift+coordinate — corner-only interpolation measurably flattened
  per-cell shading, 0.84 vs expected 0.43 at embr 55). OBJECTS: measured mixed — mine decals, stones
  and grass track the lane (masked opaque-pixel ratio ×0.58→×1.58) and now shade by their anchor
  cell (decor quads per-vertex full-range; tall sprites via tint, which CLAMPS >1 — named
  approximation), while TREES stay full-bright even on embr=0 cells (n=118 canopies) — tree logic
  types exempt by name (`app/content/objects.ts`); buildings/settlers unmeasured (base ≈ neutral),
  left unshaded. Deviation from the prompt: per-vertex colour was implemented, measured insufficient,
  and replaced by the per-fragment lane texture. Verified: side-by-sides vs mosty-5 (edge fade +
  rock-hill relief match; fade profile numerically matches the original within ~¼ row); gates green;
  real pipeline run. Owner's pixel sign-off PENDING (this handoff).
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
- 1. ≤2026-07-05 — `lmhe` emitted as the optional per-cell `elevation` lane
  (`stages/maps.ts` `elevationFromMapDat` + the `TerrainMapFile` schema refine); consumed by step 2's lift.
