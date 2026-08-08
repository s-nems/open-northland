import {
  Anger,
  Frightened,
  PathRequest,
  Position,
  Resting,
  Settler,
  StayPoint,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { isAggressiveAnimal } from '../readviews/index.js';
import { manhattan } from '../spatial/metric.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { fleeDestination } from './flee.js';

// The wildlife fright reaction: a loosed shot scatters the passive animals around its mark, so a herd does
// not stand still while a hunter picks it off. All three knobs below are approximations. The original's
// scare radius and duration are unreadable, and observed play only shows game bolting when shots land near.

/** How far (Manhattan nodes) from a shot's mark the scare carries. */
export const FRIGHT_RADIUS_NODES = 12;
/** How long (ticks) a frightened animal keeps running before it calms and its herd drives resume. */
export const FRIGHT_DURATION_TICKS = 48;
/** How often (ticks) a running fright re-aims its away-route - the flee drive's cadence twin. */
export const FRIGHT_REPATH_CADENCE = 6;

/**
 * Scare the passive wildlife around `atNode`: stamp or refresh {@link Frightened} on every non-aggressive
 * animal within {@link FRIGHT_RADIUS_NODES}. Wildlife is a {@link StayPoint} carrier, the spawn-time roaming
 * marker an owned settler never carries. An aggressive species and an already-provoked animal fight instead
 * of stampeding.
 */
export function frightenWildlifeNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  atNode: NodeId,
): void {
  for (const e of world.query(StayPoint, Settler, Position)) {
    const s = world.get(e, Settler);
    if (isAggressiveAnimal(ctx.content, s.tribe)) continue;
    if (world.has(e, Anger)) continue;
    if (world.has(e, Resting)) continue; // indoors (a farm's feed batch owns it): walls, not open ground
    if (manhattan(terrain, atNode, entityNode(world, terrain, e)) > FRIGHT_RADIUS_NODES) continue;
    const fright = world.tryMut(e, Frightened);
    if (fright !== undefined) {
      fright.until = ctx.tick + FRIGHT_DURATION_TICKS;
      fright.from = atNode;
      fright.repathAt = ctx.tick; // a fresh scare re-aims immediately - it may come from the other side
    } else {
      world.add(e, Frightened, { until: ctx.tick + FRIGHT_DURATION_TICKS, repathAt: ctx.tick, from: atNode });
    }
  }
}

/**
 * Run every {@link Frightened} animal away from its scare node, re-aiming on the
 * {@link FRIGHT_REPATH_CADENCE} throttle and immediately after a failed route, and keeping the live route
 * between re-aims so the gait never lurches. A lapsed `until`, or an {@link Anger} stamped by a landed blow,
 * calms the animal and sheds the flee route, so the herd drives walk it home again. Scheduled before
 * `herding` so a fresh scatter outranks the recall pull.
 */
export const animalFrightSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless fixture world - nowhere to run
  for (const e of canonicalById(world.query(Frightened, Settler, Position))) {
    const f = world.mut(e, Frightened);
    if (ctx.tick >= f.until || world.has(e, Anger)) {
      world.remove(e, Frightened);
      clearNavState(world, e);
      continue;
    }
    // Frightened on its way in, then admitted: the scare keeps ticking down, but an animal indoors runs
    // nowhere - routing it would walk the body out of the building it is marked inside.
    if (world.has(e, Resting)) continue;
    if (world.tryGet(e, PathRequest)?.failed) {
      clearNavState(world, e); // the last away-route was unreachable - re-aim now
    } else if (isTravelling(world, e) && ctx.tick < f.repathAt) {
      continue; // still running a live route - re-aim only on the throttle
    }
    const here = entityNode(world, terrain, e);
    const dest = fleeDestination(terrain, here, f.from);
    if (dest === here) {
      clearNavState(world, e); // boxed in (no walkable away-cell) - stand until the scare lapses
    } else {
      redirectRoute(world, e, dest);
    }
    f.repathAt = ctx.tick + FRIGHT_REPATH_CADENCE;
  }
};
