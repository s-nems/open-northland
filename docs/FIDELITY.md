# Fidelity — is the rebuild *faithful*, not just self-consistent?

Vinland's goal is a **faithful** rebuild of *Cultures – 8th Wonder* that can *then* be modded and
improved. "Faithful" is a different axis from "correct" in the test sense, and that difference is the
whole reason this file exists.

- **`npm test` proves self-consistency + determinism.** The pyramid (determinism, invariants — goods
  conservation, no-deadlock, path validity — golden traces) runs against the **synthetic fixture**. It
  proves the sim is reproducible and internally lawful. It does **not** prove the sim behaves like the
  original game. An agent can build a fully-green, fully-deterministic economy that plays nothing like
  *Cultures*, and no test would fire.
- **This file tracks the other axis: does each mechanic match the original?** It is a conformance
  ledger, maintained by `/iterate` (the per-step `fidelityBasis`) and `/reflect` (audits + tending).

## Why there is no automatic mechanics oracle

Fidelity is *partly* free and *mostly* not (see `docs/SOURCES.md`):

| Layer | Oracle? | How fidelity is pinned |
|---|---|---|
| **Data params** (recipes, ranges, timings, worker counts, atomic vocab) | **Yes — by construction** | Extracted from the original `.ini`/`.cif`; the pipeline verifies record counts (65 goods, 55 jobs, 105 weapons, …). Faithful as long as extraction is faithful. |
| **Assets** (`.pcx`/`.bmd` → PNG/atlas) | **Yes — OpenVikings pixel-oracle** | OpenVikings renders the originals; diff decoded output pixel-for-pixel + decoder round-trip tests. (Pending an owned game copy + the oracle.) |
| **Sim behavior** (atomic planner, economy loops, AI, pathing, combat, atomic timings) | **No** | OpenVikings' logic tick is a stub counter; the behavior is in neither the data nor the reverse-engineering. It can only be pinned by (a) the data-derived parameters, (b) the readable `.ini` *semantics*, (c) **calibration-by-observation** against the running original. Because nothing automatic catches drift here, **it must be tracked in this file.** |

## The faithful-first rule

A mechanic must match the original's behavior, pinned to one of the sources above. **Conscious
deviations are deferred and recorded — never the default.** If you intentionally diverge (a bug-fix, a
quality-of-life change, a simplification), log it under *Deviations* with the reason, so the faithful
baseline stays knowable and a future "faithful mode" / mod toggle remains possible. The content-is-data
architecture exists precisely so fidelity lives in data, not hard-coded systems.

## Conformance ledger

Status: `not-started` · `approximated` (running but not pinned to the original) · `faithful` (matches a
named source). Update the relevant row when a mechanic lands or is calibrated.

### Pipeline / formats (Phase 0–1)
| Area | Status | Source / how pinned |
|---|---|---|
| `.cif` decrypt + container | faithful | round-trip tested; layout solved vs `XBStorable.cs`/`XBTools.cs` (SOURCES.md) |
| `.lib` / `.pcx` / `.bmd` / `.ini` decoders | faithful (structure) | round-trip tests + real-data record counts; **pixel-oracle diff still pending** |
| `map.dat` `hoix` container + `pck`/`X8el`/`X6el` packed layers | faithful (structure) | container ported from oracle `CIoHelper.cs`; the X8el inner header reverse-engineered + cross-validated across 5 real maps (69 layers, 0 mismatches, real grids `pack→unpack` byte-exact); the codec is the `.bmd` packed-line family. **X6el (`empa`/`empb` 2-byte ownership) now decoded** — identical inner header, the same RLE family over little-endian u16 elements (run = `count` copies of one u16; literal = `count` u16s); cross-validated across **all 130 real maps (260 layers, 0 mismatches, all `pack→unpack` byte-exact)**, each yielding exactly `width×height` u16 ids (id 0 = unowned). No behavioral oracle for what the ids *mean* (territory/object ownership is a Phase-5 concern) — the codec itself is pinned by the round-trip + exact cell-count |
| `lmlt` 4-corner layer → per-cell landscape-typeId grid → `content/maps/<id>.json` | approximated (structure faithful) | the 4 B/cell = four per-corner triangle type **indices** is reverse-engineered from real maps (raw values 0..85; ~64% uniform cells, the rest shoreline transitions). The corner→single-cell reduction (**dominant corner, lowest-typeId tie-break**) has **no behavioral oracle** (OpenVikings decodes the container but does not simulate nav); it is a deterministic bulk-terrain choice for the cell-graph input, refine if the oracle later pins a different rule. **The +1 indexing seam is pinned, not approximated:** the binary layer is **0-based** but the IR `LandscapeType.typeId` mirrors the 1-based `.ini` `type` field (`type 1 = void`), so the reduced index is shifted `+1` — verified faithful by loading **all 125 emitted grids through the sim's real `buildTerrainGraph`** (0 absent-typeId failures; raw 0 = "void" = IR typeId 1, raw 86 = the 87-type table's max). Wired into the CLI: every `map.dat` → `maps/<id>.json`. |
| Data extraction (goods/jobs/tribes/weapons/buildings/atomics) | faithful (params) | extracted from readable `.ini`; counts verified; cross-refs resolve |
| Goods-graph input side (`productionInputs`) | faithful (params) | extracted verbatim from `Data/logic/goodtypes.ini` `productionInputGoods` (the base `.ini`; the mod ships no `goodtypes` twin). A repeated good id encodes the amount, collapsed to `{goodType, amount}` (e.g. `tile <- 2x mud, 1x wood`). Hands-on: 42/65 goods carry inputs, 0 dangling refs (cross-ref-checked). The **output-side join** into building `recipe`s **has now landed** — see the *Production* row. |
| Goods-graph **node layers** (`GoodClassification`) | faithful (params) | the raw-vs-produced-vs-input layering is read verbatim from each `[goodtype]`'s boolean flags — `isProducedOnMapFlag` → `producedOnMap` (raw/map-gathered), `isProducedInHouseFlag` → `producedInHouse` (workplace output), `isInputGoodFlag` → `inputGood` (recipe-consumable). Three **independent** booleans, not a mutually-exclusive enum: the source itself sets several at once (e.g. `leather` carries all three — gathered from animals *and* house-produced *and* an input). Hands-on on the real game: 65 goods → 16 raw / 48 in-house / 17 input; `food_simple`/`food_extra` correctly in-house terminal, `wheat`/`stone`/`wood` raw+input, `flour` in-house+input (the intermediate tier). These layers + the `productionInputs` edges are the explicit goods-graph IR. |
| Decoded-asset **pixel** fidelity | not-verified | OpenVikings pixel-diff not yet run (an agent can't self-judge; needs human + owned copy) |

### Simulation mechanics (Phase 2+)
Two axes are pinned independently per mechanic: its **structure/parameters** (often data-pinned) and
its **behavior** (the planner/loop shape, which has no oracle — see the table above). A row is only
`faithful` when *both* are pinned to a named source; a faithful parameter under an unpinned behavior
is still `approximated` overall, with the basis spelled out.

| Mechanic | Status | Source / how pinned |
|---|---|---|
| Terrain cell-graph + walkability/valency | faithful (params) | `landscapetypes.ini` `walkable` + `maximumValency`; 4-connected cell graph is the engine's nav model, not the triangle render mesh (docs/ECS.md). |
| Uniform per-step walk cost | faithful | `landscapetypes.ini` carries **no** per-type movement weight (only valency + placement flags — verified, see LESSONS [4ef956f]); movement is gated by walkability/valency, so uniform cost is the faithful model, not a placeholder. |
| A\* pathfinding (canonical tie-break, per-tick budget) | approximated | Behavior has no oracle (OpenVikings' logic tick is a stub). A\* + canonical tie-break is *our* deterministic choice; the engine's actual pather/path-cache is unknown. `PATHFINDING_BUDGET_PER_TICK`=8 is unpinned (calibration-by-observation pending). |
| Movement step speed | approximated | `MOVE_SPEED_PER_TICK`=¼ tile/tick is an unpinned constant — `atomicanimations` carries `startdirection`/`length` but no traverse speed found yet; calibration-by-observation pending. |
| Atomic durations (harvest/pileup/pickup) | faithful (params) | duration = the tribe's `setatomic (jobType,atomicId)→animation` binding → `atomicanimations.ini` `length` (`atomicDuration`). `DEFAULT_ATOMIC_DURATION`=4 only when the chain is absent (unpinned fallback). |
| Job→atomic gating (which job may harvest what) | faithful (params) | `jobtypes` `allowatomic`/`baseatomics` (∪/−) gate the resource good's `goodtypes` `atomicFor*` harvest atomic (`jobAtomics`/`nearestHarvestableFor`) — the data-driven "woodcutter cuts trees, not ore" rule. |
| Atomic-utility planner (harvest→carry→pileup, target choice) | approximated | Behavior, no oracle. The harvest *atomic id* is data-driven, but the planner shape (nearest-Manhattan target, load-state state machine, utility=distance) is *our* design; the original's settler AI is the undocumented "soul" (Risks). |
| Carrier (haul workplace outputs to a store) | approximated | Behavior, no oracle. `CARRY_LOAD`/`HARVEST_YIELD`=1 unit/swing and "never deliver back into the producer" are unpinned design choices; the engine's carrier dispatch is unknown. |
| Production recipe **inputs/outputs** (the goods transformed per cycle) | faithful (params) | the **output-side join now lands** (`fillBuildingRecipes`): a workplace's `logicproduction` output good → that good's `goodtypes.productionInputGoods` materializes the building `recipe.inputs`; `recipe.outputs` = each produced good at amount 1 (the `logicproduction <good>` semantics carry no per-output quantity). Hands-on on the real game: 26/28 workplaces get a recipe (22 with non-empty inputs), 0 dangling refs, and the recipes are recognisably the original economy (mill `wheat→flour`, bakery `water+flour→bread`, brewery `water+honey→mead`). The sim no longer needs the synthetic sawmill stand-in. |
| Production **per-cycle ticks** | faithful (params, reference-tribe) | `recipe.ticks` is now resolved from the produce atomic's animation `length` (`fillBuildingRecipes` → `resolveRecipeTicks`): the building's worker `jobType` + the primary produced good's `goodtypes.atomicForProduction` form the `(jobType, atomicId)` key into the **reference tribe's** (lowest-`typeId`, deterministic) `setatomic <job> <atomicId> "anim"` table (last-wins) → that `atomicanimations` `length`. Hands-on on the real game: **22/26 producing workplaces** pin to a real length (mill flour=200, brewery mead=50, pottery brick=80, sewery shoes=160, …; distribution {50,80,100,120,150,160,200,240}), the 4 left at `DEFAULT_RECIPE_TICKS`=20 being raw-good producers with no `atomicForProduction` (well/hive/farm). **APPROXIMATED on two recorded axes (see Deviations):** (a) production length **varies per tribe** in the source (viking coiner=200 vs frank coiner=60), so the reference-tribe value loses the per-tribe spread — a per-tribe recipe table is the fully-faithful model, deferred; (b) a multi-output workplace has one length per output atomic, collapsed to the primary output's (the merged recipe carries a single `ticks`). |
| Production system (consume-at-start / deposit-at-completion / output-capacity gate) | approximated | The *system* shape is data-shaped (recipe read from CONTENT) but the loop (reserve inputs at cycle start, deposit outputs at completion, never start unless outputs fit) is *our* design — the engine's production loop has no oracle. |
| Production **worker-presence gate** (produce only while staffed) | faithful (params) / approximated (behavior) | **Params faithful:** the worker requirement is the building type's `workers` slot (`logicworker <job> <count>` → `extractBuildings`); a workplace produces only while a `Settler` whose `jobType` matches a slot stands on its tile (`workerPresentAt`), matching the original's "a workshop runs only while its worker is inside" — a sawmill with no operator makes no planks. A type with no `workers` slot is unstaffed-by-design and produces freely. **Behavior approximated:** "present == shares the integer tile", "pause-and-hold `elapsed` when the worker leaves / resume on return", and the planner's "pin a settler standing on a workplace it staffs" (`staffsWorkplaceHere`) are *our* minimal model — no JobSystem assignment/keep-worker-at-workplace dispatch yet (that, and what the original does when a worker is mid-walk, has no oracle). The original may run production off an *assigned* (not physically-present) worker; refine when the JobSystem slice + calibration-by-observation land. |
| Stock capacity enforcement | faithful (params) | per-good caps from the building type's `logicstock <good> <cap> <init>` slots (`extractBuildings` → `stockCapacity`). |
| Resource depletion (finite nodes) | approximated | `HARVEST_YIELD`=1 unit/harvest (node survives exactly N harvests) — goods-conserving and structurally sound, but the per-node yield/regrowth isn't pinned to a source yet. |
| Hunger rise (NeedsSystem) | approximated | The original drives hunger through `atomicanimations.ini` `event <at> 2 <delta>` tuples — an activity animation drains a fixed amount (e.g. `event 30 2 -100`) while an `eat_slot_food` animation restores it (`event 30 2 +4000`, candy `+6000`), on a large integer scale where one meal ≈ +4000 (verified across all tribes' `eat_slot_food`/`eat_slot_candy` records). That **event-driven, per-animation** model needs the atomic `event (type,value)` vocabulary decoded (a deferred Phase-1 extraction — ROADMAP risks). For now `needsSystem` raises hunger at a CONSTANT `HUNGER_RISE_PER_TICK`=ONE/4096 (an empty bar fills in 4096 ticks), clamped at ONE so the `hungerInRange` invariant holds; the `eat` atomic resets it to 0 (AtomicSystem). Hands-on: 5000 ticks through the real schedule → hunger rises and clamps exactly at ONE, 0 invariant violations, deterministic. The **rise/reset loop shape is the original's core** ("hunger grows over time, eating restores it"); the per-activity `event 30 2 <delta>` rates + the eat-restores-by-`+4000` magnitude are the faithful target (deferred — see Deviations). The non-food needs (`pray`/`enjoy`/social/`make_love`) are later slices. |
| Fatigue rise (NeedsSystem, the rest/sleep need) | approximated | The first non-food need: `needsSystem` raises `fatigue` at a CONSTANT `FATIGUE_RISE_PER_TICK`=ONE/8192 (half hunger's rate so a settler eats ~twice per sleep), clamped at ONE (the `fatigueInRange` invariant). The original ticks rest via per-animation events the same way hunger does — `viking_civilist_sleep` carries `event <at> 1 +4000` tuples (type 1 = the rest channel, as type 2 is hunger, on the same ~10000-scale bar; verified across tribes) — needing the atomic `event (type,value)` vocabulary decoded (the same deferred Phase-1 extraction hunger waits on). The pairing **reset** is the `sleep` atomic id **8**, pinned to the original `tribetypes` `setatomic <job> 8 "..._sleep"` bindings (bound for every job/tribe, even babies). The rise/reset loop shape is the original's core ("tiredness grows, sleeping restores it"); the per-activity rates + the eventual sleep DRIVE are deferred. Hands-on: 200 ticks through the real schedule → fatigue rises at half hunger's rate, stays below it, 0 invariant violations, two seed-7 runs hash-equal (`98993f42`). |
| Piety rise (NeedsSystem, the first target-bound need) | approximated | The first **target-bound** non-food need (satisfied by praying *at a temple*, not at a store like eat or in place like sleep): `needsSystem` raises `piety` at a CONSTANT `PIETY_RISE_PER_TICK`=ONE/16384 (half fatigue's rate so a settler prays ~once per two sleeps), clamped at ONE (the new `pietyInRange` invariant). The original ticks devotion via per-animation events the same way hunger/fatigue do (numbered channels: type 1 = rest, type 2 = hunger; the religious channel is another id), needing the atomic `event (type,value)` vocabulary decoded (the same deferred Phase-1 extraction). The pairing **reset** is the `pray` atomic id **12**, pinned to the original `tribetypes` `setatomic 6 12 "..._pray"` bindings (the civilist job, across all tribes — verified in the mod `tribetypes.ini`). The rise/reset loop shape is the original's core ("devotion lapses, praying restores it"); the per-activity rates are deferred, but the pray **DRIVE** (planner walking the settler to a temple to pray) **has now landed** — see the *Pray drive* row. Hands-on: 20000 ticks through the real schedule → piety rises at half fatigue's rate, clamps exactly at ONE at tick 16384, piety ≤ fatigue ≤ hunger every tick, 0 invariant violations, two seed-7 runs hash-equal (`0a20b59b`). |
| Sleep drive (planner chooses `sleep` at a fatigue threshold) | faithful (atomic id) / approximated (trigger + in-place rest) | **Pinned:** the sleep atomic id is **8**, read straight from the original `tribetypes` `setatomic <job> 8 "..._sleep"` bindings (id 8 = the sleep slot across every tribe/job, even babies) — the same `(jobType, atomicId)`→animation→`length` join the other atomics use (the slice fixture binds 8→"viking_sleep", length 6). When fatigue ≥ threshold the planner starts a `sleep` atomic (below the eat drive — a starving settler eats before it can rest — but above harvest/haul/staffing, so a worn-out operator stops working); the `sleep` effect then zeroes fatigue (AtomicSystem, no goods consumed — resting is free) — closing the rise→sleep→reset loop. **Approximated:** (a) the settler sleeps **in place** (no target site) — the original sleeps at *home*, but the housing/home system that would give a sleep target doesn't exist yet, so resting where it stands is the slice stand-in; (b) the **`FATIGUE_SLEEP_THRESHOLD`=¾·ONE** trigger is unpinned, mirroring the eat trigger — the original sleeps off the per-animation rest events (`event <at> 1 <delta>`) with no single readable "sleep at X" level; both refine when the atomic `event` vocabulary is decoded + calibration lands (see Deviations). Hands-on: a settler crossing the threshold starts the sleep atomic tick 1, fatigue resets to 0 by tick 6 (the 6-tick animation), peak never breached ONE, 0 invariant violations, two seed-5 runs hash-equal (`8e2e10b0`). |
| Eat drive (planner chooses `eat` at a hunger threshold) | faithful (atomic id) / approximated (trigger + food id) | **Pinned:** the eat atomic id is **10**, read straight from the original `tribetypes` `setatomic <job> 10 "..._eat_slot_food"` bindings (id 10 = the eat slot across every tribe; id 11 = candy) — the same `(jobType, atomicId)`→animation→`length` join the other atomics use (the slice fixture binds 10→"viking_eat"). When hunger ≥ threshold the planner starts an `eat` atomic (above harvest/haul/staffing), consuming **one unit of food** from the settler's carried load or the nearest store holding food; the `eat` effect then zeroes hunger (AtomicSystem) — closing the rise→eat→reset loop with goods conserved (food destroyed on the bite, never conjured). **Approximated:** (a) *which good is food* is inferred from the `food` id prefix (`food_simple`/`food_extra`, the original's slot-food goods) — `goodtypes.ini` carries no explicit "iseatable" flag, the food→eat-slot binding lives below the readable rule files; (b) the **`HUNGER_EAT_THRESHOLD`=¾·ONE** trigger is unpinned — the original eats off the per-animation `event 30 2 <delta>` cadence with no single readable "eat at X" level; both refine when the atomic `event` vocabulary is decoded + calibration-by-observation lands (see Deviations). Hands-on: a settler crossing the threshold beside a larder walks over, eats at tick 11 (hunger 49312→0), consumes exactly 1 food unit, 0 invariant violations. |
| Pray drive (planner chooses `pray` at a piety threshold — the first **target-bound** need) | faithful (atomic id) / approximated (trigger + temple inference) | **Pinned:** the pray atomic id is **12**, read straight from the original `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY = 12` (`logicdefines.inc`) + the `setatomic 6 12 "..._pray"` bindings (the civilist job) — the same `(jobType, atomicId)`→animation→`length` join the other atomics use (the slice fixture binds 12→"viking_pray", length 7). When piety ≥ threshold the planner does the genuinely-new **need→satisfier→building-target lookup**: find the nearest **temple** and set a `MoveGoal` to walk there (unlike eat at a store / sleep in place — the first need that requires reaching a specific *building*); once standing on it, start the `pray` atomic, whose effect zeroes piety (AtomicSystem, no goods consumed — like sleep, praying is free) — closing the rise→pray→reset loop. The drive sits **below eat + sleep** (survival outranks devotion); a devout settler with no temple anywhere falls through to normal work (piety stays pinned at ONE — a settlement with no temple can't pray, like the original). **Approximated:** (a) *which building is a temple* is inferred from the structural signature of the original's "work temple" (`HOUSE_TYPE_WORK_TEMPLE` = `logictype 37`, `logicmaintype 3`): a `kind === 'workplace'` building with **no recipe, no workers, no stock** (`isTemple`) — the building→pray-need link lives below the readable rule files (no "issatisfier" flag in `houses.ini`), so it is inferred like the food→eat-slot binding; (b) the **`PIETY_PRAY_THRESHOLD`=¾·ONE** trigger is unpinned, mirroring the eat/sleep triggers; both refine when the atomic `event` vocabulary is decoded + a content building→need binding is extracted + calibration lands (see Deviations). Hands-on: a devout settler a few cells from a temple walks over and prays through the real schedule, piety resets to 0, peak never breached ONE, 0 invariant violations, two seed-5 runs hash-equal. |

> **How to read this table.** Most Phase-2 rows are `approximated` because the *behavior* axis has no
> automatic oracle — the planner/loop shapes are deterministic design choices, not yet calibrated
> against the running original. That is expected and honest, not a gap to paper over: the
> data-derived *parameters* (durations, gates, capacities) are faithful, and the behavior rows carry
> an explicit "calibration-by-observation pending" until a human watches the original and tunes them.
> The blind spot this file exists to surface is a row silently sitting `faithful` without a named
> source — not an honestly-`approximated` one.

### Render / presentation (Phase 2)
The render layer is a pure consumer of sim state (it never feeds back), so most of it is a *visual*
checklist (depth-sort/projection — see docs/TESTING.md), not a mechanics oracle. The one
fidelity-relevant decision is the **state→sprite join**: which animation a settler shows.

| Concern | Status | Source / how pinned |
|---|---|---|
| Settler state→sprite-frame join (`resolveSpriteFrame`) | approximated | The **join key is faithful**: an `acting` settler carries its numeric `atomicId`, the exact key the original's `tribetypes` `setatomic` maps to an animation. But the *render-side state model* (`idle`/`moving`/`acting`, derived from `CurrentAtomic`/`PathFollow`) and the **which-frame-per-state** choice are *our* coarsening — the original has a richer per-direction/per-atomic animation table not yet bound. No decoded bob/animation set is wired (the bound atlas is the FREE synthetic stand-in); the `byAtomic` override exists but is empty until a real `setatomic`→bob table is extracted. Pixel fidelity stays the OpenVikings oracle's job (Assets row), deferred to a human. |

## Deviations (conscious divergences from the original)

Format: `- <mechanic>: <how it differs> — <why> (<commit>)`.

- Hunger rise: `needsSystem` raises hunger at a flat `HUNGER_RISE_PER_TICK`=ONE/4096, but the original
  drains hunger via per-activity-animation events (`event 30 2 -100`) and restores it per `eat_slot_food`
  event (`+4000`) on a large integer scale — an event-driven model that varies by which animation runs.
  The faithful model is hunger ticked by each completed atomic's `event (type=2, value)` against a
  ~10000-scale bar, deferred until the atomic `event (type,value)` vocabulary is decoded (a named
  Phase-1 extraction risk). The constant rate is the basic, bounded "hunger grows, eating resets it"
  core — strictly the right shape, with the per-activity rates as the recorded faithful target.

- Eat drive: the planner triggers eating at a flat `HUNGER_EAT_THRESHOLD`=¾·ONE and identifies food by
  the good's `food` id prefix, but the original drives eating off the per-animation hunger events
  (`event 30 2 <delta>` against a ~10000-scale bar — no single readable "eat at X" threshold) and maps
  the food goods to the eat slot below the readable rule files (no `iseatable` flag in `goodtypes.ini`).
  The eat *atomic id* (10) IS pinned to the original `setatomic` bindings; only the trigger level and
  the food-good identification are inferred, deferred until the atomic `event (type,value)` vocabulary
  is decoded (the same named Phase-1 extraction the hunger-rise deviation waits on) and a content
  eatable-flag/slot-binding is extracted. Strictly the right "eat when hungry, food restores it" shape.

- Fatigue rise: `needsSystem` raises fatigue at a flat `FATIGUE_RISE_PER_TICK`=ONE/8192, but the
  original drains rest via per-activity-animation events and restores it per `sleep` event
  (`event <at> 1 +4000`) on the same ~10000-scale bar hunger uses (type 1 = rest, type 2 = hunger).
  The faithful model is fatigue ticked by each completed atomic's `event (type=1, value)`, deferred to
  the same atomic `event (type,value)` decode the hunger deviation waits on. The reset *atomic id* (8,
  `sleep`) IS pinned to the original `setatomic` bindings; the half-of-hunger rise rate is an unpinned
  cadence stand-in (calibration-by-observation pending). The sleep DRIVE (planner choosing `sleep` at
  a fatigue threshold) has now landed — mirroring the eat drive, but the settler sleeps **in place**
  (the original sleeps at home; the housing/home system that would give a sleep target is a later
  slice) and the `FATIGUE_SLEEP_THRESHOLD`=¾·ONE trigger is unpinned like the eat trigger. Strictly
  the right "tired-then-rest" shape.

- Piety rise: `needsSystem` raises piety at a flat `PIETY_RISE_PER_TICK`=ONE/16384, but the original
  drains devotion via per-activity-animation events and restores it per `pray` event on a numbered
  channel (as type 1 = rest, type 2 = hunger; the religious channel is another id), on the same
  ~10000-scale bar. The faithful model is piety ticked by each completed atomic's `event (type,value)`,
  deferred to the same atomic `event (type,value)` decode the hunger/fatigue deviations wait on. The
  reset *atomic id* (12, `pray`) IS pinned to the original `setatomic 6 12 "..._pray"` bindings; the
  half-of-fatigue rise rate is an unpinned cadence stand-in (calibration-by-observation pending). The
  pray DRIVE (planner choosing `pray` at a piety threshold) **has now landed** — mirroring the eat/sleep
  drives, but as the first **target-bound** need it does the genuinely-new need→satisfier→**temple-target**
  lookup: it finds the nearest **temple** (a `kind === 'workplace'` building with no recipe/workers/stock
  — the structural signature of the original's `HOUSE_TYPE_WORK_TEMPLE` logictype 37, since the
  building→pray-need link isn't a readable flag, inferred like food→eat-slot), walks the settler there, and
  prays on arrival; the `PIETY_PRAY_THRESHOLD`=¾·ONE trigger is unpinned like the eat/sleep ones, and the
  temple-inference refines if a content building→need binding is later extracted. Strictly the right
  "devotion-lapses-then-pray-at-a-temple" shape. The other target-bound needs (`enjoy` id 17 / `make_love`
  id 78) follow the same shape.

- Production per-cycle ticks: the building-type `recipe.ticks` is pinned to ONE **reference tribe**
  (lowest-`typeId`), but the source's production-animation `length` varies per tribe (e.g. viking
  coiner=200 vs frank coiner=60) and per output good. The merged building-type recipe carries a single
  `ticks`, so the per-tribe / per-output spread is collapsed to the reference tribe's primary-output
  length. The fully-faithful model is a per-tribe (and ideally per-output) recipe-timing table, deferred
  until there is tribe context at the sim/economy layer — strictly more faithful than the prior flat
  `DEFAULT_RECIPE_TICKS`=20 constant, which carried no source at all.
