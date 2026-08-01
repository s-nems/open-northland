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
import { isAggressiveAnimal } from '../readviews/index.js';
import {
  canonicalById,
  clearNavState,
  entityNode,
  isTravelling,
  manhattan,
  redirectRoute,
} from '../spatial/nodes.js';
import { fleeDestination } from './flee.js';

// The wildlife FRIGHT reaction - a loosed shot scatters the passive animals around its mark, so a herd
// no longer stands still while a hunter picks it off one by one. All three knobs are approximations
// (source basis "Hunter aim"): the original's scare radius/duration are unreadable; observed play just
// shows game bolting when shots land near it.

/** How far (Manhattan nodes) from a shot's mark the scare carries. */
export const FRIGHT_RADIUS_NODES = 12;
/** How long (ticks) a frightened animal keeps running before it calms and its herd drives resume. */
export const FRIGHT_DURATION_TICKS = 48;
/** How often (ticks) a running fright re-aims its away-route - the flee drive's cadence twin. */
export const FRIGHT_REPATH_CADENCE = 6;

/**
 * Scare the passive wildlife around `atNode` - stamp/refresh {@link Frightened} on every non-aggressive
 * animal within {@link FRIGHT_RADIUS_NODES}. Wildlife = a {@link StayPoint} carrier (the spawn-time
 * roaming marker; owned settlers never carry one). An aggressive species answers threat with threat and
 * an {@link Anger}-provoked animal is already fighting - neither is stampeded. Cost shape: one linear
 * pass over the map's wildlife per ranged launch (every archer's release, not just a hunter's), with
 * launches bounded by shooters x their draw cadence - unmeasured under an archer-volley battle on a
 * wildlife-rich map; move to a spatial candidate list if a bench ever shows it.
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
    const fright = world.tryGet(e, Frightened);
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
 * AnimalFrightSystem - run every {@link Frightened} animal away from its scare node, the wildlife twin
 * of the FLEE drive's steering: re-aim to the best away-cell ({@link fleeDestination}) on the
 * {@link FRIGHT_REPATH_CADENCE} throttle (immediately on a failed route), keep the live route between
 * re-aims so the gait never lurches. A lapsed `until` - or an {@link Anger} stamped by a landed blow
 * (a provoked animal fights, it does not stampede) - calms the animal: the marker and the flee route
 * are shed, and the herd drives (cohesion, the stay-point graze) pick it up again next tick, walking
 * it home. Scheduled before `herding` so a fresh scatter outranks the recall pull. Idle when nothing
 * is frightened (one empty query); no RNG.
 */
export const animalFrightSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless fixture world - nowhere to run
  for (const e of canonicalById(world.query(Frightened, Settler, Position))) {
    const f = world.get(e, Frightened);
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
