import {
  CurrentAtomic,
  ErectSignpostOrder,
  Owner,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { fx } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';
import { isScoutJob } from '../readviews/index.js';
import { canPlaceSignpost } from '../signposts/index.js';
import { canonicalById } from '../spatial/nodes.js';
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
 * Order one owned scout to erect a signpost at (x,y): validate the issuer and the spot, then send the
 * scout there as a normal {@link moveUnit} walk carrying an {@link ErectSignpostOrder}, which
 * {@link signpostOrderSystem} turns into the hammer swing on arrival.
 */
export function placeSignpost(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeSignpost' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to erect on
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (!isScoutJob(ctx.content, world.get(e, Settler).jobType)) return; // only scouts erect signposts
  const goal = terrain.nodeAtClamped(command.x, command.y);
  const player = world.get(e, Owner).player;
  if (!canPlaceSignpost(world, ctx, terrain, goal, player)) return;
  // A non-interruptible atomic parks the whole command: deferring only the inner moveUnit would strand an
  // ErectSignpostOrder that the parked move erases on apply. The replay re-validates the spot.
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;
  const c = terrain.coordsOf(goal);
  // canPlaceSignpost already proved the goal standable, so the move's goal snap leaves it in place.
  moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y });
  world.add(e, ErectSignpostOrder, { goal });
}

/**
 * Turn an arrived {@link ErectSignpostOrder} into the one-shot build-guide hammer swing. It runs after the
 * player-order system retires the walk and before the planner, so the swing starts before the economy
 * could re-task the scout.
 *
 * The spot is re-validated on arrival because the world may have changed en route, and the signpost itself
 * spawns only when the swing's `erectSignpost` effect completes.
 */
export const signpostOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no orders were issuable
  // Canonical order: two scouts arriving the same tick at mutually-exclusive spots race, and the lower
  // entity id must win rather than whichever the store iterated first.
  for (const e of canonicalById(world.query(Settler, ErectSignpostOrder))) {
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
    const p = world.get(e, Position);
    const here = nodeOfPosition(p.x, p.y);
    if (terrain.nodeAt(here.hx, here.hy) === goal) {
      world.remove(e, ErectSignpostOrder);
      if (!canPlaceSignpost(world, ctx, terrain, goal, owner.player)) continue; // spot became illegal
      const c = terrain.coordsOf(goal);
      world.add(e, CurrentAtomic, {
        atomicId: BUILD_GUIDE_ATOMIC_ID,
        elapsed: 0,
        progress: fx.fromInt(0),
        duration: atomicDuration(ctx.content, settler, BUILD_GUIDE_ATOMIC_ID),
        effect: { kind: 'erectSignpost', x: c.x, y: c.y },
        targetEntity: null,
        targetTile: { x: c.x, y: c.y },
      });
      continue;
    }
    if (world.has(e, PlayerOrder)) continue; // still walking the order out
    world.remove(e, ErectSignpostOrder); // walk failed or was superseded - return to autonomy
  }
};
