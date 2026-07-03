import {
  Age,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  Stance,
} from '../../components/index.js';
import type { AtomicEffect } from '../../core/commands.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import { buildingBlockedCells } from '../footprint.js';
import { carrierCarryCapacity } from '../progression.js';
import { MILITARY_MODE } from '../readviews/index.js';
import {
  TileBuckets,
  atomicDuration,
  canonicalById,
  inRange,
  isFood,
  manhattan,
  recipeOf,
} from '../shared.js';
import {
  deliveryTargetFor,
  isPorterBoundToStore,
  nearestGroundPile,
  nearestMissingInputSource,
  workplaceOutputToHaul,
  workplaceProductiveIfStaffed,
} from './ai-supply.js';
import {
  boundWorkplaceTarget,
  collectTargets,
  hasHaulableOutput,
  interactionCell,
  nearestCollectablePileFor,
  nearestFoodStore,
  nearestHarvestableFor,
  nearestTemple,
  nearestWorkplaceOutput,
} from './ai-targets.js';

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
  const targets = collectTargets(world, ctx);
  // Dormancy gate: the carrier fallback (`nearestWorkplaceOutput`) is a full stockpile scan per settler.
  // If NOTHING is haulable anywhere this tick, every settler's scan returns null — so decide it ONCE and
  // let idle settlers skip the scan (identical outcome, no per-settler work). This is what makes an idle
  // crowd cost ~0: a settler with no reachable work does not re-scan the world every tick.
  const anyHaulable = hasHaulableOutput(world, ctx, targets.stockpiles);
  // Idle-spacing occupancy: owned settlers currently AT REST (not travelling) bucketed by integer tile,
  // in ascending-id order. The de-stack drive (the planner's last resort for a unit with nothing to do)
  // reads this so a crowded idle unit steps to a free neighbour instead of standing stacked on top of
  // another — the "characters don't hard-collide, but won't come to REST on an occupied tile" behaviour.
  // Gated on Owner so it only ever moves gameplay (player-owned) units; the unowned golden/economy
  // fixtures build an empty bucket set, so their planner output is byte-identical. Built ONCE from the
  // tick-start positions (stable across the loop's own mutations); `claimed` stops two de-stackers
  // choosing the same free cell, `blockedLazy` memoises the building walk-block overlay for the rare tick
  // one is actually needed.
  const restingOwned = canonicalById(world.query(Settler, Position, Owner)).filter(
    (e) => !world.has(e, MoveGoal) && !world.has(e, PathRequest) && !world.has(e, PathFollow),
  );
  const occupancy = new TileBuckets(world, restingOwned);
  const claimed = new Set<CellId>();
  const blockedLazy: { cells?: ReadonlySet<CellId> } = {};
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
        const cell = interactionCell(world, ctx, terrain, food.store);
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
        const cell = interactionCell(world, ctx, terrain, temple);
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

    // COMBAT ENGAGEMENT: a unit fighting (or advancing on) an enemy skips economy planning — the
    // CombatSystem owns its movement (the chase) and its atomic (the swing), so the economy must not
    // re-task it mid-fight. Placed with the PlayerOrder skip (below the needs drives) so it is a SOFT
    // override — hunger/fatigue/piety can still pull a combatant away, faithful to the autonomous-settler
    // model. combatSystem clears the Engagement when the fight ends, at which point the economy resumes.
    if (world.has(e, Engagement)) continue;

    // FLEEING: a unit running from danger (the FLEE stance's active drive) likewise skips economy planning
    // — the CombatSystem owns its run route. This matters while it stands (boxed in, or arrived at a flee
    // cell during the cool-down); while actively running it already carries a MoveGoal and is skipped above.
    // combatSystem sheds the Fleeing marker when the threat is gone (the cool-down), at which point the
    // economy resumes; a COLLAPSING need overrides the flee inside combatSystem, so this skip never traps a
    // starving unit (it yields the marker first).
    if (world.has(e, Fleeing)) continue;

    // DEFEND stance: a unit guarding a post HOLDS it against the economy — it is not re-tasked to hauling/
    // staffing, so it stays at its anchor (the CombatSystem walks it back when displaced and fights threats
    // in its radius). Placed with the other soft-override skips (below the needs drives), so a guard may
    // still leave to eat/sleep. Owned-ONLY (`Stance` is owned-only), so unowned/golden fixtures are
    // untouched. Without this a DEFEND unit with a civilian job would wander off to work when no enemy is near.
    const stance = world.tryGet(e, Stance);
    if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) continue;

    // PLAYER-ORDER hold: a unit standing where the human sent it stays put — the economy planner below
    // leaves it be. Placed BELOW the needs drives (eat/sleep/pray) on purpose: the move order is a
    // soft, TIMED override, not a lock, so hunger/fatigue/piety still pull the unit away — faithful to
    // the original (a worker returns to work soon; a warrior holds longer; either may wander off to
    // eat/sleep). playerOrderSystem removes the order on hold-expiry or when a need takes over, at
    // which point the economy re-tasks the unit. (While travelling to the spot the unit was already
    // skipped above as busy; this gate matters once it has ARRIVED and is idle.)
    if (world.has(e, PlayerOrder)) continue;

    // 1. CARRYING — deposit the load where it belongs. {@link deliveryTargetFor} routes it: a fetched
    // recipe input to the bound workshop that consumes it, a harvested/collected good to the settler's
    // bound store (a warehouse, or a flag pile), else the nearest capable store (the unchanged default
    // for an unbound hauler — the vertical-slice woodcutter/carrier route exactly as before). A carrying
    // settler always delivers first (it must free its hands before it can staff, harvest, or fetch).
    if (load !== undefined && load.amount > 0) {
      const store = deliveryTargetFor(
        targets.stockpiles,
        world,
        ctx,
        terrain,
        here,
        e,
        settler.jobType,
        settler.tribe,
        load.goodType,
      );
      if (store === null) continue; // nowhere to deposit — idle this tick (a later slice may wait/drop)
      const cell = interactionCell(world, ctx, terrain, store);
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

    // Empty-handed from here.

    // 2. PRODUCER — a worker bound to a recipe workshop runs its OWN supply→produce→deliver loop
    // ({@link planProducer}): stay on the station while a cycle can run, else haul the finished output
    // out to a store, else fetch a missing recipe input from a store that holds it. This is what feeds
    // a workshop whose inputs sit in a warehouse (the harvester delivers there, not straight to the
    // shop) — subsumes the old staffs-here pin AND the walk-to-workplace drive.
    const workplace = boundWorkplaceTarget(world, ctx, e, settler.jobType, settler.tribe);
    if (workplace !== null) {
      planProducer(world, ctx, terrain, e, settler, here, workplace, targets.stockpiles);
      continue;
    }

    // 3. HARVEST / COLLECT — a gatherer either CHOPS the nearest standing resource its job may harvest,
    // or CARRIES OFF the nearest loose trunk of that trade (a felled tree's dropped wood), whichever is
    // nearer. Standing on its own fresh trunk (distance 0) it picks the wood up before walking to the
    // next tree — the original's fell-then-carry collector cadence; on a return trip it takes whichever
    // of {next tree, remaining trunk} is closer. Harvesting is gated by the job's atomic permissions AND
    // the good's `needforgood` XP threshold; collecting an already-dropped good is hauling, not
    // harvesting, so only the job-trade filter applies. Ordered before the porter/carrier drives so a
    // gatherer works its own resources+trunks before ferrying others'. `jobType` is non-null here.
    const node = nearestHarvestableFor(targets.resources, world, ctx, terrain, here, {
      jobType: settler.jobType,
      tribe: settler.tribe,
      experience: settler.experience,
    });
    const trunk = nearestCollectablePileFor(
      targets.groundDrops,
      targets.harvestAtomicByGood,
      world,
      ctx,
      terrain,
      here,
      settler.jobType,
    );
    const nodeDist =
      node !== null
        ? manhattan(terrain, here, interactionCell(world, ctx, terrain, node))
        : Number.POSITIVE_INFINITY;
    // Prefer the trunk on a tie (it is the wood already at hand — grab it before a fresh tree).
    if (trunk !== null && trunk.dist <= nodeDist) {
      const cell = interactionCell(world, ctx, terrain, trunk.pile);
      if (cell === here) {
        const amount = carrierCarryCapacity(world, ctx, settler.tribe);
        startAtomic(
          world,
          e,
          PICKUP_ATOMIC_ID,
          { kind: 'pickup', goodType: trunk.goodType, amount, from: trunk.pile },
          atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
          trunk.pile,
        );
      } else {
        world.add(e, MoveGoal, { cell });
      }
      continue;
    }
    if (node !== null) {
      const res = world.get(node, Resource);
      const cell = interactionCell(world, ctx, terrain, node);
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

    // 4. PORTER — a settler bound to a storage fixture (no recipe) collects the nearest loose ground
    // pile and carries it to its warehouse (the carrying branch above then routes the load there). This
    // is the "tragarz" who ferries goods gatherers drop at a flag into the store they belong to.
    if (isPorterBoundToStore(world, ctx, e)) {
      const pile = nearestGroundPile(targets.stockpiles, world, ctx, terrain, here);
      if (pile !== null) {
        const cell = interactionCell(world, ctx, terrain, pile.pile);
        if (cell === here) {
          const amount = carrierCarryCapacity(world, ctx, settler.tribe);
          startAtomic(
            world,
            e,
            PICKUP_ATOMIC_ID,
            { kind: 'pickup', goodType: pile.goodType, amount, from: pile.pile },
            atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
            pile.pile,
          );
        } else {
          world.add(e, MoveGoal, { cell });
        }
        continue;
      }
    }

    // 5. CARRIER FALLBACK — with nothing to harvest, produce, or collect, act as a carrier: haul a
    // finished workplace output to a store (so a producing workshop doesn't clog and goods reach the
    // settlement's stores). Nearest workplace with a haulable output it can deliver somewhere.
    const haul = anyHaulable ? nearestWorkplaceOutput(targets.stockpiles, world, ctx, terrain, here) : null;
    if (haul === null) {
      // Nothing to harvest and nothing to haul — genuinely idle (every economic drive above declined,
      // and a staffing/held/needing unit already `continue`d earlier). If this owned unit shares its tile
      // with a lower-id resting owned unit, step off to the nearest free cell so the crowd spreads out;
      // the lowest-id occupant is the keeper and holds its ground. A no-op for an unowned fixture (empty
      // occupancy), so goldens are untouched. See {@link deStackIdle}.
      deStackIdle(world, ctx, terrain, e, fx.toInt(p.x), fx.toInt(p.y), occupancy, claimed, blockedLazy);
      continue;
    }
    const cell = interactionCell(world, ctx, terrain, haul.workplace);
    if (cell === here) {
      // Lift a batch sized by the tribe's best unlocked vehicle (`stockSlots`), or one unit on foot
      // when no vehicle is available — `pickupFromStore` caps the move to what the source actually holds.
      const amount = carrierCarryCapacity(world, ctx, settler.tribe);
      startAtomic(
        world,
        e,
        PICKUP_ATOMIC_ID,
        { kind: 'pickup', goodType: haul.goodType, amount, from: haul.workplace },
        atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
        haul.workplace,
      );
    } else {
      world.add(e, MoveGoal, { cell });
    }
  }
}

/**
 * The producer self-service loop for a settler bound to a recipe workshop `workplace` — the behavior
 * behind "kowal fetches the goods a sword needs, forges it, and carries it back". In priority:
 *
 *  a. **Stay & produce** — if staying on the station would run a cycle ({@link workplaceProductiveIfStaffed}:
 *     already producing, or built with all inputs present + output room), walk to the station (if not on
 *     it) and hold there so the ProductionSystem's worker-presence gate stays satisfied.
 *  b. **Haul the output** — else, if the shop holds a finished output a store can take, carry it out
 *     (clears the shop for the next cycle and delivers the product). The carrying branch routes it to a
 *     store, not back to the shop.
 *  c. **Fetch an input** — else, fetch a missing recipe input from a store that holds it (the smith
 *     walking to the warehouse for iron); the carrying branch then delivers it to this workshop.
 *  d. **Wait** — nothing to fetch or haul: return to / hold the station until an input arrives.
 *
 * Every branch is recipe-driven — no per-job or per-good code — so any single-worker workshop self-
 * services. The workplace is known to carry a recipe (the caller's {@link boundWorkplaceTarget} guard).
 */
function planProducer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: { tribe: number; jobType: number | null },
  here: CellId,
  workplace: Entity,
  stockpiles: readonly Entity[],
): void {
  const recipe = recipeOf(world, ctx, workplace);
  if (recipe === undefined) return; // guarded by the caller, but keep the types honest

  // a. Would staying produce a cycle? Be on the station (walk there / hold) so production runs.
  if (workplaceProductiveIfStaffed(world, ctx, workplace, recipe)) {
    walkToOrHold(world, e, here, interactionCell(world, ctx, terrain, workplace));
    return;
  }

  // b. Can't produce now — carry the finished output out to a store first (frees the shop, delivers it).
  const outGood = workplaceOutputToHaul(stockpiles, world, ctx, terrain, workplace, recipe, here);
  if (outGood !== null) {
    const cell = interactionCell(world, ctx, terrain, workplace);
    if (cell === here) {
      const amount = carrierCarryCapacity(world, ctx, settler.tribe);
      startAtomic(
        world,
        e,
        PICKUP_ATOMIC_ID,
        { kind: 'pickup', goodType: outGood, amount, from: workplace },
        atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
        workplace,
      );
    } else {
      world.add(e, MoveGoal, { cell });
    }
    return;
  }

  // c. Fetch a missing recipe input from a store that holds it (the smith going to the warehouse).
  const src = nearestMissingInputSource(stockpiles, world, ctx, terrain, here, workplace, recipe);
  if (src !== null) {
    const cell = interactionCell(world, ctx, terrain, src.store);
    if (cell === here) {
      startAtomic(
        world,
        e,
        PICKUP_ATOMIC_ID,
        { kind: 'pickup', goodType: src.goodType, amount: src.amount, from: src.store },
        atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
        src.store,
      );
    } else {
      world.add(e, MoveGoal, { cell });
    }
    return;
  }

  // d. Nothing to fetch or haul — return to / hold the station and wait for an input to arrive.
  walkToOrHold(world, e, here, interactionCell(world, ctx, terrain, workplace));
}

/** Set a {@link MoveGoal} to `target` unless the settler is already on it (then it stays put). */
function walkToOrHold(world: World, e: Entity, here: CellId, target: CellId): void {
  if (target !== here) world.add(e, MoveGoal, { cell: target });
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

/** Max cells a de-stack ring search visits before giving up — a boxed-in unit simply stays put. */
const SPACING_SEARCH_CAP = 48;

/**
 * The idle-spacing drive: if `e` — a resting, owned, otherwise-idle settler on tile (tileX,tileY) —
 * shares that tile with a LOWER-id resting owned settler, send it (a {@link MoveGoal}) to the nearest
 * free cell so the two don't stand stacked. The lowest-id occupant on the tile is the keeper (it stays);
 * every other occupant steps aside. A unit boxed in (no free cell within the search cap) just stays.
 *
 * This is the sim half of the "no hard collision, but units won't come to rest on an occupied tile"
 * behaviour: transit is never blocked (a walker passes through freely), only a unit that has ARRIVED with
 * nothing to do relocates off a shared tile. Determinism: the keeper test is a canonical id compare; the
 * target is a canonical breadth-first search; `claimed` keeps two de-stackers off the same new cell.
 */
function deStackIdle(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  tileX: number,
  tileY: number,
  occupancy: TileBuckets,
  claimed: Set<CellId>,
  blockedLazy: { cells?: ReadonlySet<CellId> },
): void {
  // Only PLAYER-owned units space out. An unowned settler is NOT in the owned-only `occupancy`, so the
  // keeper test below (`bucket[0] === e`) could never recognise it as the keeper — without this guard an
  // unowned unit sharing a tile with ≥2 owned resting units would wrongly de-stack. Gating here keeps the
  // unowned golden/economy fixtures byte-identical (the stated invariant) and neutrals put in real play.
  if (!world.has(e, Owner)) return;
  const bucket = occupancy.at(tileX, tileY);
  if (bucket.length < 2 || bucket[0] === e) return; // alone on the tile, or the keeper — hold ground
  // Build the building walk-block overlay once, only when a real de-stack is attempted (so a tick with no
  // crowded idle unit pays nothing). Excludes a target under a standing building: routing A* would refuse
  // a blocked goal, and a MoveGoal whose route can't resolve would freeze the unit (nothing clears a
  // failed non-player request), so we never aim at one.
  blockedLazy.cells ??= buildingBlockedCells(world, ctx, terrain);
  const from = terrain.cellAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, occupancy, claimed, blockedLazy.cells);
  if (free === null) return; // boxed in — nothing better than staying
  claimed.add(free);
  world.add(e, MoveGoal, { cell: free });
}

/**
 * The nearest cell to `from` that is walkable, unblocked by a building, holds no resting occupant, and
 * hasn't been claimed by another de-stacker this tick — a breadth-first ring search over the graph's
 * canonical N,E,S,W neighbours (so the first hit at the minimum distance is history-independent),
 * bounded by {@link SPACING_SEARCH_CAP}. Returns null when nothing free is reachable within the cap.
 * Blocked cells are neither entered nor traversed, mirroring the pathfinder that will carry the move out.
 */
function nearestFreeCell(
  terrain: TerrainGraph,
  from: CellId,
  occupancy: TileBuckets,
  claimed: ReadonlySet<CellId>,
  blocked: ReadonlySet<CellId>,
): CellId | null {
  const seen = new Set<CellId>([from]);
  let frontier: CellId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < SPACING_SEARCH_CAP) {
    const next: CellId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || blocked.has(n)) continue;
        seen.add(n);
        visited++;
        const { x, y } = terrain.coordsOf(n);
        if (!claimed.has(n) && occupancy.at(x, y).length === 0) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
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
