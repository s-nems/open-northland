import { Building } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID, isBarracks } from '../readviews/index.js';
import { anchorCentroid, anchorNodeOf, ownedBuildings } from './shared.js';

/**
 * The building the seat's economy anchors and gates on: its built headquarters, else the built
 * STORAGE building most central to its settlement - the fallback it regains an economy through after
 * losing the headquarters ({@link import('./build-order/entries.js').BASE_REPLACEMENT_ENTRY}). Null
 * leaves every strategic module idle for the seat (user rule: no base → the AI stays off); the army
 * is the one exception, gating on its barracks instead, so a seat that loses its base keeps fighting.
 *
 * The fallback ranks by distance rather than id because a seat's storage is not all in one place: 24
 * of the 35 authored seats in the map corpus that open with both a headquarters and a warehouse put
 * that warehouse past the whole 48-node build disc (median 69 nodes, max 265). Anchoring on a remote
 * outpost would move the placement disc, the signpost lattice and every search origin out to it.
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
 * The army's anchor, the way {@link seatBaseOf} is the economy's: the seat's lowest-id standing
 * barracks, or null when it has none. A canonical pick rather than the nearest one, so the rung that
 * sizes the garrison and the module that musters it always mean the same house - one rally point, and
 * one tribe whose weapon rows the drill may arm (a seat can hold a captured house of another tribe).
 */
export function seatBarracksOf(world: World, ctx: SystemContext, player: number): Entity | null {
  for (const e of ownedBuildings(world, player)) {
    if (isBarracks(world, ctx, e)) return e;
  }
  return null;
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
