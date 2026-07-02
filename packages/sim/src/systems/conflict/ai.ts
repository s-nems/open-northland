import {
  Age,
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import type { AtomicEffect } from '../../core/commands.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import { interactionTile } from '../footprint.js';
import { buildingEnabled, carrierCarryCapacity, settlerMeetsNeed } from '../progression.js';
import {
  atomicDuration,
  buildingWorkerJobs,
  canonicalById,
  inRange,
  isFood,
  isTemple,
  manhattan,
  recipeOf,
  stockCapacity,
} from '../shared.js';

/**
 * AISystem — the settler planner: two layered passes per tick.
 *
 *  1. {@link atomicPlanner} (the *what*): for an idle settler (a job, no atomic running, not
 *     travelling), choose the next atomic in the harvest→carry→pileup chain — either issue a
 *     {@link MoveGoal} to walk to the next target (a resource, then a store), or, once standing on
 *     that target, start the {@link CurrentAtomic} the AtomicSystem will execute.
 *  2. {@link navigationPlanner} (the *where*): turn a {@link MoveGoal} on a path-less, request-less
 *     entity into a {@link PathRequest}; PathfindingSystem routes it, MovementSystem walks it, and
 *     the goal is removed on arrival.
 *
 * The split mirrors the original: the atomic vocabulary is the soul of the behavior, and navigation
 * is just how a settler physically reaches an atomic's target. The atomic planner runs first so a
 * freshly-set goal is picked up by the navigation pass in the same tick (no one-tick stall).
 *
 * Determinism: no RNG, no wall-clock; entities are visited in deterministic store order and every
 * choice is a pure function of the settler's components + the (canonically-scanned) world. No-ops
 * without a terrain graph (a mapless sim has no cells to navigate over — the golden is untouched).
 */
export const aiSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to navigate over
  atomicPlanner(world, ctx, ctx.terrain);
  navigationPlanner(world, ctx.terrain);
};

/**
 * The atomic-utility planner: pick the next atomic for each idle settler and drive the
 * harvest→carry→pileup chain.
 *
 * A settler is *idle* when it has a {@link Settler} + {@link Position} but no {@link CurrentAtomic}
 * running and is not currently travelling (no {@link MoveGoal}/{@link PathRequest}/{@link PathFollow}).
 * For each idle settler, in deterministic store order, the planner decides the next step from the
 * settler's state — a small state machine over "am I carrying anything?" and "what am I standing on?":
 *
 *  - Carrying goods, standing on a store that can stock them → start a `pileup` atomic.
 *  - Carrying goods, not on a suitable store → set a {@link MoveGoal} to the nearest such store.
 *  - Empty-handed, standing on a harvestable resource its job is allowed to harvest → start a
 *    `harvest` atomic (the resource's good's harvest atomic, gated by the job's `allowedAtomics`).
 *  - Empty-handed, not on a resource → set a {@link MoveGoal} to the nearest harvestable resource.
 *
 * The atomic id and its duration come from CONTENT, not code: the harvest atomic is the resource
 * good's `atomics.harvest`, and `duration` is resolved through the tribe's `setatomic` binding →
 * `atomicAnimations` length (see {@link atomicDuration}). This is the data-driven planner the
 * roadmap calls for — behavior is the atomic vocabulary, not bespoke per-job logic.
 *
 * "Utility" is minimal here (nearest reachable target by Manhattan distance, harvest-or-deposit by
 * load state); hunger/needs and job assignment are later slices (NeedsSystem/JobSystem). Targets are
 * scanned in canonical (ascending entity-id) order with a deterministic distance+id tie-break, so
 * the choice never depends on store insertion history.
 */
function atomicPlanner(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  // Build each target category ONCE per tick (ascending entity-id, canonical). Without this every idle
  // settler re-scanned + re-sorted the WHOLE world per `nearest*` call — `canonicalEntities()` is an
  // alloc+sort of all entities — so the planner was O(settlers · entities · log n) and pinned a big idle
  // crowd at ~480 ms/tick. Scanning a per-tick candidate list is O(candidates); the ascending-id order
  // matches the old full scan, so the distance+id tie-break picks the identical winner (goldens hold).
  const targets = collectTargets(world);
  // Dormancy gate: the carrier fallback (`nearestWorkplaceOutput`) is a full stockpile scan per settler.
  // If NOTHING is haulable anywhere this tick, every settler's scan returns null — so decide it ONCE and
  // let idle settlers skip the scan (identical outcome, no per-settler work). This is what makes an idle
  // crowd cost ~0: a settler with no reachable work does not re-scan the world every tick.
  const anyHaulable = hasHaulableOutput(world, ctx, targets.stockpiles);
  for (const e of world.query(Settler, Position)) {
    // Busy: an atomic is running, or the settler is en route to a target. Leave it to play out.
    if (world.has(e, CurrentAtomic)) continue;
    if (world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow)) continue;

    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // A baby/child is a non-working life stage: it runs no atomics and, faithful to the original (a baby
    // is cared for, it doesn't self-feed), does NOT run the adult needs-drives (eat/sleep/pray) — it just
    // grows up (GrowthSystem). Key on the Age COMPONENT, not on `isNonWorkingAge(jobType)`: Age is present
    // ⟺ the settler is in a baby/child stage (the GrowthSystem invariant), and keying on it avoids a
    // jobType-id collision — a synthetic fixture's adult job id can coincide with a real age-class id (the
    // golden slice's woodcutter is jobType 1, the same number as `baby_female`), but only a settler BORN
    // young carries an Age, so an adult worker is never mistaken for a child.
    if (world.has(e, Age)) continue;

    const p = world.get(e, Position);
    const here = terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
    const load = world.tryGet(e, Carrying);

    // The EAT DRIVE (highest priority): a settler whose hunger has crossed the threshold stops what
    // it is doing to eat, closing the rise→eat→reset loop. It eats its own carried food first (no
    // walk needed), else heads to the nearest store holding food. Above harvest/haul/staffing so a
    // starving operator leaves its workplace to feed rather than work itself to death.
    if (settler.hunger >= HUNGER_EAT_THRESHOLD) {
      if (load !== undefined && load.amount > 0 && isFood(ctx, load.goodType)) {
        // Carrying food: eat a unit on the spot (consumed from the carried load).
        startAtomic(
          world,
          e,
          EAT_ATOMIC_ID,
          { kind: 'eat', goodType: load.goodType, from: null },
          atomicDuration(ctx, settler, EAT_ATOMIC_ID),
          e,
        );
        continue;
      }
      const food = nearestFoodStore(targets.stockpiles, world, ctx, terrain, here);
      if (food !== null) {
        const cell = entityCell(world, ctx, terrain, food.store);
        if (cell === here) {
          startAtomic(
            world,
            e,
            EAT_ATOMIC_ID,
            { kind: 'eat', goodType: food.goodType, from: food.store },
            atomicDuration(ctx, settler, EAT_ATOMIC_ID),
            food.store,
          );
        } else {
          world.add(e, MoveGoal, { cell });
        }
        continue;
      }
      // Hungry but no food anywhere reachable: fall through to normal work (the loop above keeps
      // hunger clamped at ONE; a later slice handles starvation when food is truly absent).
    }

    // The SLEEP DRIVE (below eat — a starving settler eats before it can rest): a settler whose
    // fatigue has crossed the threshold sleeps IN PLACE to clear it (no walk, no target site).
    // Above harvest/haul/staffing so a worn-out operator stops working to rest. Sleeping where it
    // stands is the slice stand-in for the original's home-bound sleep — the housing/home system
    // that would give a sleep target doesn't exist yet (see docs/FIDELITY.md).
    if (settler.fatigue >= FATIGUE_SLEEP_THRESHOLD) {
      startAtomic(
        world,
        e,
        SLEEP_ATOMIC_ID,
        { kind: 'sleep' },
        atomicDuration(ctx, settler, SLEEP_ATOMIC_ID),
        e,
      );
      continue;
    }

    // The PRAY DRIVE (below eat + sleep — survival needs outrank devotion): the first **target-bound**
    // need. Unlike eat (at a store) / sleep (in place), praying requires WALKING TO A TEMPLE, so the
    // planner does a need→satisfier→building-target lookup: find the nearest temple, set a MoveGoal to
    // it, and once standing on it start the `pray` atomic (which zeroes piety on completion). A piety
    // ≥ threshold settler with no temple anywhere falls through to normal work (piety stays clamped at
    // ONE — a settlement with no temple has no way to pray, like the original).
    if (settler.piety >= PIETY_PRAY_THRESHOLD) {
      const temple = nearestTemple(targets.buildings, world, ctx, terrain, here);
      if (temple !== null) {
        const cell = entityCell(world, ctx, terrain, temple);
        if (cell === here) {
          startAtomic(
            world,
            e,
            PRAY_ATOMIC_ID,
            { kind: 'pray' },
            atomicDuration(ctx, settler, PRAY_ATOMIC_ID),
            temple,
          );
        } else {
          world.add(e, MoveGoal, { cell });
        }
        continue;
      }
      // Devout but no temple reachable: fall through to normal work (piety stays pinned at ONE).
    }

    // The production operator: a settler empty-handed and standing on a workplace whose `workers`
    // names its job is "at work" — the ProductionSystem's worker-presence gate runs on its being
    // there. Leave it put (don't send it off to harvest/haul, which would unstaff the workplace).
    // Carrying goods overrides (it must still deposit its load); a store (no recipe) doesn't pin.
    if ((load === undefined || load.amount <= 0) && staffsBoundWorkplaceHere(world, ctx, e)) {
      continue;
    }

    if (load !== undefined && load.amount > 0) {
      // Loaded: take the goods to a store that can stock them.
      const store = nearestStoreFor(targets.stockpiles, world, ctx, terrain, here, load.goodType);
      if (store === null) continue; // nowhere to deposit — idle this tick (a later slice may wait/drop)
      const cell = entityCell(world, ctx, terrain, store);
      if (cell === here) {
        startAtomic(
          world,
          e,
          PILEUP_ATOMIC_ID,
          { kind: 'pileup', store },
          atomicDuration(ctx, settler, PILEUP_ATOMIC_ID),
          store,
        );
      } else {
        world.add(e, MoveGoal, { cell });
      }
      continue;
    }

    // The WALK-TO-WORKPLACE drive: an employed, empty-handed settler that ISN'T yet on its bound
    // workplace (the staffs-here pin above didn't fire) walks to the specific building the JobSystem
    // bound it to ({@link JobAssignment}). A freshly-assigned operator standing elsewhere (e.g. a
    // carpenter spawned at the HQ, whose job can harvest nothing) must physically reach its station
    // before the ProductionSystem's worker-presence gate can run — without this it would fall through
    // to harvest/haul and never staff the workplace. Heading for ITS bound building (not "nearest
    // unstaffed") keeps the worker latched to its own mill across a brief step-off the tile, and lets
    // two same-type workplaces staff independently. A settler whose job a resource permits still
    // reaches harvest below when it has no binding (an unassigned harvester returns from here at null).
    const station = boundWorkplaceTarget(world, ctx, e, settler.jobType, settler.tribe);
    if (station !== null) {
      world.add(e, MoveGoal, { cell: entityCell(world, ctx, terrain, station) });
      continue;
    }

    // Empty-handed: go harvest. Pick the nearest resource this settler is allowed to harvest — gated
    // both by its job's atomic permissions AND by its accrued XP clearing the good's `needforgood`
    // threshold (the who-may-do-it gate). `jobType` is non-null here (guarded above).
    const node = nearestHarvestableFor(targets.resources, world, ctx, terrain, here, {
      jobType: settler.jobType,
      tribe: settler.tribe,
      experience: settler.experience,
    });
    if (node !== null) {
      const res = world.get(node, Resource);
      const cell = entityCell(world, ctx, terrain, node);
      if (cell === here) {
        startAtomic(
          world,
          e,
          res.harvestAtomic,
          { kind: 'harvest', resource: node, goodType: res.goodType },
          atomicDuration(ctx, settler, res.harvestAtomic),
          node,
        );
      } else {
        world.add(e, MoveGoal, { cell });
      }
      continue;
    }

    // Nothing to harvest: act as a carrier — haul finished outputs out of a workplace to a store
    // that can stock them (so a producing workplace doesn't clog on its own output and goods reach
    // the settlement's stores). Nearest workplace with a haulable output it can deliver somewhere.
    const haul = anyHaulable ? nearestWorkplaceOutput(targets.stockpiles, world, ctx, terrain, here) : null;
    if (haul === null) continue; // nothing to harvest AND nothing to haul — idle this tick
    const cell = entityCell(world, ctx, terrain, haul.workplace);
    if (cell === here) {
      // Lift a batch sized by the tribe's best unlocked vehicle (`stockSlots`), or one unit on foot
      // when no vehicle is available — `pickupFromStore` caps the move to what the source actually holds.
      const load = carrierCarryCapacity(world, ctx, settler.tribe);
      startAtomic(
        world,
        e,
        PICKUP_ATOMIC_ID,
        { kind: 'pickup', goodType: haul.goodType, amount: load, from: haul.workplace },
        atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
        haul.workplace,
      );
    } else {
      world.add(e, MoveGoal, { cell });
    }
  }
}

/**
 * The numeric atomic id a settler runs to eat (the original's `setatomic <job> 10 "..._eat_slot_food"`
 * — id 10 is the eat slot across every tribe's bindings; see docs/FIDELITY.md). Like the other ids
 * it is the content cross-reference / animation join key; the typed `eat` effect is the behavior
 * (consume one unit of food + reset hunger, AtomicSystem).
 */
const EAT_ATOMIC_ID = 10;

/**
 * Hunger level (fixed-point, in [0, ONE]) at or above which a settler stops working to eat. Set to
 * ¾ of a full bar: a settler works most of the way up the hunger bar, then seeks food before it
 * pins at ONE. APPROXIMATED (see docs/FIDELITY.md): the original drives eating off the per-animation
 * hunger events (`event 30 2 <delta>` against a ~10000-scale bar) with no single readable "go eat at
 * X" threshold; this constant is the slice's deterministic eat trigger until that vocabulary is
 * decoded and calibration-by-observation pins the real cadence.
 */
const HUNGER_EAT_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * The numeric atomic id a settler runs to sleep (the original's `setatomic <job> 8 "..._sleep"` — id
 * 8 is the sleep slot across every tribe's bindings, bound for every job, even babies; see
 * docs/FIDELITY.md). Like the other ids it is the content cross-reference / animation join key; the
 * typed `sleep` effect is the behavior (zero fatigue, AtomicSystem).
 */
const SLEEP_ATOMIC_ID = 8;

/**
 * Fatigue level (fixed-point, in [0, ONE]) at or above which a settler stops working to sleep. Set to
 * ¾ of a full bar, mirroring {@link HUNGER_EAT_THRESHOLD}: a settler works most of the way up the
 * fatigue bar, then rests before it pins at ONE. APPROXIMATED (see docs/FIDELITY.md): like the eat
 * trigger, the original drives sleeping off the per-animation rest events (`event <at> 1 <delta>`)
 * with no single readable "sleep at X" threshold; this constant is the slice's deterministic sleep
 * trigger until that vocabulary is decoded and calibration-by-observation pins the real cadence.
 */
const FATIGUE_SLEEP_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * The numeric atomic id a settler runs to pray (the original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY
 * = 12`, bound `setatomic 6 12 "..._pray"` for the civilist job across tribes; see docs/FIDELITY.md).
 * Like the other ids it is the content cross-reference / animation join key; the typed `pray` effect
 * is the behavior (zero piety, AtomicSystem).
 */
const PRAY_ATOMIC_ID = 12;

/**
 * Piety level (fixed-point, in [0, ONE]) at or above which a settler stops working to pray, mirroring
 * {@link HUNGER_EAT_THRESHOLD}/{@link FATIGUE_SLEEP_THRESHOLD} at ¾ of a full bar. APPROXIMATED (see
 * docs/FIDELITY.md): like the eat/sleep triggers, the original drives praying off the per-animation
 * devotion events with no single readable "pray at X" threshold; this constant is the slice's
 * deterministic pray trigger until that vocabulary is decoded and calibration-by-observation lands.
 */
const PIETY_PRAY_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/** The numeric atomic id for a carrier picking goods up out of a store (the original's generic
 *  pickup=22; like {@link PILEUP_ATOMIC_ID} the readable data binds no per-good pickup, and the id is
 *  only a content cross-reference / animation join key — the typed `pickup` effect is the behavior). */
const PICKUP_ATOMIC_ID = 22;

/** The numeric atomic id used for depositing a carried load into a store. The READABLE data binds
 *  no per-good "pileup" atomic (harvest/produce are good-keyed; pickup=22/pileup are generic), and
 *  the id is only a content cross-reference / animation join key — the *effect* (typed `pileup`) is
 *  what the AtomicSystem applies. A constant keeps the planner data-driven where it matters (the
 *  harvest atomic IS read from content) without inventing a per-good deposit binding the data lacks. */
const PILEUP_ATOMIC_ID = 23;

/**
 * Start a {@link CurrentAtomic} on a settler: the executor (AtomicSystem) will advance it and apply
 * `effect` on completion. `duration` is the animation length in ticks (clamped to ≥1 by the
 * executor); `target` is the action's object (the resource/store), recorded for render/inspection.
 */
function startAtomic(
  world: World,
  settler: Entity,
  atomicId: number,
  effect: AtomicEffect,
  duration: number,
  target: Entity,
): void {
  world.add(settler, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect,
    targetEntity: target,
    targetTile: null,
  });
}

/**
 * The atomic planner's target candidates for one tick, each an **ascending-entity-id** list — the same
 * order `world.canonicalEntities()` scanned, so the distance + id tie-break in every `nearest*` helper
 * still picks the identical winner (goldens stay byte-identical). Built once per tick by {@link
 * collectTargets} and shared across all settlers instead of each re-scanning + re-sorting the whole world.
 */
interface TargetCandidates {
  /** Harvest targets: entities with {@link Resource} + {@link Position}. */
  readonly resources: readonly Entity[];
  /** Stores / food stores / workplace outputs: entities with {@link Stockpile} + {@link Position}. */
  readonly stockpiles: readonly Entity[];
  /** Building-keyed targets (temples): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
}

/**
 * Snapshot the planner's target categories once for the tick. Each `query` is one pass over the matching
 * entities; {@link canonicalById} makes the scan order canonical (ascending id), matching the old
 * full-world scan so the winner — and therefore every golden — is unchanged. This is what turns the
 * planner from `O(settlers · entities · log n)` (per-settler re-scan + re-sort of the world) into
 * `O(entities + settlers · candidates)`, the fix for the big-crowd stall (see {@link atomicPlanner}).
 */
function collectTargets(world: World): TargetCandidates {
  return {
    resources: canonicalById(world.query(Resource, Position)),
    stockpiles: canonicalById(world.query(Stockpile, Position)),
    buildings: canonicalById(world.query(Building, Position)),
  };
}

/**
 * The nearest harvestable {@link Resource} the given settler is allowed to harvest, by fixed-point
 * Manhattan distance from `here`, with ascending-cell-id as the deterministic tie-break. A resource
 * is eligible only if it has units remaining AND its harvest passes **both** data-driven gates:
 *
 *  - the job's `allowedAtomics` permits the resource good's harvest atomic (a woodcutter harvests
 *    trees, not ore — {@link jobAtomics});
 *  - the settler's accrued XP clears the harvested good's `needforgood` thresholds for its tribe
 *    ({@link settlerMeetsNeed}) — the *who-may-do-it* progression gate, the per-settler sibling of the
 *    production-side tribe-presence `jobEnablesGood` gate. A settler trains a good's track by
 *    harvesting it (`grantWorkExperience`), so a low-XP settler is held out of the goods whose
 *    threshold it hasn't yet reached; an unthresholded good (no `needforgood`) is harvestable by any
 *    settler, so this gate is inert where no requirement exists.
 *
 * Returns the resource entity, or null if none qualifies. Scanned in canonical entity-id order so the
 * result never depends on store insertion history. Determinism: both gates are pure reads over content
 * + the settler's components (no RNG/wall-clock).
 */
function nearestHarvestableFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  settler: { jobType: number; tribe: number; experience: ReadonlyMap<number, number> },
): Entity | null {
  const allowed = jobAtomics(ctx, settler.jobType);
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) continue;
    if (!world.has(e, Position)) continue;
    if (!allowed.has(res.harvestAtomic)) continue; // data-driven gate: job must permit this atomic
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    if (!settlerMeetsNeed(ctx, settler.tribe, 'good', res.goodType, settler.experience)) continue;
    const cell = entityCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest store (a {@link Building} with a {@link Stockpile}) that can stock `goodType` — i.e.
 * its building type declares a stock slot for that good and the slot is not already full — by
 * Manhattan distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order.
 * Returns the store entity or null if none can take the good.
 *
 * A workplace that PRODUCES `goodType` (a recipe output) is never a delivery target for it — goods
 * are hauled *out* of a producer to a store, never back into it (otherwise a carrier would deposit
 * its load straight back where it picked it up and livelock). A workplace consuming the good as an
 * input, or a passive store, is a valid sink.
 */
function nearestStoreFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  goodType: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe?.outputs.some((o) => o.goodType === goodType)) continue; // never deliver to its producer
    const stock = world.get(e, Stockpile);
    const have = stock.amounts.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this good — skip
    const cell = entityCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that holds at least one unit of an
 * edible good ({@link isFood}), by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. Returns the store and the specific food good to eat, or null
 * if no reachable store holds food. The good within a store is chosen in canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order — so the choice never
 * depends on store insertion history. A producing workplace counts too (a settler eats the food it
 * makes); the eater consumes one unit on the `eat` atomic's completion (AtomicSystem).
 */
function nearestFoodStore(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): { store: Entity; goodType: number } | null {
  let best: { store: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const stock = world.get(e, Stockpile);
    const cell = entityCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0 || !isFood(ctx, goodType)) continue;
      if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
        best = { store: e, goodType };
        bestDist = dist;
        bestCell = cell;
      }
      break; // this store's lowest-id food good is its candidate; move to the next store
    }
  }
  return best;
}

/**
 * The nearest {@link isTemple temple} a devout settler should walk to in order to pray, by Manhattan
 * distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order. Returns the
 * temple entity or null if no temple exists. This is the piety need's satisfier→building-target lookup
 * — the genuinely-new piece a target-bound need introduces (eat resolves to a store, sleep to no site;
 * pray resolves to a specific building the settler must reach).
 */
function nearestTemple(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Building) || !world.has(e, Position)) continue;
    if (!isTemple(world, ctx, e)) continue;
    const cell = entityCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest workplace with a finished output good a carrier should haul away to a store. A
 * candidate is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (it is a workplace, so a stocked good is finished output, not a passive store's reserve), holding
 * at least one unit of one of its recipe's output goods that a *different* store can stock. Returns
 * the workplace and the specific good to haul, or null if nothing needs hauling.
 *
 * Determinism: workplaces are scanned in canonical entity-id order with a Manhattan-distance +
 * ascending-cell-id tie-break; within a workplace the good is chosen by canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order. The "some other
 * store can take it" check ({@link nearestStoreFor}) keeps the carrier from picking up a good it
 * could never deliver (which would just shuttle it back and forth).
 */
/**
 * Whether ANY workplace holds a haulable output this tick — a producing {@link Building} ({@link recipeOf}
 * defined) whose {@link Stockpile} holds ≥1 unit of one of its recipe outputs. The population-level gate
 * for {@link nearestWorkplaceOutput}: if this is false no carrier can haul, so idle settlers skip the
 * per-settler scan entirely (the same "holds an output" test the scan's inner loop applies, so a false
 * here means every scan would return null — identical behavior, done once instead of per settler). It is
 * deliberately WEAKER than the full scan (no "a store can take it" check): a true still runs the real
 * scan, which returns null if delivery is impossible — the gate only ever elides a provably-empty scan.
 */
function hasHaulableOutput(world: World, ctx: SystemContext, stockpiles: readonly Entity[]): boolean {
  for (const e of stockpiles) {
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue;
    const stock = world.get(e, Stockpile);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount > 0 && recipe.outputs.some((o) => o.goodType === goodType)) return true;
    }
  }
  return false;
}

function nearestWorkplaceOutput(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): { workplace: Entity; goodType: number } | null {
  let best: { workplace: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a workplace — passive stores aren't hauled FROM
    const stock = world.get(e, Stockpile);
    const cell = entityCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    // Canonical (ascending goodType) so the chosen good never depends on Map insertion history.
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0) continue;
      if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
      // Deliverability check reuses the SAME stockpile candidates (a store is a Stockpile+Position too).
      if (nearestStoreFor(candidates, world, ctx, terrain, cell, goodType) === null) continue;
      if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
        best = { workplace: e, goodType };
        bestDist = dist;
        bestCell = cell;
      }
      break; // this workplace's lowest haulable goodType is its candidate; move to the next workplace
    }
  }
  return best;
}

/**
 * The set of atomic ids a job may run: its `allowedAtomics` ∪ `baseAtomics`, minus `forbiddenAtomics`
 * (an explicit denial overrides an allow). An unknown jobType yields an empty set (no permissions),
 * so a settler with a job absent from content harvests nothing rather than everything. This is the
 * data-driven permission gate from `jobtypes` — the planner picks atomics the job is allowed, never
 * a hardcoded per-job list.
 */
function jobAtomics(ctx: SystemContext, jobType: number): ReadonlySet<number> {
  const job = ctx.content.jobs.find((j) => j.typeId === jobType);
  if (job === undefined) return EMPTY_ATOMICS;
  const set = new Set<number>(job.allowedAtomics);
  for (const a of job.baseAtomics) set.add(a);
  for (const a of job.forbiddenAtomics) set.delete(a);
  return set;
}

const EMPTY_ATOMICS: ReadonlySet<number> = new Set<number>();

/**
 * Whether the settler is standing on its **bound workplace** ({@link JobAssignment}) and that building
 * is a producing workplace it staffs — a {@link Building} with a `recipe` (not a passive store/HQ),
 * sharing the settler's integer tile, whose `workers` slots name the settler's `jobType`. Such a
 * settler is the workplace's operator — the atomic planner leaves it put so the ProductionSystem's
 * worker-presence gate stays satisfied. An unbound settler is never pinned (it has no station yet).
 *
 * Keying on the binding (not on standing-on-*any*-workplace) is what keeps a worker latched to ITS
 * mill: a woodcutter the HQ lists as a worker isn't frozen on the HQ (its binding is the sawmill, or
 * it has none and must go harvest), and a brief step onto a *different* same-type mill doesn't re-home
 * it. Determinism: a single binding lookup + a positional compare, no chosen-entity ordering.
 */
function staffsBoundWorkplaceHere(world: World, ctx: SystemContext, settler: Entity): boolean {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return false; // unemployed/unbound: nothing pins it here
  const s = world.get(settler, Settler);
  if (s.jobType === null) return false; // job was cleared but binding lingers — not an operator
  const b = binding.workplace;
  if (recipeOf(world, ctx, b) === undefined) return false; // bound building isn't a producing workplace
  if (!buildingWorkerJobs(world, ctx, b).has(s.jobType)) return false; // doesn't employ this job
  const at = interactionTile(world, ctx, b); // the door cell — where an operator stands (footprint types)
  const sp = world.tryGet(settler, Position);
  if (at === null || sp === undefined) return false;
  return at.x === fx.toInt(sp.x) && at.y === fx.toInt(sp.y);
}

/**
 * The building a bound `tribe` settler of `jobType` should WALK TO in order to staff it — its
 * {@link JobAssignment} workplace, the target of the walk-to-workplace drive (the movement half
 * {@link staffsBoundWorkplaceHere}, the already-here pin, was missing). The settler heads for *its own*
 * mill, not the nearest unstaffed one, so it stays latched across a brief step-off and two same-type
 * workplaces staff independently. Returns the bound building, or null when the settler isn't bound to
 * a usable station (so it falls through to harvest/haul) — which holds when:
 *
 *  - it has no {@link JobAssignment} (an unassigned harvester — go harvest), OR
 *  - the bound building is gone / not a producing workplace it staffs / not tech-enabled / not the
 *    same tribe — a stale or unusable binding, treated as "no station" so the settler isn't stranded.
 *
 * Determinism: a single binding lookup + pure predicate checks, no chosen-entity ordering. (`terrain`
 * and `here` are unused now the target is the bound building rather than a nearest-of search, but kept
 * for signature symmetry with the other drive targets; the navigation pass routes to it.)
 */
function boundWorkplaceTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): Entity | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null; // unassigned: no station to walk to
  const b = binding.workplace;
  const building = world.tryGet(b, Building);
  if (building === undefined || building.tribe !== tribe) return null; // gone / wrong tribe
  if (recipeOf(world, ctx, b) === undefined) return null; // not a producing workplace
  if (!buildingWorkerJobs(world, ctx, b).has(jobType)) return null; // doesn't employ this job
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null; // not tech-enabled yet
  if (!world.has(b, Position)) return null; // a position-less workplace can't be walked to
  return b;
}

/**
 * The cell a walk-to / are-we-there target resolves to. For a {@link Building} this is its
 * **interaction tile** — the door cell when the type's footprint names one ({@link interactionTile}),
 * since the walls themselves are now walk-blocked and the original's settlers enter through the door.
 * Everything else (a resource node, a bare store fixture, a boat hull) keeps its {@link Position}
 * tile. Distances, walk goals, and the `cell === here` arrival checks all resolve through here, so
 * the goal a settler walks to and the tile that counts as "at the building" can never disagree.
 */
function entityCell(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): CellId {
  const at = interactionTile(world, ctx, e);
  if (at !== null) return terrain.cellAtClamped(at.x, at.y);
  const p = world.get(e, Position);
  return terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
}

/**
 * The navigation planner: turn a {@link MoveGoal} on a path-less, request-less entity into a
 * {@link PathRequest} from the entity's current cell to the goal cell. The PathfindingSystem turns
 * that into a path and the MovementSystem walks it; when the entity reaches the goal cell the goal is
 * satisfied and removed. A goal whose request just failed (no route) is left in place but not
 * re-issued this tick — the failed flag is the planner's signal; a future slice decides abandon/wait/
 * repath. This is the *where* layer; {@link atomicPlanner} (the *what*) sets the goals.
 *
 * Determinism: no RNG, no wall-clock; entities are visited in the PathFollow/PathRequest-free subset
 * of the deterministic MoveGoal store order, and the action (issue a request, or remove a satisfied
 * goal) is a pure function of the entity's position and goal.
 */
function navigationPlanner(world: World, terrain: TerrainGraph): void {
  for (const e of world.query(Position, MoveGoal)) {
    // Already travelling — a request is queued or a path is being followed. Leave it to play out.
    if (world.has(e, PathRequest) || world.has(e, PathFollow)) continue;

    const goalCell = world.get(e, MoveGoal).cell;
    if (!inRange(terrain, goalCell)) {
      // An unreachable/off-map goal can never be satisfied; drop it rather than issue dead requests
      // every tick. (A planner that owns the goal can re-add a valid one.)
      world.remove(e, MoveGoal);
      continue;
    }

    const p = world.get(e, Position);
    const startCell = terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
    if (startCell === goalCell) {
      world.remove(e, MoveGoal); // arrived (or started on the goal): the goal is satisfied
      continue;
    }

    // Not there yet and not travelling: issue a fresh route request from where we stand to the goal.
    world.add(e, PathRequest, { start: startCell, goal: goalCell, failed: false });
  }
}
