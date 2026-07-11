import {
  Age,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Owner,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  Stance,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { NodeBuckets, canonicalById, isTravelling } from '../spatial.js';
import { boundWorkplaceTarget, collectTargets, hasHaulableOutput } from './ai-targets.js';
import { type SpacingState, deStackIdle } from './destack.js';
import {
  planBuilder,
  planCarrierHaul,
  planDelivery,
  planGatherer,
  planPorter,
  planProducer,
} from './drives-economy.js';
import { collectFarmClaims, planFarmer, releaseFarmTask } from './drives-farming.js';
import { planNeeds } from './drives-needs.js';
import { navigationPlanner } from './navigation.js';

/**
 * AISystem — the settler planner: two layered passes per tick.
 *
 *  1. {@link atomicPlanner} (the *what*): for an idle settler (a job, no atomic running, not
 *     travelling), run the drive ladder — needs (./drives-needs.ts), then the economy drives
 *     (./drives-economy.ts) — and either issue a MoveGoal to walk to the chosen target or start the
 *     CurrentAtomic the AtomicSystem will execute.
 *  2. {@link navigationPlanner} (the *where*, ./navigation.ts): turn a MoveGoal on a path-less,
 *     request-less entity into a PathRequest; PathfindingSystem routes it, MovementSystem walks it,
 *     and the goal is removed on arrival.
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
 * The atomic-utility planner: pick the next atomic for each idle settler by running the drive
 * ladder, in this fixed priority order (each drive returns `true` when it takes the settler for
 * this tick):
 *
 *   needs (eat > sleep > pray) → combat/hold gates → deliver a carried load → bound-farmer field loop →
 *   bound-producer loop → gather (chop/collect) → porter ferrying → carrier fallback → idle de-stack.
 *
 * The ORDER is part of the design (and of the goldens): needs sit ABOVE the combat/hold gates so a
 * starving combatant still feeds (a soft override), and the economy rungs go most-specific-first so
 * a gatherer works its own trade before ferrying others' goods.
 *
 * The atomic id and its duration come from CONTENT, not code (the drives resolve them through the
 * tribe's `setatomic` binding — see ./actions.ts); "utility" is minimal (nearest reachable target by
 * Manhattan distance). Targets are scanned in canonical (ascending entity-id) order with a
 * deterministic distance+cell tie-break, so the choice never depends on store insertion history.
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
  // Spacing occupancy — shared by BOTH spacing consumers (the idle de-stack rung and the builder
  // work slots, see ./destack.ts): owned settlers currently AT REST (not travelling) bucketed by
  // integer tile, in ascending-id order. Gated on Owner so it only ever moves gameplay
  // (player-owned) units; the unowned golden/economy fixtures build an empty bucket set, so their
  // planner output is byte-identical. Built ONCE from the tick-start positions (stable across the
  // loop's own mutations).
  const restingOwned = canonicalById(world.query(Settler, Position, Owner)).filter(
    (e) => !isTravelling(world, e),
  );
  const spacing: SpacingState = { occupancy: new NodeBuckets(world, restingOwned), claimed: new Set() };
  // Farm claims: every farmer still WALKING to or SWINGING at a field target (its live FarmTask) plus
  // the farmers planned earlier this tick reserve their nodes — so two farmers never shadow each other
  // to the same field/sheaf/sow spot, across ticks as well as within one (see drives-farming.ts).
  const farmClaims = collectFarmClaims(world);

  for (const e of world.query(Settler, Position)) {
    // Busy: an atomic is running, or the settler is en route to a target. Leave it to play out (its
    // FarmTask claim, if any, stays live so colleagues keep avoiding its target).
    if (world.has(e, CurrentAtomic)) continue;
    if (isTravelling(world, e)) continue;
    // Replanning from here: the settler's previous farm intent is spent/stale — release its claim so
    // it never blocks ITSELF from re-choosing (planFarmer re-stamps a fresh task if it takes over).
    releaseFarmTask(world, e, farmClaims);
    // Likewise its rest-inside marker: the drive re-stamps it within this same tick if there is still
    // nothing to do (so the render never sees a gap), and it stays off the moment real work appears.
    world.remove(e, Resting);

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
    const hereNode = nodeOfPosition(p.x, p.y);
    const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
    const load = world.tryGet(e, Carrying);

    // NEEDS (highest priority): eat > sleep > pray. An unsatisfiable need falls through to work.
    if (planNeeds(world, ctx, terrain, e, settler, here, load, targets)) continue;

    // COMBAT / HOLD gates — a unit combat or the player currently owns skips economy planning. All
    // four sit BELOW the needs drives on purpose (soft overrides — hunger/fatigue/piety still pull
    // the unit away, faithful to the autonomous-settler model):
    //  - Engagement: fighting/advancing — the CombatSystem owns its movement (the chase) and its
    //    atomic (the swing); it clears the marker when the fight ends.
    //  - Fleeing: running from danger (the FLEE stance's active drive) — matters while it STANDS
    //    (boxed in, or in the flee cool-down); while running it carries a MoveGoal and was skipped
    //    above. combatSystem sheds the marker when the threat is gone; a COLLAPSING need overrides
    //    the flee inside combatSystem, so this never traps a starving unit.
    //  - DEFEND stance: a guard HOLDS its post against the economy (the CombatSystem walks it back
    //    when displaced); owned-only, so unowned/golden fixtures are untouched.
    //  - PlayerOrder: a unit standing where the human sent it stays put until the timed hold expires
    //    (playerOrderSystem removes the order), then the economy re-tasks it.
    if (world.has(e, Engagement)) continue;
    if (world.has(e, Fleeing)) continue;
    const stance = world.tryGet(e, Stance);
    if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) continue;
    if (world.has(e, PlayerOrder)) continue;

    // The worker view of the settler — re-stated so `jobType`'s non-null narrowing carries into the
    // economy drives' signatures (the ladder skipped jobless settlers above).
    const worker = { tribe: settler.tribe, jobType: settler.jobType, experience: settler.experience };

    // 1. CARRYING — deliver first (a settler must free its hands before any empty-handed work).
    if (load !== undefined && load.amount > 0) {
      planDelivery(world, ctx, terrain, e, worker, here, load, targets);
      continue;
    }

    // Empty-handed from here.

    // 2. FARMER — a worker bound to a FARM (a workplace producing a field-farmed good) runs the field
    // loop: reap ripe > carry sheaves home > sow > water > wait at the farm. Sits ABOVE the producer
    // rung so a farm that also carries an abstract recipe (real extracted content synthesizes one from
    // `logicproduction`) farms its fields instead of standing at the station minting the good.
    if (planFarmer(world, ctx, terrain, e, worker, here, targets, farmClaims)) continue;

    // 2a. PRODUCER — a worker bound to a recipe workshop runs its own supply→produce→deliver loop.
    const workplace = boundWorkplaceTarget(world, ctx, e, worker.jobType, worker.tribe);
    if (workplace !== null) {
      planProducer(world, ctx, terrain, e, worker, here, workplace, targets.stockpiles);
      continue;
    }

    // 2b. BUILD — a builder raises the nearest construction site of its tribe (hammer it, or fetch a
    // material it is short on); a non-builder passes through. `spacing` spreads a site's crew over
    // its yard (see ./destack.ts claimWorkCell).
    if (planBuilder(world, ctx, terrain, e, worker, here, targets, spacing)) continue;

    // 3. HARVEST / COLLECT — a gatherer chops the nearest resource or collects the nearest trunk.
    if (planGatherer(world, ctx, terrain, e, worker, here, targets)) continue;

    // 4. PORTER — a settler bound to a storage fixture ferries loose ground piles into it.
    if (planPorter(world, ctx, terrain, e, worker, here, targets)) continue;

    // 5. CARRIER FALLBACK — haul a finished workplace output to a store; else genuinely idle:
    // de-stack off a shared tile so an idle crowd spreads out (see ./destack.ts).
    if (!planCarrierHaul(world, ctx, terrain, e, worker, here, targets, anyHaulable)) {
      deStackIdle(world, ctx, terrain, e, hereNode.hx, hereNode.hy, spacing);
    }
  }
}
