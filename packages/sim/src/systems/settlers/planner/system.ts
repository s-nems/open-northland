import {
  Age,
  Chat,
  CurrentAtomic,
  chatAtomicRunning,
  inPastimeChat,
  MoveGoal,
  Settler,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { endChat } from '../../social/index.js';
import { planAdult, planChild } from '../drives/ladder.js';
import { clearLostWay } from '../lost-way.js';
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
    // The snapshot was taken before the sweep, and a breeder's slaughter removes an animal mid-pass.
    if (!world.isAlive(e)) continue;
    // A busy settler plays its intent out; the rest shed what the previous plan left before re-planning.
    if (!releaseStaleIntent(world, ctx, e, pass.farmClaims, pass.inbound, pass.shelters)) continue;
    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // Key on Age, not the age-class job ids: only a born-young settler carries one, so a fixture's
    // adult job id colliding with an age-class id cannot misroute an adult here.
    if (world.has(e, Age)) {
      planChild(pass, e, settler);
    } else {
      planAdult(pass, e, settler, settler.jobType);
      if (inPastimeChat(world, e) && tookAction(world, e)) endChat(world, ctx.tick, e); // frees the partner too
    }
    // A ladder that never reached its idle tail found the settler something, or another system holds it:
    // either way it no longer stands lost. A chat of either kind is still standing about to the player,
    // and a jobless adult never gets here, so only an obeyed order lifts its mark. Approximation: a bound
    // worker re-issuing the one walk its memo just refused clears too, since its sink is exempt from
    // the veto.
    if (!pass.standing.has(e) && !world.has(e, Chat)) clearLostWay(world, e);
  }
}

/** Whether the ladder just gave a pastime chatter something to do: a walk, or a clip other than its
 *  chat's. A rung that only keeps it standing (a builder waiting at its site, a worker loitering by the
 *  door) leaves the chat running. */
function tookAction(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || (world.has(e, CurrentAtomic) && !chatAtomicRunning(world, e));
}
