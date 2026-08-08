import { Age, Settler } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { planAdult, planChild } from '../drives/ladder.js';
import { dispatchAssistantGrants } from './assistant-grants.js';
import { navigationPlanner } from './navigation.js';
import { beginPlannerPass } from './pass.js';
import { dispatchRecruitArming } from './recruit-arming.js';
import { releaseStaleIntent } from './replan.js';

/** The atomic pass runs before {@link navigationPlanner}, so a goal it sets is routed in the same tick
 *  rather than stalling for one. */
export const plannerSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to navigate over
  atomicPlanner(world, ctx, ctx.terrain);
  navigationPlanner(world, ctx.terrain);
};

/** Sweep every settler through the drive ladder, sharing one {@link beginPlannerPass} snapshot. */
function atomicPlanner(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  const pass = beginPlannerPass(world, ctx, terrain);
  // The assistant's errands are stamped before the sweep, so a dispatched settler is planned onto its
  // fetch the same tick; arming first, so a recruit's weapon outranks its pair of boots.
  dispatchRecruitArming(pass);
  dispatchAssistantGrants(pass);
  for (const e of pass.settlers) {
    // A busy settler plays its intent out; the rest shed what the previous plan left before re-planning.
    if (!releaseStaleIntent(world, ctx, e, pass.farmClaims, pass.inbound)) continue;
    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // Key on Age, not the age-class job ids: only a born-young settler carries one, so a fixture's
    // adult job id colliding with an age-class id cannot misroute an adult here.
    if (world.has(e, Age)) {
      planChild(pass, e, settler);
      continue;
    }
    planAdult(pass, e, settler, settler.jobType);
  }
}
