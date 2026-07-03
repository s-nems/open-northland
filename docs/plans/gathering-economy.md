# Gathering economy — faithful resource cycle plan (agent prompts)

Goal: implement the original's gathering economy end-to-end — every resource draws its own
graphic; trees are felled over multiple chops and leave a stump + a trunk on the ground that the
collector picks up and carries to the collection point (store or flag); mineral deposits
(stone/iron/gold/clay) visually shrink level by level until they vanish; ground goods and flags
are visible; wood/stone/iron/gold nodes have sub-tile collision and a larger build-exclusion
ring; the chop animation stands the collector NEXT to the tree with a hit → pause → reposition
cadence.

Research basis (2026-07-03), verified against the sources: **the original encodes the gathering
pipeline in readable data.** Key facts (re-verify before coding — this doc is research output,
not ground truth):

- `Data/logic/goodtypes.ini` (readable, base game): each `[goodtype]` carries
  `landscapeToHarvest` / `landscapeToPickup` / `landscapeToStore` + `atomicForHarvesting` — the
  three-stage landscape pipeline per good. Wood: harvest **4** (tree) → pickup **6** (trunk) →
  store **7** (wood pile), atomic 24. Stone: 15 (rock) → 16 (stone_ore) → 17 (stone), atomic 25.
  Mud/clay: 12 → 13 → 14, atomic 26. Iron: 18 → 19 → 20, atomic 27. Gold: 21 → 22 → 23, atomic
  28. Mushroom: 36 → 36 → 37, atomic 32 (no distinct pickup stage). Herb: 33 → 34 → 35, atomic
  31 (+`atomicForCultivating`/`atomicForPlanting`, `isBioLandscapeFlag 1`).
- `Data/logic/landscapetypes.ini` (readable): the lifecycle stages are `[landscapetype]` entries
  with `name` ("tree", "tree falling", "trunk", "wood", "rock", …), `maximumValency`,
  `allowedonland`/`allowedonwater`, and raw `transition <…>` records (semantics only partly
  understood — extract raw, don't guess).
- `DataCnmd/atomicanimations12/atomicanimations.ini`: `viking_collector_harvest_tree` length
  **30**, events: frame 10 stamina/spirit −100, frame 19 effect, frame **20** the harvest
  trigger (`event 20 18`). Stone 29 ticks / harvest @20; mud 23/@20; iron & gold 23/@19;
  mushroom & herb 35/@21. One swing per atomic — **no multi-chop count anywhere in readable
  data** (`humanjobexperiencetypes.ini` has `baserepeatcounter` for farmer/fisher/hunter but NOT
  for collector job 8), and **no tree-yield amount** either → both become named calibration
  constants observed from the original (docs/FIDELITY.md "observed" entries).
- Graphics are ALREADY extracted (866 `[GfxLandscape]` records in `content/ir.json` via
  `extractLandscapeGfx`, `tools/asset-pipeline/src/decoders/ini.ts` ~1685–1728): tree species
  with growth states + a "falling" state (`ls_trees.bmd`), felled debris/trunks
  (`ls_trees_dead.bmd`), per-good ground piles with ~5 fill states (`ls_goods.bmd`, also
  `ls_goods_s.bmd`), mineral deposits with level variants (`ls_ground.bmd`: clay/iron/gold
  mines), mushrooms (`ls_mushrooms.bmd`, animated), player-coloured flag signs (`ls_temp.bmd`).
  Each record carries `editName`, `frames` per state, `isStatic`/`loopAnimation`, **and
  `walkBlockAreas` / `buildBlockAreas` / `workAreas` footprints** — collision is data, not
  guesswork.
- Current code seams (research-time line refs): sim `Resource{goodType, remaining,
  harvestAtomic}` with single-hit `harvestFromNode` (`packages/sim/src/systems/conflict/atomic.ts`
  ~164, `HARVEST_YIELD = 1`); depleted nodes skipped but never removed (`ai/ai-targets.ts` ~93);
  ground pile = bare `Stockpile+Position` with no `Building` + porter drive + `deliveryTargetFor`
  (`ai-supply.ts`) — the flag machinery EXISTS sim-side but renders as nothing
  (`packages/render/src/data/scene.ts` classify → null); render binds every resource to one
  hardcoded tree bob (`packages/app/src/content/settler-gfx.ts` ~181); buildings already have
  footprint walk-block + build-exclusion + door cells (`packages/sim/src/systems/footprint.ts`)
  and `canPlaceBuilding` already refuses to build over Resource nodes; **map objects are
  render-only decor** (`packages/app/src/entries/live.ts` ~102–111) — they never become sim
  entities.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs. Prompts are self-contained; they also
tell the agent to re-verify facts against the sources. Check a box when the step is merged;
delete this file when all steps land.

- [ ] 1. Pipeline: resource-lifecycle logic tables → IR/content
- [ ] 2. Render: per-good resource nodes + ground piles + flags visible
- [ ] 3. Sim: wood cycle — multi-chop fell → trunk on ground → pickup → deliver
- [ ] 4. Sim: mineral deposits shrink by level; mushrooms
- [ ] 5. Sim: resource collision + build-exclusion from data
- [ ] 6. App: imported maps spawn real resource nodes
- [ ] 7. Polish: chop cadence, adjacent stance, animation timing

Out of scope for this plan: tree regrowth/spreading and herb/mushroom cultivation (the bio
transitions — `isBioLandscapeFlag`, `atomicForPlanting`), bush/fruit growth stages, farming/
fishing/hunting jobs, vehicle logistics, and the minimap. Calibration constants (chop count,
yields, deposit sizes) are data + FIDELITY entries, refined later by observing the original.

---

## Step 1 — pipeline: resource-lifecycle logic tables

```text
Extract the original's gathering-pipeline logic tables into the IR + content so later slices can
consume them: the per-good landscape pipeline, the landscape-type lifecycle, and the landscape
block-area footprints.

Context (research findings, 2026-07-03 — re-verify against the sources before coding; game root
= "../Cultures 8th Wonder" relative to the repo root, read-only; prefer the mod's readable files
per CLAUDE.md, but note the mod ships no overriding base logic tables — the base
`Data/logic/*.ini` here are already plaintext):
- `Data/logic/goodtypes.ini`: each `[goodtype]` has `landscapeToHarvest` / `landscapeToPickup` /
  `landscapeToStore` (landscape type ids for the three gathering stages) + `atomicForHarvesting`
  (+ `atomicForCultivating`/`atomicForPlanting`, `isBioLandscapeFlag`, `landscapetype`). Wood:
  4→6→7 atomic 24; stone: 15→16→17 atomic 25; mud: 12→13→14 atomic 26; iron: 18→19→20 atomic 27;
  gold: 21→22→23 atomic 28; mushroom: 36→36→37 atomic 32; herb: 33→34→35 atomic 31. The existing
  goods extractor (tools/asset-pipeline/src/decoders/ini.ts) already reads some fields
  (`atomicForHarvesting`) — EXTEND it, don't duplicate.
- `Data/logic/landscapetypes.ini`: `[landscapetype]` entries with `type`, `name` (e.g. type 4
  "tree", 5 "tree falling", 6 "trunk", 7 "wood", 15 "rock", 16 "stone_ore", 17 "stone", 12–14
  mud, 18–20 iron, 21–23 gold, 33–35 herb, 36–37 mushroom, 8–11 bush growth), `maximumValency`,
  `allowedonland`/`allowedonwater`, and raw `transition …` tuples. The transition semantics are
  NOT fully decoded — extract the raw tuples + the decoded fields, and document conservatively in
  docs/SOURCES.md what is known vs raw (never guess semantics into the schema).
- `[GfxLandscape]` records (already extracted by `extractLandscapeGfx`, decoders/ini.ts
  ~1685–1728) carry `editName`, per-state `frames`, and `walkBlockAreas`/`buildBlockAreas`/
  `workAreas`. VERIFY these fields survive into the zod schema (packages/data) and the emitted
  content JSON the app loads — expose them if they currently stop at the IR.
- Find the JOIN between the gfx records and the logic landscape-type ids (the houses analogue is
  `[GfxHouse] LogicType`): locate the field in landscapes.cif gfx records that names/points at
  the `[landscapetype]` id. If no such field exists, determine and document the actual join key
  (the map-object path joins by `editName` today). Later slices need: goodType → its three
  landscape stage ids → each stage's gfx record. Emit that resolved join into the IR (e.g. a
  `gatheringPipeline` artifact: per goodType, the harvest/pickup/store landscape ids + their gfx
  record refs) so consumers don't re-derive it.

Deliverables:
1. Extractor(s) in tools/asset-pipeline/src (extend the existing ini decoders/stage wiring):
   `[landscapetype]` table + the new `[goodtype]` fields + the resolved gathering-pipeline join,
   validated by zod schemas in packages/data, emitted into content by `npm run pipeline`.
2. docs/SOURCES.md: a "gathering pipeline" section (files, sections, fields, the transition-tuple
   caveat, the gfx↔logic join).
3. Unit tests on synthetic fixtures for every new extractor (existing pipeline test patterns;
   never commit real game bytes — content/ stays gitignored).

Verification:
- Run the real pipeline end-to-end:
  `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`
  then inspect the emitted JSON: the wood pipeline must read 4→6→7/atomic 24 and every good in
  the table above must resolve its three stages to real gfx records (report any that don't).
- `npm test` and `npm run check` green.

Guardrails: read-only outside this repo; follow tools/asset-pipeline/CLAUDE.md (facts from
OpenVikings, never its architecture); data only — no sim behavior change, goldens must not move.
```

## Step 2 — render: nodes per good, ground piles, flags

```text
Make the gathering economy VISIBLE: every resource node draws its own graphic (not the hardcoded
yew tree), dropped goods on the ground draw as per-good piles, and delivery flags draw as flags.
This lands the two rung-2 roadmap bullets ("Resource nodes by goodType", "Loose ground piles +
flags rendering") — tick them in docs/ROADMAP.md when done.

Context (research-time line refs — re-verify):
- packages/render/src/data/scene.ts: `DrawKind = 'tile'|'building'|'settler'|'resource'` (~46);
  `classify()` (~204) returns null for a bare `Stockpile+Position` entity (a dropped pile or a
  delivery flag — the sim machinery already exists in ai-supply.ts), so both are INVISIBLE
  today; `DrawItem` (~65–137) has `typeId` for tiles/buildings but nothing for resources;
  `collectSprites()` (~433–493) never reads `Resource.goodType`.
- packages/render/src/data/sprites.ts: `SpriteBindings.resource` is a plain number (~232);
  `resolveSpriteBobId()` (~374–382) returns it directly. Mirror the existing per-type patterns:
  `BuildingTypeBinding` (~193–207) and the per-good `CarryingBinding` (~154–161).
- packages/app/src/content/settler-gfx.ts ~181 hardcodes `resource: TREE_BOB` (bob 60 of
  `ls_trees.tree_yew01`, constants in building-gfx.ts ~29). `buildHumanBindings()` (~127–183) is
  where bindings are composed from extracted data.
- Step 1 emitted the gathering-pipeline join: goodType → harvest/pickup/store landscape stage ids
  → `[GfxLandscape]` gfx records (866 records with editName, per-state frames, atlas refs). Use
  it to pick, PER GOOD: the standing-node graphic (the `landscapeToHarvest` stage record — tree
  species for wood, rock for stone, mine decals for clay/iron/gold, mushroom for mushroom) and
  the ground-pile graphic (the `landscapeToStore` stage record — `ls_goods.bmd` piles, which
  research says have ~5 fill states; verify in content/ir.json). Flag sprites: player-coloured
  sign records exist in `ls_temp.bmd` (editNames like "player01 sign …" — verify names in the
  IR); v1 uses the player-01 colour (a per-player palette swap is a follow-up — note it in the
  commit).

Scope:
1. `DrawItem` gains `goodType` (and whatever minimal field distinguishes pile-vs-flag); a new
   'stockpile' DrawKind; `classify()` maps bare `Stockpile+Position` (no Building) to it;
   `collectSprites()` reads `Resource.goodType` / stockpile contents through the snapshot
   read-view seam (render must NOT touch live component stores — packages/render/CLAUDE.md).
2. A `ResourceTypeBinding { byGood, default }` (+ the stockpile analogue: per-good pile frames by
   fill level, flag sprite for an empty/designated flag) in sprites.ts; `resolveSpriteBobId()`
   resolves through them; settler-gfx.ts builds them from the Step-1 content join instead of
   TREE_BOB (keep TREE_BOB as the default fallback).
3. Load the needed atlases (ls_goods, ls_ground, ls_mushrooms, ls_temp families) alongside the
   existing ones — mirror how tree/house atlases are loaded today.
4. An acceptance scene `?scene=gathering` (packages/app/src/scenes/, registered in
   scenes/index.ts): one node of each gatherable good + ground piles of several goods at several
   fill amounts + a delivery flag, real graphics. Headless half asserts classify() + binding
   resolution per good (packages/app/test/scenes.test.ts).

Verification: `npm test` + `npm run check` green; run the pipeline if content/ is stale; end by
surfacing `npm run dev` → `http://localhost:5173/?scene=gathering` + a visual checklist (each
good's node visibly distinct; piles look like piles of THAT good and grow with amount; the flag
reads as a flag) and ask for human sign-off — an agent cannot self-judge pixels. Record any
frame-pick approximations in docs/FIDELITY.md.

Guardrails: render cost scales with the screen (retained renderer rules,
packages/render/CLAUDE.md); no sim change — goldens must not move.
```

## Step 3 — sim: the wood cycle (fell → trunk → pickup → deliver)

```text
Replace the single-hit wood harvest with the original's observed cycle: the collector chops a
standing tree repeatedly; the tree falls; a STUMP stays at the spot and a TRUNK (the felled wood)
lies on the ground holding the tree's whole yield; the collector picks the wood up and carries it
to his collection point (store or flag); the depleted node is REMOVED. This is the roadmap item
"Faithful multi-hit harvest + drop-on-ground" (Phase 3) — tick it when done.

Context (re-verify; research 2026-07-03):
- Original data pins the STRUCTURE: goodtype wood = landscapeToHarvest 4 (tree, chop atomic 24)
  → landscapeToPickup 6 (trunk) → landscapeToStore 7 (wood pile); landscapetypes.ini names the
  stages tree → "tree falling" → trunk → wood. The chop atomic
  (`viking_collector_harvest_tree`, atomicanimations.ini) is 30 ticks, ONE swing per atomic.
  Original data does NOT carry: the number of chops to fell, nor the wood units per tree
  (verified absent — no baserepeatcounter for collector job 8). Both are OBSERVED calibration
  constants → content data fields (golden rule 3: data, not code) + docs/FIDELITY.md entries
  marked "observed, pending calibration against the original".
- Current sim (research-time refs): `Resource{goodType, remaining, harvestAtomic}`
  (packages/sim/src/components/economy.ts ~51); one atomic completion = 1 unit teleported onto
  the settler's back (`harvestFromNode`, systems/conflict/atomic.ts ~155–169); depleted nodes
  are skipped forever (ai/ai-targets.ts ~93). The DELIVERY half already exists and is reused
  as-is: ground pile = bare `Stockpile+Position` (no Building), `nearestGroundPile` +
  `deliveryTargetFor` + the porter drive (ai-supply.ts), pickup atomic id 22, planner steps in
  ai.ts (~118–356). Step 2 made piles/flags/nodes visible.

Design (follow unless you find a strong reason — then record it):
1. Extend the wood node with fell progress (chops-remaining counter or work accumulator on
   `Resource` — a new field, not a magic number; the chop count comes from content). Each chop
   atomic completion decrements it and yields NOTHING onto the back.
2. On the last chop: remove the standing node (planner must never see it again — fixes the
   ai-targets skip-forever); spawn at its cell (a) a ground-pile entity (bare
   `Stockpile+Position`) holding `treeWoodYield` wood — this IS the trunk, and the existing
   pickup/porter/delivery machinery consumes it unchanged; (b) a stump decor entity
   (non-blocking, not harvestable — decide its component shape; render draws it via the Step-2
   machinery from the felled/debris gfx records in `ls_trees_dead.bmd` / the tree record's
   felled state — verify editNames in content/ir.json). Emit a typed SimEvent (e.g.
   `resourceFelled`) through ctx.events for the render side.
3. The felling collector then PICKS UP from that pile (planner: after felling, prefer your own
   trunk pile) and delivers via `deliveryTargetFor`; multiple trips if yield > carry capacity.
4. Other goods (stone/clay/…) keep the current single-hit behavior in this step — Step 4 owns
   them (they share the drop-to-ground shape but per UNIT, with the node persisting and
   shrinking; wood is fell-once-whole-yield). Gate the wood path on the felling lifecycle from
   Step-1 content (the tree→falling→trunk landscape transitions), not on a hardcoded goodType,
   and shape the drop/pickup machinery so Step 4 can reuse it.
5. The "tree falling" ANIMATION stage is render polish — deferred to Step 7; v1 swaps standing →
   stump+trunk instantly (note in FIDELITY.md).

Verification (this MOVES goldens — that is expected and must be intentional):
- Unit tests: fell-progress decrement, node removal, trunk-pile spawn with exact yield, stump
  spawn; planner fell-vs-pickup split.
- Headless scenario (packages/sim/test): woodcutter + tree + store → after N ticks the store
  holds exactly `treeWoodYield` wood, the node entity is gone, a stump exists; wood is CONSERVED
  (chopped tree yields exactly its constant, no dupes/losses) — assert as an invariant.
- Update the golden state-hash + atomic-trace tests intentionally, naming the mechanic in the
  commit (packages/sim/CLAUDE.md golden discipline). Extend the `?scene=gathering` acceptance
  scene: watch chop→fall→carry→pile-at-flag; headless half asserts the cycle; end with the dev
  URL + checklist + ask for human sign-off.
- `npm test` + `npm run check` green; docs/FIDELITY.md updated (chop count, yield, instant-fell).

Guardrails: sim purity (no Math.random/Date — variation only via world.rng; canonical iteration
order; fixed-point rules — packages/sim/CLAUDE.md); per-tick cost scales with active WORK, no
full-world scans (golden rule 7); events via ctx.events, render never reaches into stores.
```

## Step 4 — sim: mineral deposits shrink by level

```text
Implement mining: stone/iron/gold/clay deposits hold multiple units; each mined unit drops on
the ground as ore, is picked up and carried to the collection point; the deposit's GRAPHIC steps
down a level as it empties and the node disappears when exhausted. Mushrooms are a trivial
pickup variant.

Context (re-verify; research 2026-07-03):
- Original pipeline per good (Step-1 content): stone rock(15)→stone_ore(16)→stone(17) atomic 25
  (29 ticks, harvest event @ frame 20); mud/clay 12→13→14 atomic 26 (23t, @20); iron 18→19→20
  atomic 27 (23t, @19); gold 21→22→23 atomic 28 (23t, @19); mushroom 36→36→37 atomic 32 (35t,
  @21 — no intermediate stage, direct pickup). The distinct pickup stage (stone_ore / iron_ore
  / gold_ore / mud_ore) means minerals FOLLOW THE DATA's drop-to-ground shape, like wood's
  trunk: each harvest atomic completion drops 1 unit as an ore ground-pile at the deposit's
  cell (reuse the Step-3 drop/pickup machinery — bare `Stockpile+Position`, drawn by Step 2
  from the pickup-stage gfx record), then the collector picks it up and delivers via
  `deliveryTargetFor`. Record in docs/FIDELITY.md as data-pinned (the `landscapeToPickup`
  stage). Batching is UNKNOWN (chip several units before picking up, or carry each one?) — v1:
  let the existing pickup take whatever lies there up to carry capacity; note as
  observed-pending-calibration against the original.
- Deposit SIZE (units per deposit) is not in readable data → per-good calibration constants in
  content data + FIDELITY "observed" entries (like Step 3's tree yield).
- Visual levels: the deposit gfx exist in `ls_ground.bmd` records (clay/iron/gold mines — the
  IR shows level variants; VERIFY in content/ir.json whether levels are multiple `frames`
  states within one record or separate editName records, and bind accordingly). Wire: sim
  computes a small integer level from remaining/initial (integer math, deterministic), exposes
  it through the snapshot read-view into `DrawItem`; the Step-2 `ResourceTypeBinding` grows a
  per-level frame pick. Depletion: remove the node (Step-5 collision must unblock via the same
  removal path); if the IR has an empty-pit decor state, leave it, else leave nothing (FIDELITY
  note).
- Mushrooms: one pickup (atomic 32) yields the unit and removes the node; regrowth/cultivation
  is out of scope (leave a docs/ROADMAP.md note under the gathering items).
- Clay blocks NO movement (that's Step 5's data-driven concern — nothing to do here beyond not
  assuming collision).

Verification: unit tests (level function boundaries: full→N levels→gone; exact total yield =
deposit size); headless scenario (miner chips a deposit → ore piles appear at it → everything
lands in the store; node removed; ore conserved — no dupes/losses); goldens
updated intentionally; extend `?scene=gathering` — a deposit visibly steps down levels while
mined (headless asserts the level read-view; human signs off the pixels). `npm test` +
`npm run check` green; FIDELITY.md updated.

Guardrails: same as Step 3 (determinism, golden discipline, no full-world scans, data not code).
```

## Step 5 — sim: resource collision + build-exclusion from data

```text
Give resource nodes their original footprints: wood/stone/iron/gold nodes block MOVEMENT
(sub-tile objects you can stand next to but not on), clay and mushrooms don't; every node also
projects the original's larger BUILD-exclusion area. Collectors must stand on an adjacent cell
to work, not on the node.

Context (re-verify; research 2026-07-03):
- The footprints are DATA: every `[GfxLandscape]` record carries `walkBlockAreas` /
  `buildBlockAreas` / `workAreas` (extracted in decoders/ini.ts ~1710, exposed to content in
  Step 1). Consume the node's own record's areas — do NOT hardcode which goods block; the
  expectation from the user's observation of the original is wood/stone/iron/gold block walking
  while clay/mushrooms don't. VERIFY the data agrees (e.g. the clay-mine record's walkBlockAreas
  should be empty); if data and observation disagree, STOP and surface it to the user — never
  silently pick one.
- Interpret the area coordinates EXACTLY like the house footprints already do — buildings
  consume `[GfxHouse] LogicWalkBlockArea`/`LogicBuildBlockArea` via
  packages/sim/src/systems/footprint.ts (`buildingBlockedCells` ~99–122, `canPlaceBuilding`
  ~150–199, door/`interactionTile` ~46–61). Sim collision granularity stays the CELL (positions
  are integer cells; half-cells are a render concern — docs/SOURCES.md).
- PERF (golden rule 7): buildings re-derive their blocked set per tick, which is fine for tens
  of buildings but NOT for thousands of trees. Maintain the resource blocked-set INCREMENTALLY:
  build once at load, update on node spawn/removal (the Step-3/4 removal paths), never a
  per-tick full-world scan. Keep it deterministic (pure function of state, no iteration-order
  leaks); document the pattern in packages/sim/CLAUDE.md if you extend it.
- Placement: `canPlaceBuilding` already refuses to build over Resource nodes with the
  building-margin rule (~173–176); upgrade it to the node's own `buildBlockAreas` ring so
  "can't build right next to a resource" is pinned to data.
- Standing adjacent: the harvest walk-target must become a free NEIGHBOR cell of the node
  (mirror the buildings' `interactionTile` pattern), facing the node. This changes pathing and
  MOVES goldens (intentional). Precise stance/anchor polish is Step 7 — here it only has to be
  the correct cell.

Verification:
- Unit tests: blocked-set incremental add/remove equals from-scratch derivation (property
  check); pathfinder detours around a blocking node; a settler can stand on every free neighbor
  cell; clay/mushroom nodes are walkable-through; placement rejected inside a node's
  buildBlockAreas ring and accepted outside it.
- Headless scenario: woodcutter routes AROUND a tree line to reach a target; collector works a
  tree from an adjacent cell. Goldens updated intentionally.
- Scene: extend `?scene=gathering` (or a small dedicated one) — settlers visibly walk around
  nodes, never through; human sign-off. `npm test` + `npm run check` green; FIDELITY.md notes
  the cell-granularity approximation of the sub-tile footprints.

Guardrails: determinism (the blocked set must be a pure function of sim state); perf doctrine
(packages/sim/CLAUDE.md "Scaling to thousands"); no render reach-in.
```

## Step 6 — app: imported maps spawn real resource nodes

```text
Make decoded original maps PLAYABLE for gathering: map-placed trees/deposits/mushrooms become
real sim Resource entities (harvestable, colliding), instead of render-only decor.

Context (re-verify; research 2026-07-03):
- Today `?map=<id>` loads `content/maps/<id>.json` and hands the `objects` layer straight to the
  renderer (`packages/app/src/entries/live.ts` ~102–111 → `renderer.setMapObjects`,
  `packages/app/src/content/objects.ts` joins placements to `[GfxLandscape]` records by
  editName; placements are half-cell coords). NOTHING reaches the sim — there is no
  spawn-resource command.
- Step 1 emitted the join needed to decide which placements are RESOURCES: placement editName →
  gfx record → logic landscape type id → is it some good's `landscapeToHarvest` (or
  `landscapeToPickup`/`landscapeToStore` — decide + document how to treat pre-placed trunks and
  piles; simplest v1: only harvest-stage objects spawn nodes). Everything else stays decor.
- A related-but-separate roadmap item imports `map.cif` `StaticObjects`
  (sethouse/sethuman/setanimal) — this step covers only the RESOURCE objects from the map.dat
  `objects` lane; check whether that sibling item has landed and coordinate (don't collide, do
  reuse its command/seam shape if present).

Scope:
1. A deterministic spawn path (a sim command or a world-construction step — mirror how the app
   currently seeds entities) that turns qualifying placements into Resource nodes: goodType +
   the Step-3/4 content constants (chops/yield/deposit size) + cell position (half-cell → cell
   snap; document rounding). The Step-5 collision set is built once from them at load.
2. De-duplicate drawing: spawned nodes draw through the sim path (Step 2); REMOVE them from the
   decor layer passed to setMapObjects (never double-draw the same tree).
3. Scale proof (golden rule 7): load the biggest decoded map with real graphics; measure
   ms/tick and fps (the FPS overlay exists). Thousands of nodes must not regress the sim (the
   planner's nearest-resource scan is bounded by candidate lists + dormancy — verify, don't
   assume; if it regresses, fix within this step's scope or STOP and report). Headless FPS is
   software-GL — judge fps on the real GPU, use headless only for no-crash/tick-cost.
4. Tests: a SYNTHETIC fixture map (tests never use real game data) with a handful of object
   placements → exact expected nodes spawn, deterministically (same seed + map → same
   entities); decor/node split covered; goldens for a scenario on the fixture map.

Verification: `npm test` + `npm run check` green; then the human check — `npm run dev` →
`?map=<id>` on a real decoded map: trees/deposits are solid (walk-around), a placed collector
camp actually harvests them, no double-drawn or vanished objects; report tick-cost/fps numbers.

Guardrails: content/ stays gitignored; determinism (spawn order canonical); coordinate with the
StaticObjects roadmap item; read packages/app/CLAUDE.md for the entry/scene conventions.
```

## Step 7 — polish: chop cadence, adjacent stance, animation timing

```text
Make gathering LOOK right: the collector stands beside the tree with the axe striking the trunk;
the rhythm is the original's hit → short pause → small reposition (or same angle) → hit; pickup/
deposit animations play fully; atomic timings come from data.

Context (re-verify; research 2026-07-03):
- Data: `viking_collector_harvest_tree` (atomicanimations.ini, mod copy under
  DataCnmd/atomicanimations12/) is length 30 with the harvest trigger `event 20 18` (frame 19
  effect cue, frame 10 stamina/spirit costs). The extracted `events` already land in the IR
  (`extractAtomicAnimations`). docs/FIDELITY.md currently notes the render impact frame is
  APPROXIMATED (~frame 8 of the 16-frame chop bobseq, phaseStart 9) — resolve or update that
  entry against the data.
- Verify `atomicDuration` (readviews/animations.ts) actually resolves the real 30-tick length
  through the `setatomic` binding chain for harvest atomics in real content — if it falls back
  to DEFAULT_ATOMIC_DURATION (4), fix the binding, not the constant.
- Known roadmap bug (Phase-3 item, same bullet as Step 3): pickup/deposit animations are choppy
  — the render advances 1 frame/tick while the atomic is shorter than the animation (19-frame
  `generic_pick_up` in a 4-tick atomic). Fix: pin those atomic durations to their animation
  lengths in content (`atomicBindings`/`atomicAnimations`) so each plays exactly once, fully.
- Cadence: the original (USER OBSERVATION — record in FIDELITY.md as observed) does not swing
  continuously: strike → a brief idle beat → a small step/turn to a new angle (sometimes the
  same) → next strike. Between Step-3 chop atomics, insert a short interruptible idle and an
  occasional deterministic stance variation — facing/adjacent-cell re-pick driven by world.rng
  (NEVER Math.random), cadence parameters as named content constants.
- Stance & alignment: the collector works from an adjacent cell (Step 5); align facing + the
  render anchor (half-cell offsets) so the axe head meets the trunk across all the adjacent
  positions that occur. An agent CANNOT self-judge pixels: use the `?scene=gathering` scene plus,
  if helpful, a labeled montage or a short GIF per facing (docs/lessons — the montage technique)
  and let the user be the oracle. Same for the optional stretch: play the tree's "falling" gfx
  state (the `[GfxLandscape]` falling frames / landscape type 5) as a render transient on the
  Step-3 `resourceFelled` event before swapping to stump+trunk — do it only if the frames are
  there and it stays render-side; else leave the FIDELITY note as-is.

Verification: headless — cadence state machine deterministic (two same-seed runs identical;
goldens updated intentionally if the planner sequence changes); atomic durations for
harvest/pickup/deposit assert against content data, not constants. `npm test` + `npm run check`
green. End with `npm run dev` → `?scene=gathering` + a checklist (axe meets trunk from every
stance; strike lands on the data's event frame, no sliding/moonwalking; the pause+reposition
rhythm reads like the original; pickup plays once, fully) and ask for human sign-off; update
docs/FIDELITY.md (impact frame now data-pinned; cadence observed; falling state done/deferred).

Guardrails: sim determinism (world.rng only); render never mutates sim; keep the golden
discipline (name the mechanic when a golden moves).
```
