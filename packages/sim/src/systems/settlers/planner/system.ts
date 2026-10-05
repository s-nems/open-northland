import {
  Age,
  Chat,
  CurrentAtomic,
  chatAtomicRunning,
  IdleStand,
  inPastimeChat,
  MoveGoal,
  Resting,
  Settler,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { endChat } from '../../social/index.js';
import { cutOffCheckDue, reconcileCutOff } from '../drives/cut-off.js';
import { planAdult, planChild, planShelterRung } from '../drives/ladder.js';
import { guideLostSettler } from '../drives/lost-guide.js';
import { clearLostWay } from '../lost-way.js';
import { dispatchAssistantGrants } from './assistant-grants.js';
import { idleBeatOfTick, waitsIdle, wakeIdle } from './idle-replan.js';
import { navigationPlanner } from './navigation.js';
import { beginPlannerPass } from './pass.js';
import { dispatchRecruitArming } from './recruit-arming.js';
import { releaseStaleIntent, standsThroughPass, takesCoverFrom } from './replan.js';
import { sweepOrder } from './sweep.js';

/** The atomic pass runs before {@link navigationPlanner}, so a goal it sets is routed in the same tick
 *  rather than stalling for one. */
export const plannerSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to navigate over
  atomicPlanner(world, ctx, ctx.terrain);
  navigationPlanner(world, ctx.terrain);
};

/** Sweep the settlers that can act through the drive ladder, sharing one {@link beginPlannerPass} snapshot. */
function atomicPlanner(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  const pass = beginPlannerPass(world, ctx, terrain);
  // The assistant's errands are stamped before the sweep, so a dispatched settler is planned onto its
  // fetch the same tick; arming first, so a recruit's weapon outranks its pair of boots.
  dispatchRecruitArming(pass);
  dispatchAssistantGrants(pass);
  // Off its beat an idler's visit only runs the standing cut-off check, so that tick visits every idler.
  const idleBeat = cutOffCheckDue(ctx) ? undefined : idleBeatOfTick(ctx.tick);
  const sweep = sweepOrder(world, ctx.content, pass.shelters, idleBeat);
  for (let e = sweep.next(); e !== undefined; e = sweep.next()) {
    if (standsThroughPass(world, ctx, pass.shelters, e)) continue;
    // Between its beats an idler runs only the shelter rung, and only when an alarm may draw it. One
    // still inside a building runs its whole ladder: an alarm draws it from its wait there, or the wait
    // no longer holds. Read before the release, which may step it out.
    const offBeat = waitsIdle(world, ctx.tick, e) && !world.has(e, Resting);
    // A busy settler plays its intent out, and is no longer idle; the rest shed what the previous plan
    // left before re-planning.
    if (!releaseStaleIntent(world, ctx, e, pass.farmClaims, pass.supply, pass.shelters)) {
      wakeIdle(world, e);
      continue;
    }
    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // Key on Age, not the age-class job ids: only a born-young settler carries one, so a fixture's
    // adult job id colliding with an age-class id cannot misroute an adult here.
    if (world.has(e, Age)) {
      planChild(pass, e, settler);
    } else {
      if (
        offBeat &&
        !(takesCoverFrom(world, ctx.content, e, pass.shelters) && planShelterRung(pass, e, settler))
      ) {
        // Still standing, so it keeps any lost-way mark; the idle tail's seat-reach check keeps its cadence.
        if (world.get(e, IdleStand).standing && cutOffCheckDue(ctx)) {
          const limit = navigationLimitFor(world, ctx.content, terrain, e);
          reconcileCutOff(world, ctx, terrain, e, settler.jobType, limit, pass.seatDoors);
          guideLostSettler(pass, e, limit);
        }
        continue;
      }
      if (!offBeat) planAdult(pass, e, settler, settler.jobType);
      pass.idle.settle(world, e);
      if (inPastimeChat(world, e) && tookAction(world, e)) endChat(world, ctx.tick, e); // frees the partner too
    }
    // A ladder that never reached its idle tail found the settler something, or another system holds it:
    // either way it no longer stands lost. A chat of either kind is still standing about to the player,
    // and a jobless adult never gets here, so only an obeyed order lifts its mark. Approximation: a bound
    // worker re-issuing the one walk its memo just refused clears too, since its sink is exempt from
    // the veto.
    if (!pass.idle.reachedTail(e) && !world.has(e, Chat)) clearLostWay(world, e);
  }
}

/** Whether the ladder just gave a pastime chatter something to do: a walk, or a clip other than its
 *  chat's. A rung that only keeps it standing (a builder waiting at its site, a worker loitering by the
 *  door) leaves the chat running. */
function tookAction(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || (world.has(e, CurrentAtomic) && !chatAtomicRunning(world, e));
}
