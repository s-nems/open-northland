import { Building, Owner, ownerOf } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID, isBarracks } from '../readviews/index.js';
import { anchorCentroid, anchorNodeOf, ownedBuildings } from './shared.js';

/**
 * The building the seat's economy anchors and gates on: its built headquarters, else the built storage
 * building most central to its settlement. Null leaves every strategic module idle for the seat
 * (authored); the army is the one exception, gating on its barracks instead. The fallback ranks by
 * distance rather than id because authored seats commonly put a warehouse well outside the build disc,
 * and anchoring on a remote outpost would move the placement disc, the signpost lattice and every
 * search origin out to it.
 */
export function seatBaseOf(world: World, ctx: SystemContext, player: number): Entity | null {
  const buildings = contentIndex(ctx.content).buildings;
  const owned = ownedBuildings(world, player);
  const storage: Entity[] = [];
  for (const e of owned) {
    const b = world.get(e, Building);
    if (b.built < ONE) continue;
    const type = buildings.get(b.buildingType);
    if (type === undefined) continue;
    if (type.id === HEADQUARTERS_BUILDING_ID) return e;
    if (type.kind === 'storage') storage.push(e);
  }
  return centralOf(world, owned, storage);
}

/**
 * The army's anchor, the way {@link seatBaseOf} is the economy's: the seat's lowest-id standing barracks,
 * or null when it has none. Lowest id rather than nearest, so the rung that sizes the garrison and the
 * module that musters it always mean the same house.
 */
export function seatBarracksOf(world: World, ctx: SystemContext, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(Building, Owner)) {
    if (best !== null && e >= best) continue;
    if (ownerOf(world, e) === player && isBarracks(world, ctx, e)) best = e;
  }
  return best;
}

/** The candidate nearest the settlement centroid, ties to the lower entity id - `candidates` arrives
 *  ascending, so the strict `<` settles them. With nothing positioned to rank by, the first wins. */
function centralOf(world: World, owned: readonly Entity[], candidates: readonly Entity[]): Entity | null {
  const first = candidates[0] ?? null;
  const centre = anchorCentroid(world, owned);
  if (first === null || centre === null) return first;
  let best = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const distance = Math.abs(node.hx - centre.hx) + Math.abs(node.hy - centre.hy);
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
    }
  }
  return best;
}
