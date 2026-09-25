import {
  Anger,
  Frightened,
  ownerOf,
  PathRequest,
  Position,
  Resting,
  Settler,
  StayPoint,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { territoryRangeOf } from '../livestock/index.js';
import { clearNavState, redirectRoute } from '../movement/nav-state.js';
import { isAggressiveAnimal } from '../readviews/index.js';
import { manhattan } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { fleeDestination } from './flee.js';

// The wildlife fright reaction: a blow that lands on a wild animal sends it and its kin running from whoever
// struck it. Original behavior: the struck animal and the animals of its kind and side nearby run from the
// attacker, and a shot that misses scares nothing. All three knobs below are approximations of the run.

/** How far (Manhattan nodes) from the struck animal the scare carries. */
export const FRIGHT_RADIUS_NODES = 12;
/** How long (ticks) a frightened animal keeps running before it calms and its herd drives resume. */
export const FRIGHT_DURATION_TICKS = 48;
/** How often (ticks) a running fright re-aims its away-route - the flee drive's cadence twin. */
export const FRIGHT_REPATH_CADENCE = 6;

/**
 * Scare `struck` and its kin into running away from `threat`: stamp or refresh {@link Frightened} on every
 * non-aggressive animal of its species and owner within {@link FRIGHT_RADIUS_NODES} of it. An animal is a
 * {@link StayPoint} carrier, wild or claimed livestock. An aggressive species and an already-provoked
 * animal fight instead of stampeding.
 */
export function frightenKin(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  struck: Entity,
  threat: NodeId,
): void {
  const kind = world.get(struck, Settler).tribe;
  if (isAggressiveAnimal(ctx.content, kind)) return;
  const side = ownerOf(world, struck);
  const at = entityNode(world, terrain, struck);
  for (const e of world.query(StayPoint, Settler, Position)) {
    if (world.get(e, Settler).tribe !== kind || ownerOf(world, e) !== side) continue;
    if (world.has(e, Anger)) continue;
    if (world.has(e, Resting)) continue; // indoors (a farm's feed batch owns it): walls, not open ground
    if (manhattan(terrain, at, entityNode(world, terrain, e)) > FRIGHT_RADIUS_NODES) continue;
    const fright = world.tryMut(e, Frightened);
    if (fright !== undefined) {
      fright.until = ctx.tick + FRIGHT_DURATION_TICKS;
      fright.from = threat;
      fright.repathAt = ctx.tick; // a fresh scare re-aims immediately - it may come from the other side
    } else {
      world.add(e, Frightened, { until: ctx.tick + FRIGHT_DURATION_TICKS, repathAt: ctx.tick, from: threat });
    }
  }
}

/**
 * Run every {@link Frightened} animal away from its scare node, re-aiming on the
 * {@link FRIGHT_REPATH_CADENCE} throttle and keeping the live route between re-aims so the gait never
 * lurches; a refused route is dropped and stood out until the throttle. A lapsed `until`, or an
 * {@link Anger} stamped by a landed blow, calms the animal and sheds the flee route, so the herd drives
 * walk it home again. Scheduled before `herding` so a fresh scatter outranks the recall pull.
 */
export const animalFrightSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless fixture world - nowhere to run
  let blocked: BlockOverlay | undefined;
  for (const e of world.canonicalQuery(Frightened, Settler, Position)) {
    const f = world.get(e, Frightened);
    if (ctx.tick >= f.until || world.has(e, Anger)) {
      world.remove(e, Frightened);
      clearNavState(world, e);
      continue;
    }
    // Frightened on its way in, then admitted: the scare keeps ticking down, but an animal indoors runs
    // nowhere - routing it would walk the body out of the building it is marked inside.
    if (world.has(e, Resting)) continue;
    if (world.tryGet(e, PathRequest)?.failed) clearNavState(world, e); // the last away-route was unreachable
    // Run the live route, or stand out a refused or boxed-in one, until the throttle re-aims.
    if (ctx.tick < f.repathAt) continue;
    const here = entityNode(world, terrain, e);
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    const dest = fleeDestination(
      terrain,
      blocked,
      here,
      f.from,
      withinTerritory(world, ctx, terrain, e, here),
    );
    if (dest === here) {
      clearNavState(world, e); // boxed in (no walkable away-cell) - stand until the scare lapses
    } else {
      redirectRoute(world, e, dest);
    }
    world.mut(e, Frightened).repathAt = ctx.tick + FRIGHT_REPATH_CADENCE;
  }
};

/**
 * Whether a flight may end on a cell: inside the animal's territory, the one its grazing keeps to, or at
 * least nearer its anchor than where it stands. Authored, where the original runs a fixed distance from
 * the attacker: game driven to the edge of its range turns at bay instead of being pushed across the map,
 * out of every hunting ground. A creature with no territory runs where it likes.
 */
function withinTerritory(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
): (cell: NodeId) => boolean {
  const anchor = world.tryGet(e, StayPoint)?.cell;
  const range = territoryRangeOf(world, ctx, e);
  if (anchor === undefined || range <= 0) return () => true;
  const homeward = manhattan(terrain, here, anchor);
  return (cell) => {
    const reach = manhattan(terrain, cell, anchor);
    return reach <= range || reach < homeward;
  };
}
