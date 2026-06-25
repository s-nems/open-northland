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
| Goods-graph input side (`productionInputs`) | faithful (params) | extracted verbatim from `Data/logic/goodtypes.ini` `productionInputGoods` (the base `.ini`; the mod ships no `goodtypes` twin). A repeated good id encodes the amount, collapsed to `{goodType, amount}` (e.g. `tile <- 2x mud, 1x wood`). Hands-on: 42/65 goods carry inputs, 0 dangling refs (cross-ref-checked). The **output-side join** into building `recipe`s + cycle timing is still pending — that's what flips the *Production* row's "recipe not extracted" caveat. |
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
| Production (recipe inputs→outputs, output-capacity gate) | approximated | The *system* (consume-at-start / deposit-at-completion / capacity gate) is data-shaped, and the **recipe input side is now extracted** (`goodtypes.productionInputGoods` → each good's `productionInputs`, faithful — see the goods-graph row). What is still missing for a real building `recipe`: joining a workplace's `produces` output good to that good's `productionInputs` and adding the per-cycle timing — until then `recipe` is unfilled and production runs against the synthetic sawmill (wood→plank). Faithful only once the output-side join lands. |
| Stock capacity enforcement | faithful (params) | per-good caps from the building type's `logicstock <good> <cap> <init>` slots (`extractBuildings` → `stockCapacity`). |
| Resource depletion (finite nodes) | approximated | `HARVEST_YIELD`=1 unit/harvest (node survives exactly N harvests) — goods-conserving and structurally sound, but the per-node yield/regrowth isn't pinned to a source yet. |

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

_None yet._ Format: `- <mechanic>: <how it differs> — <why> (<commit>)`.
