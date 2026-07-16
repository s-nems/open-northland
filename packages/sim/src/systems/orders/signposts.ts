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
import { SCOUT_JOB } from '../readviews/index.js';
import { canPlaceSignpost } from '../signposts/index.js';
import { isOrderableSettler } from './guards.js';
import { moveUnit } from './movement.js';

/**
 * The scout's BUILD-GUIDE action id — the one atomic the scout job allows (`jobtypes.ini` type 27
 * `allowatomic 43`; `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_BUILD_GUIDE 43`). The viking
 * binding plays `viking_scout_build_guide` (15 frames, the hammer swing — extracted `gfxAtomics`
 * tribe 1 / job 27 / action 43).
 */
export const BUILD_GUIDE_ATOMIC_ID = 43;

/**
 * Order one owned scout to erect a signpost at (x,y) — the `placeSignpost` handler. Validates the
 * issuer (an orderable settler whose job is scout) and the spot ({@link canPlaceSignpost}), then sends
 * the scout there as a normal {@link moveUnit} walk carrying an {@link ErectSignpostOrder}; the
 * {@link signpostOrderSystem} swings the hammer on arrival. Recoverable bad input (skipped, still
 * logged for faithful replay): a dead/stale/non-settler/neutral issuer, a non-scout, or an illegal spot.
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
  if (world.get(e, Settler).jobType !== SCOUT_JOB) return; // only the scout erects signposts
  const goal = terrain.nodeAtClamped(command.x, command.y);
  const player = world.get(e, Owner).player;
  if (!canPlaceSignpost(world, ctx, terrain, goal, player)) return;
  const c = terrain.coordsOf(goal);
  // The walk reuses the whole moveUnit order dance (cancel current action, drop a carried load first,
  // PlayerOrder en-route marker); the erect intent rides beside it. canPlaceSignpost proved the goal
  // standable, so the move's goal snap leaves it in place.
  moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y });
  world.add(e, ErectSignpostOrder, { goal });
}

/**
 * SignpostOrderSystem — turns an arrived {@link ErectSignpostOrder} into the one-shot build-guide
 * hammer swing. Runs after {@link import('./movement.js').playerOrderSystem} (which retires the walk)
 * and before the aiSystem (so the swing starts before the economy could re-task the scout).
 *
 * Per scout under an order: while the erect swing runs, wait for its effect; on arrival at the goal,
 * re-validate the spot (the world may have changed en route — a rival post, a new building) and start
 * the atomic — the signpost itself spawns when the swing completes (the `erectSignpost` effect, one
 * strike, instant, free). The order is dropped when the scout stopped being a scout, another action
 * took over (a need drive), the walk failed, or the spot became illegal.
 */
export const signpostOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no orders were issuable
  for (const e of world.query(Settler, ErectSignpostOrder)) {
    const settler = world.get(e, Settler);
    const owner = world.tryGet(e, Owner);
    if (settler.jobType !== SCOUT_JOB || owner === undefined) {
      world.remove(e, ErectSignpostOrder); // re-professioned or unowned mid-walk — the intent dies
      continue;
    }
    const goal = world.get(e, ErectSignpostOrder).goal;
    const atomic = world.tryGet(e, CurrentAtomic);
    if (atomic !== undefined) {
      if (atomic.effect.kind === 'erectSignpost') continue; // swinging the hammer — wait for the effect
      if (world.has(e, PlayerOrder)) continue; // the walk's own preamble (setting a carried load down)
      world.remove(e, ErectSignpostOrder); // a need drive took over — the order is abandoned
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
    world.remove(e, ErectSignpostOrder); // walk failed or was superseded — return to autonomy
  }
};
