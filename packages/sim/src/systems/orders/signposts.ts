import type { AiOrderOrigin } from '../../components/ai/order.js';
import {
  addCurrentAtomic,
  CurrentAtomic,
  ErectSignpostOrder,
  Owner,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { isTravelling } from '../movement/nav-state.js';
import { atomicDuration } from '../readviews/animations.js';
import { isScoutJob } from '../readviews/index.js';
import { canPlaceSignpost } from '../signposts/index.js';
import { recordAiOrder } from './ai-lifecycle.js';
import { deferOrderDuringAtomic, isOrderableSettler } from './guards.js';
import { moveUnit } from './movement.js';

/**
 * The scout's BUILD-GUIDE action id - the one atomic the scout job allows (`jobtypes.ini` type 27
 * `allowatomic 43`; `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_BUILD_GUIDE 43`). The viking
 * binding plays `viking_scout_build_guide` (15 frames, the hammer swing - extracted `gfxAtomics`
 * tribe 1 / job 27 / action 43).
 */
export const BUILD_GUIDE_ATOMIC_ID = 43;

/**
 * Order one owned scout to erect a signpost at (x,y) - see the command doc. Runs as a normal
 * {@link moveUnit} walk carrying an {@link ErectSignpostOrder}, which {@link signpostOrderSystem} turns
 * into the hammer swing on arrival. Returns whether the order was taken.
 */
export function placeSignpost(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeSignpost' }>,
  origin?: AiOrderOrigin,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false; // mapless sim: no cells to erect on
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return false;
  if (!isScoutJob(ctx.content, world.get(e, Settler).jobType)) return false; // only scouts erect signposts
  const goal = terrain.nodeAtClamped(command.x, command.y);
  const player = world.get(e, Owner).player;
  if (!canPlaceSignpost(world, ctx, terrain, goal, player)) return false;
  // A non-interruptible atomic parks the whole command: deferring only the inner moveUnit would strand an
  // ErectSignpostOrder that the parked move erases on apply. The replay re-validates the spot.
  if (deferOrderDuringAtomic(world, ctx, e, command)) {
    recordAiOrder(world, e, origin);
    return true;
  }
  const c = terrain.coordsOf(goal);
  // canPlaceSignpost already proved the goal standable, so the move's goal snap leaves it in place.
  const walks = moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y }, origin);
  world.add(e, ErectSignpostOrder, { goal });
  return walks;
}

/**
 * Turn an arrived {@link ErectSignpostOrder} into the one-shot build-guide hammer swing. It runs after the
 * player-order system retires the walk and before the planner, so the swing starts before the economy
 * could re-task the scout.
 *
 * The spot is re-validated on arrival because the world may have changed en route, and the signpost itself
 * spawns only when the swing's `erectSignpost` effect completes, which also retires the order.
 */
export const signpostOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no orders were issuable
  // Canonical order: two scouts arriving the same tick at mutually-exclusive spots race, and the lower
  // entity id must win rather than whichever the store iterated first.
  const settlers = world.canonicalQuery(Settler, ErectSignpostOrder);
  for (let i = 0; i < settlers.length; i++) {
    const e = settlers[i];
    if (e === undefined) continue;
    const settler = world.get(e, Settler);
    const owner = world.tryGet(e, Owner);
    if (!isScoutJob(ctx.content, settler.jobType) || owner === undefined) {
      world.remove(e, ErectSignpostOrder); // re-professioned or unowned mid-walk - the intent dies
      continue;
    }
    const goal = world.get(e, ErectSignpostOrder).goal;
    const atomic = world.tryGet(e, CurrentAtomic);
    if (atomic !== undefined) {
      if (atomic.effect.kind === 'erectSignpost') continue; // swinging the hammer - wait for the effect
      if (world.has(e, PlayerOrder)) continue; // the walk's own preamble (setting a carried load down)
      world.remove(e, ErectSignpostOrder); // a need drive took over - the order is abandoned
      continue;
    }
    if (world.has(e, PlayerOrder)) continue; // still walking the order out
    // A walker reads the goal node from half a step short of its centre, so only a scout standing still
    // proves arrival; a swing begun on the move slides along the rest of the step. A failed walk finishing
    // its step, a walk that failed or was superseded, and a spot that became illegal all drop the errand.
    const p = world.get(e, Position);
    const here = nodeOfPosition(p.x, p.y);
    if (
      isTravelling(world, e) ||
      terrain.nodeAt(here.hx, here.hy) !== goal ||
      !canPlaceSignpost(world, ctx, terrain, goal, owner.player)
    ) {
      world.remove(e, ErectSignpostOrder);
      continue;
    }
    // The order stays through the swing, so the planned spot keeps its spacing until the post stands.
    const c = terrain.coordsOf(goal);
    addCurrentAtomic(world, e, {
      atomicId: BUILD_GUIDE_ATOMIC_ID,
      duration: atomicDuration(ctx.content, settler, BUILD_GUIDE_ATOMIC_ID),
      effect: { kind: 'erectSignpost', x: c.x, y: c.y },
      targetEntity: null,
      targetTile: { x: c.x, y: c.y },
    });
  }
};
