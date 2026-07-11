import type { Fixed } from '../core/fixed.js';
import { type Entity, defineComponent } from '../ecs/world.js';

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  built: Fixed; // 0..ONE construction progress
  level: number; // houses level up (home level 00..04 -> population capacity)
}>('Building');

/**
 * A goods store attached to a building: goodType -> amount, with per-good capacity from the
 * building type. DETERMINISM: never iterate this Map directly for game decisions — use
 * stockpileEntries() which returns ascending-goodType order. Raw Map iteration is insertion-order
 * (history-dependent) and is a determinism footgun (see AGENTS.md anti-patterns).
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

/** Canonical (ascending goodType) view of a stockpile. Always use this for game logic. */
export function stockpileEntries(s: { amounts: Map<number, number> }): Array<[number, number]> {
  return [...s.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Marks a {@link Building} that is a **construction site** — a placed foundation a builder still has to
 * raise, faithful to the original's "place the grey outline, then settlers build it up" flow (you don't
 * drop a finished house; you drop its footprint, which already collides, and builders carry material +
 * hammer it up). It rides ON TOP of the plain `Building + Stockpile` shape (the site's stockpile is the
 * delivered-material hold), and it is the **separate optional component** the codebase uses for opt-in
 * behaviour ({@link Vehicle}, `Health`, {@link import('./settler.js').JobAssignment}): a building placed
 * already-built (the golden / vertical-slice path) never carries it, so its hash is untouched and the
 * ConstructionSystem's build branch stays inert on those.
 *
 * `labor` is the builder-WORK progress, 0..ONE — the fraction of hammering done, advanced by the
 * `construct` atomic (a swing is one hammer STRIKE: `+ONE/(totalUnits·strikesPerUnit)`, a small step, so a
 * site rises over many strikes whose count scales with its size — see `advanceConstructionLabor`). It is
 * DISTINCT from delivered material: the visible `Building.built` the render/HP read is
 * `min(labor, deliveredFraction)` — the two independent gates the ConstructionSystem ANDs, so a site
 * only rises as fast as BOTH the builder hammers AND material arrives (deliver 3 of 10 units → build
 * caps at 30% until more lands; hammer 0 swings → build stays at the grey foundation however much
 * material sits on it). The component is REMOVED the instant construction finishes (`built = ONE`), so a
 * finished building is a plain `Building` again — exactly the {@link import('./settler.js').Age} grow-up
 * pattern. Determinism: a single fixed-point counter, advanced by a fixed per-swing quantum in the
 * AtomicSystem's deterministic order.
 *
 * source-basis: the site-then-build flow and the material cost (`construction`, extracted
 * `LogicConstructionGoods`) are faithful; the builder-driven *pace* (several strikes per unit) is our named
 * approximation — the original has no sim oracle for construction speed (see AGENTS.md).
 */
export const UnderConstruction = defineComponent<{ labor: Fixed }>('UnderConstruction');

/**
 * A **placed vehicle hull** — the "boats as mobile stores" entity the historical plan phase-4 Sea/Northland
 * item names: a ship put on the map as a movable stockpile rather than a static building. `vehicleType`
 * cross-references the `VehicleType.typeId` (its `stockSlots` hold capacity, `cargoGoods`
 * load-filter, `passengerSlots`), and `tribe` is its owner — the same `(type, tribe)` shape a
 * {@link Building} carries, so a hull hashes and is queried exactly like a building. A hull is the
 * boat analogue of `Building`: it owns a {@link Stockpile} (the mobile store) the same way a
 * headquarters does, but it can later move and ferry passengers (embark/disembark atomics — a deferred
 * slice). Only an **unlocked** ship type is ever stamped (the CommandSystem `placeBoat` handler gates
 * on `tribeShipsUnlocked`), so a `Vehicle` always references a ship the owning tribe may field.
 *
 * Determinism: plain integer `vehicleType`/`tribe` (no fixed-point — they are cross-reference ids, not
 * positions), so it hashes like every other component. The golden/vertical-slice carries no hull, so
 * adding this component leaves the golden hash untouched (the separate-component pattern).
 */
export const Vehicle = defineComponent<{ vehicleType: number; tribe: number }>('Vehicle');

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its
 * `goodType` when a settler runs the good's harvest atomic on its cell; `remaining` is the units
 * left — each completed harvest decrements it (AtomicSystem's harvest effect), so a finite node
 * empties and the planner's `remaining <= 0` gate then skips it. `harvestAtomic` is the
 * numeric atomic id to run (the good's `atomicForHarvesting`), kept so the planner stays data-driven
 * — it picks the atomic from content, never hardcodes one. The resource occupies the nav node under
 * its {@link Position} (via `nodeAtClamped`).
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
  /**
   * OPAQUE render-variant tag a decoded-map spawn carries (the APP's species record index — "pine 02"
   * rather than the good's representative "yew 01"); the render keys its exact original bob off it via
   * the snapshot. Never read by any sim decision, and absent on admin/scene spawns — an absent field
   * hashes exactly as before, so pre-variant goldens are untouched.
   */
  gfxIndex?: number;
}>('Resource');

/** One integer cell offset relative to a placed resource node's anchor tile. */
export interface ResourceFootprintCell {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Data-driven collision/work footprint for a standing {@link Resource} node, copied from its
 * harvest-stage `[GfxLandscape]` record (`LogicWalkBlockArea`, `LogicBuildBlockArea`, `LogicWorkArea`).
 *
 * The marker is deliberately separate from {@link Resource}: old synthetic tests and one-off fixtures
 * that place a bare resource keep the pre-footprint same-tile behavior, while real/imported nodes and
 * acceptance scenes stamp this component from content. `walk` cells enter the dynamic pathfinding
 * overlay, `build` cells reserve the no-building ring, and `work` cells are where a collector stands
 * to run the harvest atomic. The original footprint rows are valency-state keyed; the resolver stamps
 * the highest state (the fresh/full node) so collision is static until the node is removed.
 */
export interface ResourceFootprintData {
  readonly walk: readonly ResourceFootprintCell[];
  readonly build: readonly ResourceFootprintCell[];
  readonly work: readonly ResourceFootprintCell[];
  /** Source `[GfxLandscape].index`, retained for provenance/debugging. */
  readonly sourceGfxIndex: number;
}

export const ResourceFootprint = defineComponent<ResourceFootprintData>('ResourceFootprint');

/**
 * Marks a {@link Resource} node that is **felled**, not gathered unit-by-unit — a tree the collector
 * chops down over several swings, faithful to the original's `tree → "tree falling" → trunk` lifecycle
 * (`landscapetypes.ini`; the good's `chopsToFell`/`yieldPerNode` gathering params). Present only on a
 * fellable node: today the **placement code** (scenes / vertical-slice / tests) stamps it from the good's
 * `gathering.chopsToFell` (there is no resource-spawn *system* yet — the content→`Felling` gate lands
 * when the map/resource spawn path does). A {@link MineDeposit} node (stone/iron/gold/clay) instead drops
 * one unit to the ground per swing and shrinks by level; a node with neither marker is the trivial
 * direct-pickup (a mushroom: one swing onto the back, then gone). This is the **separate-component
 * pattern** the codebase uses for opt-in behaviour ({@link Vehicle}, `Health`, `Owner`): a node without
 * it hashes and plans exactly as before, so the goldens/scenes that place plain resources are untouched.
 *
 * `chopsLeft` counts the chops still needed to fell the node — each completed harvest atomic decrements
 * it (yielding NOTHING onto the settler's back, unlike a single-hit gather), and the node falls when it
 * reaches 0: the standing node is destroyed (so the planner never sees a depleted stump-to-be again) and
 * its whole `Resource.remaining` yield drops at its cell as a bare {@link Stockpile} trunk pile (a
 * {@link GroundDrop}) the collector then carries off. Determinism: a plain integer counter, mutated only
 * by the AtomicSystem's harvest effect in the store's deterministic order.
 */
export const Felling = defineComponent<{ chopsLeft: number }>('Felling');

/**
 * Marks a {@link Resource} node that is **mined**, not felled or picked whole — a stone/iron/gold/clay
 * deposit the collector chips one unit at a time, faithful to the original's `mine → ore → pile`
 * pipeline (a mined good has a DISTINCT `landscapeToPickup` "ore" stage, unlike a mushroom whose harvest
 * IS its pickup; `bioLandscape 0` in the data — the "mined vs living" split). Present only on a mined
 * node, stamped by the placement code from the good's `gathering.depositSize`/`depositLevels` (the same
 * observed calibration route {@link Felling} uses; there is no resource-spawn *system* yet). Its harvest
 * behaviour: each completed harvest atomic drains one unit off `Resource.remaining` and drops it at the
 * node's cell as a bare {@link Stockpile} ore pile (a {@link GroundDrop}, exactly the felled-trunk shape
 * the collector then carries off), and the node is **removed** when `remaining` hits 0 — so a deposit
 * empties over its whole `initial` size, unlike a fell-once tree.
 *
 * `initial` is the deposit's size at spawn (the {@link Resource.remaining} the node started with) — the
 * denominator the render's shrink-by-level pick needs (a level is `remaining/initial` bucketed into
 * `levels` visual states, the `[GfxLandscape]` mine record's fill frames; `render`'s scene builder does
 * that pure integer computation off the snapshot, the way it already derives a pile's heap `fill`).
 * `levels` is that state count (OBSERVED = the ls_ground mine gfx's 5 fill states; source basis).
 * Both are plain integers, mutated by nothing — pure per-node capacity `remaining` is divided against.
 * Inert on every golden that mines nothing (the separate-component pattern).
 */
export const MineDeposit = defineComponent<{ initial: number; levels: number }>('MineDeposit');

/**
 * Marks a {@link Resource} node that is a **sown field** — the wheat a farm's worker plants, waters and
 * reaps, faithful to the original's field-farming vocabulary (`goodtypes.ini` wheat: `atomicForPlanting
 * 34` / `atomicForCultivating 35` / `atomicForHarvesting 29`, `isProducedOnMapFlag 1`; the field's
 * growth states are the `landscapetypes.ini` `wheat (growing)` lane, `maximumValency 5`). Stamped by the
 * `sow` atomic effect from the good's content `farming` block; the CropGrowthSystem advances it and the
 * farmer drive (planFarmer) works it. The loop: sown at `stage` 1 with `Resource.remaining` **0** (a
 * growing field yields nothing — the remaining-0 gate is what keeps every generic harvest scan off an
 * unripe field), grows a stage each `ticksPerStage` ticks (twice as fast once `watered` — the cultivate
 * atomic's effect; the ×2 is a named approximation, the engine's watering semantics are not decoded),
 * and at the final stage (`stage === stages`) becomes ripe: `Resource.remaining` is set to `yieldUnits`,
 * so the reap swing (the plain `harvest` effect, branched by THIS marker) drops the whole yield as a
 * ground sheaf pile ({@link GroundDrop}, the good's `landscapeToPickup` look) and removes the field.
 *
 * `farm` is the workplace whose worker sowed it — the farm's OWN fields are the ones its farmers water/
 * reap (two farms never work each other's fields); a stale id after demolition just strands a wild field
 * (harvest-scannable once ripe, else inert). A field is deliberately NOT walk-blocking and carries no
 * {@link ResourceFootprint} — the original's wheat landscape is walkable (`allowedonland 1`, no block
 * areas). The separate-optional-component pattern: no golden/scene sows, so every existing hash holds.
 */
export const Crop = defineComponent<{
  goodType: number;
  /** The farm workplace this field belongs to (a cross-reference id; ids are never reused). */
  farm: Entity;
  /** Current growth stage, 1..{@link stages}; ripe at the top stage. */
  stage: number;
  /** Total growth stages (the content `farming.stages`, snapshotted at sow). */
  stages: number;
  /** Whole ticks accumulated toward the next stage (exact integer compare, like CurrentAtomic). */
  growth: number;
  /** Ticks per growth stage (the content `farming.ticksPerStage`, snapshotted at sow). */
  ticksPerStage: number;
  /** Whether the field holds a live watering — the GROWTH FUEL: only a watered field grows, and each
   *  stage step consumes the watering (thirsty again until a farmer returns with the can — see
   *  systems/economy/farming.ts). */
  watered: boolean;
  /** Units the ripe field releases (the content `farming.yieldPerField`, snapshotted at sow). */
  yieldUnits: number;
}>('Crop');

/**
 * A farmer's **in-flight field intent** — which node its current farm action (reap / sheaf pickup /
 * sow / water) targets. Stamped by the planFarmer drive when it issues the action and removed the
 * moment the settler replans (ai.ts), so it exists exactly while the farmer is walking to or swinging
 * at the target. Its ONE purpose is work division: the planner folds every live FarmTask into the
 * tick's claim set, so a second farmer never picks a node a colleague is already en route to — the
 * fix for two farmers shadowing each other sowing/reaping the same spot (and what makes N farmers
 * scale field throughput ~N×). `sow` marks a plant-walk, which also counts toward the farm's
 * the farm's field cap while the field doesn't exist yet. A stale task (the target raced away, the farmer got
 * preempted) over-claims one node for at most the ticks until that farmer replans — self-correcting.
 * Inert on every golden that farms nothing (the separate-component pattern).
 */
export const FarmTask = defineComponent<{
  /** The farm workplace the action serves (the `byFarm` sow-count key). */
  farm: Entity;
  /** The claimed half-cell node (a `NodeId` — the crop/sheaf node, or the free node being sown). */
  node: number;
  /** True for a sow intent — it reserves one of the farm's crew-scaled field slots while in flight. */
  sow: boolean;
}>('FarmTask');

/**
 * A settler WAITING INSIDE its workplace — stamped by a drive whose settler is at its building with
 * nothing to do this tick (the farmer between field chores), and removed the moment it replans
 * (ai.ts, beside the FarmTask release), so it exists exactly while the settler idles at the door.
 * PURELY a render fact: the original's off-duty workers wait inside the house, not lined up at the
 * door — the render hides a Resting settler (it "went in") and it steps back out the tick work
 * appears. No sim decision reads it. Inert on every golden that farms nothing.
 */
export const Resting = defineComponent<{
  /** The workplace the settler waits inside (a completed building — the drive only rests at home). */
  at: Entity;
}>('Resting');

/**
 * A **stump / debris** decor entity left where a {@link Felling} node fell — the tree-debris the
 * original leaves behind (`ls_trees_dead.bmd` "tree debris", `landscapetype` logic 1: a pure-decor
 * landscape, non-blocking and not harvestable). It carries only a {@link Position} and this marker, so
 * it draws (the render side keys a per-good debris frame off `goodType`) but takes part in no sim
 * decision — the planner's resource/stockpile/building scans never see it. `goodType` records which
 * resource it is the remains of (a chopped tree → wood), so a future per-good decor binding can pick
 * the right debris. Inert on every golden that fells nothing (the separate-component pattern).
 */
export const Stump = defineComponent<{ goodType: number }>('Stump');

/**
 * Marks a bare {@link Stockpile} that is a **dropped resource pile** — the trunk a felled {@link Felling}
 * node leaves on the ground (Step 4 reuses it for a mined good's per-unit ground drops). It rides ON TOP
 * of the plain `Stockpile + Position` shape the existing ground-pile machinery already handles
 * (`nearestGroundPile`, the porter drive), so pickup/delivery consume it unchanged; the marker adds two
 * things a *designated* delivery flag (an equally-bare `Stockpile`) must NOT get: (1) it is the target a
 * felling collector's own collect-trunk drive prefers, and (2) it is **auto-reaped when emptied** (a
 * collected trunk vanishes, unlike a persistent flag), so a long game doesn't accrete an empty pile per
 * felled tree. A pure marker (`goodType` for legibility/debug); its presence is what the sim keys on.
 */
export const GroundDrop = defineComponent<{ goodType: number }>('GroundDrop');

/**
 * Marks a {@link GroundDrop} pile with the settler that HARVESTED it into being — a felled trunk's or a
 * mined ore unit's owner. It is stamped only when the harvester is a **flag-bound gatherer** (carries a
 * {@link WorkFlag}), and it is what makes a gatherer carry off **only what it dug itself**: the gatherer's
 * collect drive reclaims a drop only when `by` is its own entity, so a loose pile it did not make (another
 * settler's trunk, a player-dropped heap, a map-seeded pile) is left in peace. A pure cross-reference id
 * (entity ids are monotonic and never reused, so a dead owner's id can never re-alias a live settler).
 *
 * The **separate-optional-component pattern** ({@link Vehicle}/`Health`/{@link WorkFlag}): a drop made by a
 * flagless collector (the golden slice / vertical-slice woodcutter) carries none, hashing and collecting
 * exactly as before — the ownership rule is inert wherever no flag-bound gatherer harvests.
 */
export const HarvestedBy = defineComponent<{ by: Entity }>('HarvestedBy');

/**
 * Binds a **gatherer to its own flag** — the collection point it carries every harvested good to, and the
 * centre of the bounded area it looks for work in. The whole of the user-specified gatherer behaviour keys
 * on it (the AI planner's harvest/collect drive, `planGatherer`):
 *
 *  - a bound gatherer HARVESTS only nodes within `radius` (integer node-distance) of `flag`; nothing in
 *    range → it walks to and stands idle beside its flag rather than roaming the map;
 *  - it collects ONLY its own harvested drops ({@link HarvestedBy} keyed to it), leaving loose piles alone;
 *  - it DELIVERS its load to `flag` (`deliveryTargetFor`), spreading it onto loose ground heaps AROUND the
 *    flag (the flag is a marker, not a store), not merely into the nearest store.
 *
 * `flag` references a positioned {@link DeliveryFlag} MARKER (no {@link Stockpile} — it stores nothing; the
 * harvest piles on the GROUND around it as separate loose heaps, so moving the flag never moves the goods);
 * `radius` is a named work-area size (the original's collector work radius is not decoded, so it is an
 * OBSERVED/tunable approximation carried as data, not a magic constant in code).
 *
 * The **separate-optional-component pattern**: a gatherer WITHOUT it falls back to the prior roam-and-haul
 * behaviour (nearest node anywhere, nearest trunk of its trade, nearest store), so every existing scene,
 * test, and golden — none of which stamp a WorkFlag — is byte-identical. Only an explicitly flag-bound
 * gatherer opts into the new behaviour.
 */
export const WorkFlag = defineComponent<{ flag: Entity; radius: number }>('WorkFlag');

/**
 * Marks a positioned entity as a **designated delivery flag** — a gatherer's collection point. A flag is a
 * pure MARKER: `Position + DeliveryFlag` and NOTHING else (no {@link Stockpile}), because it stores no
 * goods — the harvest a gatherer delivers piles on the GROUND around it as separate loose `Stockpile+Position`
 * heaps, each pinned to its own tile. That separation is the whole point: relocating the flag ({@link
 * setWorkFlag}) moves only the marker, never the goods already dropped (they "never teleport"). Its presence
 * is also what render keys on to draw the flag graphic ON TOP of any co-located goods heap. Stamped on every
 * flag the scene/command creates ({@link WorkFlag} targets, `setWorkFlag`). Inert on the golden slice (which
 * has no flags), so the hash is untouched — the separate-optional-component pattern.
 */
export const DeliveryFlag = defineComponent<Record<string, never>>('DeliveryFlag');

/**
 * The default work radius (integer node-distance on the half-cell lattice) a newly placed gatherer flag
 * gets — used by the `setWorkFlag` command, the spawn-time auto-plant, and the sandbox scene binding. 24
 * half-cell nodes ≈ 12 tiles (a ~24-tile-wide work area). A named approximation, not a source-pinned value:
 * the original's collector work-area size is not decoded, so this is observed/tunable (chosen "sporawy" so a
 * gatherer reaches a decent patch around its flag without roaming the whole map).
 */
export const DEFAULT_WORK_FLAG_RADIUS = 24;

/**
 * An in-progress production cycle on a workplace (a {@link Building} whose building type carries a
 * `recipe`). The ProductionSystem consumes the recipe's input goods from the building's own
 * {@link Stockpile} when a cycle starts, advances the integer `elapsed` tick counter, and on the
 * `recipe.ticks`-th tick deposits the output goods (capped at the building type's per-good capacity,
 * with room reserved at start so they always fit). The component exists only while a cycle is
 * running — its absence means the workplace is idle/ready to start the next cycle.
 *
 * Timing is the exact integer compare `elapsed >= duration` (like {@link CurrentAtomic}) — never an
 * accumulated fixed-point step, which would truncate and hang. `duration` mirrors the recipe's
 * `ticks` (snapshotted so a content edit mid-cycle can't change an in-flight cycle's length).
 */
export const Production = defineComponent<{
  /** Whole ticks elapsed in the current cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks one cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
}>('Production');
