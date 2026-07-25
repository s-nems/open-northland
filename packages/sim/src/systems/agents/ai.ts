import { Age, Settler } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dispatchAssistantGrants } from './assistant-grants.js';
import { planAdult, planChild } from './drive-ladder.js';
import { navigationPlanner } from './navigation.js';
import { beginPlannerPass } from './planner-pass.js';
import { releaseStaleIntent } from './replan.js';

/**
 * AISystem — the settler planner: two layered passes per tick.
 *
 *  1. {@link atomicPlanner} (the *what*): for each idle settler (a job, no atomic running, not
 *     travelling), run the drive ladder (./drive-ladder.ts) and either issue a MoveGoal to walk to
 *     the chosen target or start the CurrentAtomic the AtomicSystem will execute.
 *  2. {@link navigationPlanner} (the *where*, ./navigation.ts): turn a MoveGoal on a path-less,
 *     request-less entity into a PathRequest; PathfindingSystem routes it, MovementSystem walks it,
 *     and the goal is removed on arrival.
 *
 * The atomic planner runs first so a freshly-set goal is picked up by the navigation pass in the same
 * tick (no one-tick stall).
 */
export const aiSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to navigate over
  atomicPlanner(world, ctx, ctx.terrain);
  navigationPlanner(world, ctx.terrain);
};

/** Sweep every settler through the drive ladder, sharing one {@link beginPlannerPass} snapshot. */
function atomicPlanner(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  const pass = beginPlannerPass(world, ctx, terrain);
  // The assistant's grant errands are stamped before the sweep, so a dispatched settler is planned
  // onto its fetch the same tick (see ./assistant-grants.ts).
  dispatchAssistantGrants(pass);
  // Canonical order (the pass's shared sort - see PlannerPass.settlers): the per-tick claim maps
  // hand out targets first-come-first-served, so the visit order is a pick, not a mere sweep.
  for (const e of pass.settlers) {
    // Busy (an atomic running, a live route, a parked failed one) — leave it to play out; else the
    // settler is re-planning, and every intent the previous plan left is shed first (./replan.ts).
    if (!releaseStaleIntent(world, ctx, e, pass.farmClaims, pass.inbound)) continue;
    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // Key on Age, not the age-class job ids: only a born-young settler carries one, so a fixture's
    // adult job id colliding with an age-class id can't misroute an adult here (see
    // ../lifecycle/ageclass.ts).
    if (world.has(e, Age)) {
      planChild(pass, e, settler);
      continue;
    }
    planAdult(pass, e, settler, settler.jobType);
  }
}
