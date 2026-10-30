import { Building, Livestock, Owner, Position } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedBuildings } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { interactionNode, routeRegions } from '../../footprint/index.js';
import { claimableBy } from '../../livestock/index.js';
import { peaceGroundFor } from '../../match/peace.js';
import { forEachBuildingNear } from '../../spatial/buildings.js';
import { seatBaseOf } from '../base.js';

/**
 * How far (half-cell node Manhattan) from the nearest of the seat's standing buildings an animal is still the settlement's to
 * round up. It bounds the WALK, not the catch's worth: claimed stock herds itself home from anywhere
 * (`livestock/assignment.ts`). Sized from the mod map corpus (`CnModMaps/<map>/staticobjects.inc`):
 * across its 193 authored headquarters the nearest cattle or sheep is a median 13 cells out, and 140
 * seats have stock within the 32 cells this radius covers. Measuring from every standing building rather
than the headquarters alone lets the reach grow with the settlement (owner ruling).
 *
 * A base-employed hunter's ground is a circle around this same anchor (`HUNTER_WORK_FLAG_RADIUS`), and
 * an unclaimed animal of a warrantable type is nobody's property, so it is ordinary game (`isHuntTarget`).
 * The round-up is intentionally not gated behind the hunt: the seat races its own hunter for a stray
 * until the hunt ends (`workforce/hunter.ts`).
 */
export const SCOUT_CATCH_RADIUS_NODES = 64;

/**
 * Where the seat's scout should walk to claim its next animal: the node under the {@link Livestock}
 * creature it does not already own that lies nearest one of the seat's STANDING buildings (not the
 * scout), ranked `(distance, entity id)`. Wild stock and a rival's alike, the set contact actually claims
 * (`livestock/capture.ts`). Null when none is in reach.
 *
 * Cost: one pass over the livestock, and per animal inside the box around the settlement only the
 * buildings the spatial index holds near it, never animals times the seat's roster.
 *
 * An animal inside a workplace ({@link Resting}) is out of contact reach until its batch releases
 * it, and one sealed away from the settlement would otherwise win the pick every decision and pin a
 * man as a scout for good, so the candidates run the same sealed-pocket veto `nextSignpostTarget`
 * does, judged from the base door. An animal on a peace partner's ground is skipped too: the peace
 * refuses the walk, so it would win every decision while the scout never moves.
 */
export function nextLivestockCatch(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null; // mapless sim: no ground to walk into an animal over
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return null;
  const from = anchorNodeOf(world, base);
  if (from === null) return null;
  const box = settlementBox(world, player);
  if (box === null) return null;

  let nearest = Infinity;
  let ax = 0;
  let ay = 0;
  // One visitor folds the nearest own standing building in place, so a probe allocates nothing.
  const visit = (building: Entity, bx: number, by: number): void => {
    if (world.tryGet(building, Owner)?.player !== player) return;
    if (world.get(building, Building).built < ONE) return;
    nearest = Math.min(nearest, Math.abs(bx - ax) + Math.abs(by - ay));
  };
  const candidates: { entity: Entity; node: HalfCellNode; distance: number }[] = [];
  for (const e of world.query(Livestock, Position)) {
    if (!claimableBy(world, e, player)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    if (node.hx < box.minX || node.hx > box.maxX || node.hy < box.minY || node.hy > box.maxY) continue;
    ax = node.hx;
    ay = node.hy;
    nearest = Infinity;
    forEachBuildingNear(world, ax, ay, SCOUT_CATCH_RADIUS_NODES, visit);
    if (nearest <= SCOUT_CATCH_RADIUS_NODES) candidates.push({ entity: e, node, distance: nearest });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance || a.entity - b.entity);

  const door = interactionNode(world, ctx, base);
  const reference =
    door !== null ? terrain.nodeAtClamped(door.x, door.y) : terrain.nodeAtClamped(from.hx, from.hy);
  // Resolved once the cheap gates have already thinned the herd, and disabled outright on a pocketed
  // reference, which would invert the veto (see RouteRegions.pocketed).
  const regions = routeRegions(world, ctx, terrain);
  const veto = regions.pocketed(reference) ? null : regions;
  const peace = peaceGroundFor(world, player);
  for (const candidate of candidates) {
    if (peace?.bars(candidate.node.hx, candidate.node.hy) === true) continue;
    const at = terrain.nodeAt(candidate.node.hx, candidate.node.hy);
    if (veto?.unroutable(reference, at) === true) continue;
    return candidate.node;
  }
  return null;
}

/** The box around the seat's standing building anchors, widened by the catch radius: an animal outside
 *  it is out of reach of every building, so it never pays a spatial probe. Null with nothing standing. */
function settlementBox(
  world: World,
  player: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of ownedBuildings(world, player)) {
    if (world.get(e, Building).built < ONE) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    minX = Math.min(minX, node.hx);
    maxX = Math.max(maxX, node.hx);
    minY = Math.min(minY, node.hy);
    maxY = Math.max(maxY, node.hy);
  }
  if (minX > maxX) return null;
  return {
    minX: minX - SCOUT_CATCH_RADIUS_NODES,
    maxX: maxX + SCOUT_CATCH_RADIUS_NODES,
    minY: minY - SCOUT_CATCH_RADIUS_NODES,
    maxY: maxY + SCOUT_CATCH_RADIUS_NODES,
  };
}
