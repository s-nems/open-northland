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
  constants observed from the original (plan progress note "observed" entries).
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
  render-only decor** (`packages/app/src/entries/map.ts` ~102–111) — they never become sim
  entities.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs. Prompts are self-contained; they also
tell the agent to re-verify facts against the sources. When a step merges, tick its box and delete its prompt block
(the checkbox line and progress note carry the state; git history keeps the prompt). Delete this
file when all steps land.

- [x] 1. Pipeline: resource-lifecycle logic tables → IR/content — **landed:** `GoodType.gathering`/
      `.landscapeType`, `LandscapeType.name`/raw `.transitions`, and the resolved `gatheringPipeline`
      join (11 goods, all stages resolve to real `[GfxLandscape]` records). See docs/SOURCES.md
      "Gathering pipeline" + plan progress note.
- [x] 2. Render: per-good resource nodes + ground piles + flags visible — **landed:** `ResourceTypeBinding`
      + `StockpileBinding` (a new `'stockpile'` `DrawKind`) built from the Step-1 `gatheringPipeline` join;
      each good draws its own node/pile, an empty pile the flag. Acceptance scene `?scene=gathering`. See
      plan progress note "Gathering-economy graphics".
- [x] 3. Sim: wood cycle — multi-chop fell → trunk on ground → pickup → deliver — **landed:** a
      `Felling{chopsLeft}` marker (stamped from content `gathering.chopsToFell`) turns each chop atomic into
      a decrement; the last chop DESTROYS the standing node and drops a `GroundDrop` trunk (the whole yield)
      + a `Stump`, emitting `resourceFelled`; the feller prefers its own fresh trunk, then delivers a load at
      a time via the existing porter machinery. Render refinements from the visual review: the freshly-felled
      trunk draws its own `landscapeToPickup` graphic (a `grounddrop` DrawKind, distinct from the delivered
      `landscapeToStore` heap), the delivery flag stays planted UNDER its heap, and the chop swing is ONE full
      strike per atomic (`HARVEST_SWING_LENGTH` — the swing-length half of Step 7, done early). Felling pace
      is ONE global calibration (`catalog/felling.ts`). See plan progress note "Multi-hit harvest / felling".
- [x] 4. Sim: mineral deposits shrink by level; mushrooms — **landed:** a mined good carries a
      `MineDeposit{initial,levels}` (stamped from content `gathering.depositSize`/`depositLevels`): each
      harvest atomic chips one unit and drops it at the deposit's cell as an ore `GroundDrop` (reusing
      Step-3's drop/pickup/deliver machinery), the deposit shrinks a visual level (`depositVisualLevel` →
      `DrawItem.level` → per-level `ResourceTypeBinding` frames), and the node is REMOVED at 0
      (`resourceDepleted`). A mushroom is the trivial neither-marker direct pickup (onto the back + remove).
      See plan progress note "Mineral deposits"; `?scene=gathering` runs a live mud-deposit mining cycle.
- [x] 5. Sim: resource collision + build-exclusion from data — **landed:** `ResourceFootprint` is
      stamped from the harvest-stage `[GfxLandscape]` `walkBlockAreas`/`buildBlockAreas`/`workAreas`,
      resource walk-blocks feed pathfinding through `dynamicBlockedCells`, `canPlaceBuilding` respects a
      node's build-exclusion zone, and the planner resolves harvest/drop targets through data-driven work
      cells. `?scene=gathering` now stamps footprints for every lane; clay/mushrooms remain non-blocking.
- [ ] 6. App: imported maps spawn real resource nodes
- [ ] 7. Polish: chop cadence, adjacent stance, animation timing — **swing length already landed with Step 3**
      (`HARVEST_SWING_LENGTH` = one full strike per chop atomic). STILL OPEN (the two the user flagged in the
      Step-3 review): (a) pickup/deposit play a real bend animation (`human_man_generic_pick_up`, 19 frames,
      currently UNBOUND → the item pops in/out) with a GLOBAL duration constant, not per-scene; (b) the
      strike → brief idle → reposition cadence between chops. Step 5 landed the sim-side adjacent work cell;
      render-facing/anchor polish remains here.
- [ ] 8. Pipeline+sim: builder stand cells from `LogicConstructionWorkArea`. The mod's `[GfxHouse]`
      records (`DataCnmd/budynki12/houses/houses.ini`) carry per-building
      `LogicConstructionWorkArea <sizeIdx> <dx> <dy> <run>` rows — the building analog of the landscape
      `workAreas` Step 5 already consumes — but `extractBuildingFootprints`
      (`tools/asset-pipeline/src/decoders/ini.ts`, which already parses the sibling
      `LogicWalkBlockArea`/`LogicBuildBlockArea`/`LogicDoorPoint` keys) skips the key. Extract it into the
      building-footprint IR and have the builder work-slot claim (`claimWorkCell`,
      `packages/sim/src/systems/agents/destack.ts`) draw a site's stand cells from the site's own area
      instead of today's uniform door-anchored yard (`WORK_YARD_RADIUS_NODES` — a placeholder
      approximation flagged by review 2026-07-11); confirm the row semantics against OpenVikings before
      trusting the shape.

Out of scope for this plan: tree regrowth/spreading and herb/mushroom cultivation (the bio
transitions — `isBioLandscapeFlag`, `atomicForPlanting`), bush/fruit growth stages, farming/
fishing/hunting jobs, vehicle logistics, and the minimap. Calibration constants (chop count,
yields, deposit sizes) are data + plan progress notes, refined later by observing the original.

**Landed beyond the numbered steps — flag-bound gatherer AI (2026-07-10, `feat/gatherer-flags`):**
the user-specified collector model. A gatherer now carries a `WorkFlag{flag,radius}` and (1) harvests
only nodes within `radius` of its flag, (2) carries off only the trunk/ore IT dug (`HarvestedBy` marks
each drop's harvester), leaving loose piles alone, (3) banks its harvest at that flag, and (4) stands
idle beside the flag when nothing is in reach. Both components are opt-in — a flagless gatherer keeps
the roam-and-haul behaviour, so the golden slice is byte-identical. Sandbox lanes bind each gatherer to
its flag via the new `createSettler` helper. The radius is a named approximation (`DEFAULT_WORK_FLAG_RADIUS`
— the original's collector work-area size is not decoded). **Relevant to Step 6:** map-spawned gatherers
will need the same flag binding (place a flag + bind, or an auto-assign step) to inherit this behaviour;
a map-placed collector with no WorkFlag falls back to roaming.

**Interactive flag control (same branch):** a `setWorkFlag` command (Ctrl+Right-Click on a selected
gatherer) places/relocates that gatherer's flag on the clicked node — a fresh flag is created + bound, or
the existing one is moved. Flags carry a `DeliveryFlag` marker; render draws the flag graphic and paints it
just ABOVE any co-located goods heap (`FLAG_PAINT_STEP`, applied in both the headless oracle sort and the
live painter's zIndex). The selected gatherer's flag is highlighted with an amber ring (distinct from the
green selection ring). The selectable sandbox cluster are gatherers too, so each is bound to a flag at its
spawn (they idle by it instead of roaming); the player sends them to work with Ctrl+Right-Click.

**Goods pile on the GROUND, not on the flag (storage physics, same branch):** a `DeliveryFlag` is now a
PURE marker (`Position + DeliveryFlag`, no `Stockpile`). The gatherer PHYSICALLY carries each load to a free
yard tile and sets it down where it stands — the planner picks the target tile (`nearestFreeYardNode`:
nearest HALF-CELL node around the flag with room, spiralling out) and walks there; `pileupIntoStore` then
drops onto that tile via `dropCarryAtOwnTile`, capped at `MAX_GROUND_STACK` (5, the `ls_goods` fill states),
snapped to the settler's half-cell node so drops stack and heaps pack tile-to-tile. Any spill past the cap
stays on its back and the next delivery walks it to the next tile — nothing teleports. Each heap is a bare
`Stockpile+Position` pinned to its half-cell — so relocating the flag moves ONLY the marker; the goods stay
put (both reported bugs). An emptied loose heap is reaped (`reapEmptyLoosePile`), and the "settled ground
heap" test is the one shared `isYardHeap` predicate. Heaps are the loose piles porters (`nearestGroundPile`)
haul to warehouses. Golden untouched (no flags in the golden slice); the per-heap cap follows the decoded
`ls_goods` fill states, while the yard extent/spacing are named approximations (undecoded). Perf:
`nearestFreeYardNode` is an `O(candidates)`-index economy scan like the others here — the shared
`NodeBuckets` follow-up in `sim-perf.md` covers it.

**Flag ↔ profession lifecycle + click-to-select (2026-07-10, `fix/gatherer-flag-lifecycle`):** the flag
now exists exactly while its settler is a gatherer. Changing a profession INTO a gathering trade plants a
bound `DeliveryFlag` at the settler's feet (the profession-change twin of the first Ctrl+Right-Click);
changing OUT of one (or the gatherer dying) destroys the flag and drops the `WorkFlag`, so a former
gatherer never strands an owner-less flag (the user's "flaga powinna zniknąć"). The sync lives in the one
shared `reidleAsJob` (so `setJob` and `assignWorker` can't drift) via `syncWorkFlagToJob`; the death path
reaps the flag in `cleanupSystem`; flag creation is the one shared `bindFreshFlag`, reused by
`setWorkFlag`. Left-clicking a flag selects its gatherer — `gathererByFlag` (app `game/snapshot.ts`)
inverts the `WorkFlag` edge (a flag stores no back-reference), consulted as a fallback after
settlers/buildings miss. Golden untouched (it plants no flags); the create/destroy paths ride the fuzz
determinism stream. Verified: `npm test`/`check`/`build`; flag-click→select confirmed on `?scene=sandbox`
(the profession-picker plant/drop flow is the user's browser sign-off).

---

## Step 6 — app: imported maps spawn real resource nodes

```text
Make decoded original maps PLAYABLE for gathering: map-placed trees/deposits/mushrooms become
real sim Resource entities (harvestable, colliding), instead of render-only decor.

Context (re-verify; research 2026-07-03):
- Today `?map=<id>` loads `content/maps/<id>.json` and hands the `objects` layer straight to the
  renderer (`packages/app/src/entries/map.ts` ~102–111 → `renderer.setMapObjects`,
  `packages/app/src/content/objects.ts` joins placements to `[GfxLandscape]` records by
  editName; placements are half-cell coords). NOTHING reaches the sim — there is no
  spawn-resource command.
- Step 1 emitted the join needed to decide which placements are RESOURCES: placement editName →
  gfx record → logic landscape type id → is it some good's `landscapeToHarvest` (or
  `landscapeToPickup`/`landscapeToStore` — decide + document how to treat pre-placed trunks and
  piles; simplest v1: only harvest-stage objects spawn nodes). Everything else stays decor.
- A related-but-separate plan item imports `map.cif` `StaticObjects`
  (sethouse/sethuman/setanimal) — this step covers only the RESOURCE objects from the map.dat
  `objects` lane; check whether that sibling item has landed and coordinate (don't collide, do
  reuse its command/seam shape if present).

Scope:
1. A deterministic spawn path (a sim command or a world-construction step — mirror how the app
   currently seeds entities) that turns qualifying placements into Resource nodes: goodType +
   the Step-3/4 content constants (chops/yield/deposit size) + the placement's half-cell coords
   VERBATIM (the sim grid IS the 2W×2H lattice since the half-cell migration — no ÷2 cell snap;
   `positionOfNode` is the anchor seam). The Step-5 collision set is built once from them at load.
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
StaticObjects plan item; read packages/app/AGENTS.md for the entry/scene conventions.
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
  (`extractAtomicAnimations`). plan progress note currently notes the render impact frame is
  APPROXIMATED (~frame 8 of the 16-frame chop bobseq, phaseStart 9) — resolve or update that
  entry against the data.
- Verify `atomicDuration` (readviews/animations.ts) actually resolves the real 30-tick length
  through the `setatomic` binding chain for harvest atomics in real content — if it falls back
  to DEFAULT_ATOMIC_DURATION (4), fix the binding, not the constant.
- Known plan bug (Phase-3 item, same bullet as Step 3): pickup/deposit animations are choppy
  — the render advances 1 frame/tick while the atomic is shorter than the animation (19-frame
  `generic_pick_up` in a 4-tick atomic). Fix: pin those atomic durations to their animation
  lengths in content (`atomicBindings`/`atomicAnimations`) so each plays exactly once, fully.
- Cadence: the original (USER OBSERVATION — record in plan progress note as observed) does not swing
  continuously: strike → a brief idle beat → a small step/turn to a new angle (sometimes the
  same) → next strike. Between Step-3 chop atomics, insert a short interruptible idle and an
  occasional deterministic stance variation — facing/adjacent-cell re-pick driven by world.rng
  (NEVER Math.random), cadence parameters as named content constants.
- Stance & alignment: the collector works from an adjacent cell (Step 5); align facing + the
  render anchor (half-cell offsets) so the axe head meets the trunk across all the adjacent
  positions that occur. An agent CANNOT self-judge pixels: use the `?scene=gathering` scene plus,
  if helpful, a labeled montage or a short GIF per facing (AGENTS.md — the montage technique)
  and let the user be the oracle. Same for the optional stretch: play the tree's "falling" gfx
  state (the `[GfxLandscape]` falling frames / landscape type 5) as a render transient on the
  Step-3 `resourceFelled` event before swapping to stump+trunk — do it only if the frames are
  there and it stays render-side; else leave the plan progress note as-is.

Verification: headless — cadence state machine deterministic (two same-seed runs identical;
goldens updated intentionally if the planner sequence changes); atomic durations for
harvest/pickup/deposit assert against content data, not constants. `npm test` + `npm run check`
green. End with `npm run dev` → `?scene=gathering` + a checklist (axe meets trunk from every
stance; strike lands on the data's event frame, no sliding/moonwalking; the pause+reposition
rhythm reads like the original; pickup plays once, fully) and ask for human sign-off; update
plan progress note (impact frame now data-pinned; cadence observed; falling state done/deferred).

Guardrails: sim determinism (world.rng only); render never mutates sim; keep the golden
discipline (name the mechanic when a golden moves).
```
