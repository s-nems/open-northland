import { Frightened, LivestockVisit, Resting, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import { entityNode } from '../../spatial/nodes.js';

// A workplace's booked visitors: `LivestockVisit.at` names the workplace, and `Resting` says the animal
// is already inside.

function* visitorsOf(world: World, building: Entity): IterableIterator<Entity> {
  for (const e of world.query(LivestockVisit, Settler)) {
    if (world.get(e, LivestockVisit).at === building) yield e;
  }
}

/** Whether any visitor of this species - walking, waiting at the door, or admitted inside - already
 *  belongs to the workplace. */
export function hasVisitor(world: World, building: Entity, tribe: number): boolean {
  for (const e of visitorsOf(world, building)) {
    if (world.get(e, Settler).tribe === tribe) return true;
  }
  return false;
}

/** The workplace's booked visitors still outside: walking, or waiting at the door. */
export function* unadmittedVisitorsOf(world: World, building: Entity): IterableIterator<Entity> {
  for (const e of visitorsOf(world, building)) {
    if (!world.has(e, Resting)) yield e;
  }
}

export function unadmittedVisitorCount(world: World, building: Entity): number {
  let count = 0;
  for (const _ of unadmittedVisitorsOf(world, building)) count += 1;
  return count;
}

/**
 * The workplace's summoned visitors of `tribe` standing on the door - the animals a feed batch may begin
 * against; in a mapless sim every waiting visitor counts as arrived. A {@link Frightened} animal never
 * counts: admitting it would carry the fright inside, where the scatter drive walks the body back out.
 */
function* arrivedVisitorsOf(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
): IterableIterator<Entity> {
  const terrain = ctx.terrain;
  const door = terrain === undefined ? null : interactionNodeId(world, ctx, terrain, building);
  for (const e of unadmittedVisitorsOf(world, building)) {
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (world.has(e, Frightened)) continue;
    if (terrain !== undefined && door !== null && entityNode(world, terrain, e) !== door) continue;
    yield e;
  }
}

export function arrivedVisitorCount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
): number {
  let count = 0;
  for (const _ of arrivedVisitorsOf(world, ctx, building, tribe)) count += 1;
  return count;
}

export function canonicalArrivedVisitor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
): Entity | null {
  let pick: Entity | null = null;
  for (const e of arrivedVisitorsOf(world, ctx, building, tribe)) {
    if (pick === null || e < pick) pick = e;
  }
  return pick;
}

export function canonicalAdmittedVisitor(world: World, building: Entity, tribe: number): Entity | null {
  let pick: Entity | null = null;
  for (const e of visitorsOf(world, building)) {
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (!world.has(e, Resting)) continue;
    if (pick === null || e < pick) pick = e;
  }
  return pick;
}
