import { Building, Livestock, mapBriefOf, Owner, Position } from '../../../components/index.js';
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
import { playerSawNode, playerSeesNode } from '../../vision/gates.js';
import { seatBaseOf } from '../base.js';
import { scoutLostZones } from './lost-zones.js';

/**
 * How far (half-cell node Manhattan) from the nearest of the seat's standing buildings an animal, or a herd's
 * start spot, is still the settlement's to round up. It bounds the WALK, not the catch's worth: claimed stock
 * herds itself home from anywhere (`livestock/assignment.ts`). Authored, owner ruling that the seat knows
 * the herds near its settlement: on battle_for_the_four_hills_multiplayer the nearest cattle and sheep start
 * 114-160 nodes from every headquarters, and across the mod map corpus's 193 authored headquarters the
 * nearest stock is a median 26 nodes out. Measuring from every standing building lets the reach grow with
 * the settlement (owner ruling).
 *
 * A base-employed hunter's ground is a circle around this same anchor (`HUNTER_WORK_FLAG_RADIUS`), and
 * an unclaimed animal of a warrantable type is nobody's property, so it is ordinary game (`isHuntTarget`).
 * The round-up is intentionally not gated behind the hunt: the seat races its own hunter for a stray
 * until the hunt ends (`workforce/hunter.ts`).
 */
export const SCOUT_CATCH_RADIUS_NODES = 160;

/** The scout's next round-up errand: go after an animal the seat sees, or walk to a herd's start spot
 *  the seat has not yet looked at. */
export type LivestockCatch =
  | { readonly kind: 'claim'; readonly animal: Entity }
  | { readonly kind: 'look'; readonly node: HalfCellNode };

/**
 * The seat's next round-up errand within {@link SCOUT_CATCH_RADIUS_NODES} of one of its STANDING buildings,
 * nearest first, ranked `(distance, entity id)`: the {@link Livestock} creature it could claim and sees now,
 * wild stock and a rival's alike, the set contact actually claims (`livestock/capture.ts`); else the start
 * spot of a wild herd in the map brief that its sight never reached, where the herd may still graze. The
 * seat knows the herds' start layout, never where they moved since: a herd that left its spot is found again
 * only by seeing it. Null when nothing is in reach.
 *
 * Cost: the livestock and the brief's spots inside the box around the settlement, and per candidate only
 * the buildings the spatial index holds near it, never animals times the seat's roster.
 *
 * An animal inside a workplace ({@link Resting}) is out of contact reach until its batch releases
 * it, and one sealed away from the settlement would otherwise win the pick every decision and pin a
 * man as a scout for good, so the candidates run the same sealed-pocket veto `nextSignpostTarget`
 * does, judged from the base door. A candidate on a peace partner's ground is skipped too: the peace
 * refuses the walk, so it would win every decision while the scout never moves. So is one in a zone the
 * seat lost a scout in ({@link scoutLostZones}).
 */
export function nextLivestockCatch(world: World, ctx: SystemContext, player: number): LivestockCatch | null {
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
  const reach = (node: HalfCellNode): number => {
    if (node.hx < box.minX || node.hx > box.maxX || node.hy < box.minY || node.hy > box.maxY) return Infinity;
    ax = node.hx;
    ay = node.hy;
    nearest = Infinity;
    forEachBuildingNear(world, ax, ay, SCOUT_CATCH_RADIUS_NODES, visit);
    return nearest;
  };
  const animals: Candidate[] = [];
  for (const e of world.query(Livestock, Position)) {
    if (!claimableBy(world, e, player)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    if (!playerSeesNode(ctx.fog, player, node.hx, node.hy)) continue;
    const distance = reach(node);
    if (distance <= SCOUT_CATCH_RADIUS_NODES) animals.push({ rank: e, entity: e, node, distance });
  }
  const spots: Candidate[] = [];
  for (const [i, spot] of (mapBriefOf(world)?.livestock ?? []).entries()) {
    if (playerSawNode(ctx.fog, player, spot.hx, spot.hy)) continue;
    const node = { hx: spot.hx, hy: spot.hy };
    const distance = reach(node);
    if (distance <= SCOUT_CATCH_RADIUS_NODES) spots.push({ rank: i, entity: null, node, distance });
  }
  if (animals.length === 0 && spots.length === 0) return null;

  const door = interactionNode(world, ctx, base);
  const reference =
    door !== null ? terrain.nodeAtClamped(door.x, door.y) : terrain.nodeAtClamped(from.hx, from.hy);
  // Resolved once the cheap gates have already thinned the herd, and disabled outright on a pocketed
  // reference, which would invert the veto (see RouteRegions.pocketed).
  const regions = routeRegions(world, ctx, terrain);
  const veto = regions.pocketed(reference) ? null : regions;
  const peace = peaceGroundFor(world, player);
  const lost = scoutLostZones(world, player, ctx.tick);
  const first = (candidates: Candidate[]): Candidate | null => {
    candidates.sort((a, b) => a.distance - b.distance || a.rank - b.rank);
    for (const candidate of candidates) {
      if (peace?.bars(candidate.node.hx, candidate.node.hy) === true) continue;
      if (lost.node(candidate.node.hx, candidate.node.hy)) continue;
      const at = terrain.nodeAt(candidate.node.hx, candidate.node.hy);
      if (veto?.unroutable(reference, at) === true) continue;
      return candidate;
    }
    return null;
  };
  const animal = first(animals);
  if (animal?.entity != null) return { kind: 'claim', animal: animal.entity };
  const spot = first(spots);
  return spot === null ? null : { kind: 'look', node: spot.node };
}

/** A round-up candidate: an animal (`rank` its entity id) or a brief spot (`rank` its index, no entity). */
interface Candidate {
  readonly rank: number;
  readonly entity: Entity | null;
  readonly node: HalfCellNode;
  readonly distance: number;
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
