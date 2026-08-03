import { Livestock, ownerOf, Position, Resting } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { interactionNode, routeRegions } from '../../footprint/index.js';
import { seatBaseOf } from '../base.js';
import { anchorNodeOf } from '../shared.js';

/**
 * How far (half-cell node Manhattan) from the seat's base an animal is still the settlement's to
 * round up. It bounds the WALK, not the catch's worth: claimed stock herds itself home from anywhere
 * (`livestock/assignment.ts`). Calibrated, not guessed: across the 193 authored headquarters in the
 * mod map corpus (`CnModMaps/<map>/staticobjects.inc`), the nearest cattle or sheep is a median 13 cells
 * out, and 140 seats have stock within the 32 cells this radius covers.
 *
 * KNOWN COLLISION, accepted: a base-employed hunter's ground is a circle around this same anchor
 * (`HUNTER_WORK_FLAG_RADIUS`), and an unclaimed animal is nobody's property, so it is valid last-resort
 * prey (`isHuntTarget`) - but only once no normal game stands anywhere in the wider probe around that
 * ground (`HUNT_LAST_RESORT_SCAN_FACTOR`), which is to say once the neighbourhood is hunted out. That
 * should make the race rarer than the ungated version this note was written for; unmeasured, since the
 * sweep behind those constants ran without AI seats. Both behaviours are what their own rules ask for
 * and the two duties were requested to run together, so the round-up is NOT gated behind the hunt: the
 * seat races its own hunter for a stray until the hunt ends (`workforce/hunter.ts`).
 */
export const SCOUT_CATCH_RADIUS_NODES = 64;

/**
 * Where the seat's scout should walk to claim its next animal: the node under the {@link Livestock}
 * creature it does not already own that is nearest the HEADQUARTERS (not the scout), ranked
 * `(distance, entity id)`. Wild stock and a rival's alike, the set contact actually claims
 * (`livestock/capture.ts`). Null when none is in reach.
 *
 * An animal inside a workplace ({@link Resting}) is out of contact reach until its batch releases
 * it, and one sealed away from the settlement would otherwise win the pick every decision and pin a
 * man as a scout for good, so the candidates run the same sealed-pocket veto `nextSignpostTarget`
 * does, judged from the same base door.
 */
export function nextLivestockCatch(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null; // mapless sim: no ground to walk into an animal over
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return null;
  const from = anchorNodeOf(world, base);
  if (from === null) return null;

  const candidates: { entity: Entity; node: HalfCellNode; distance: number }[] = [];
  for (const e of world.query(Livestock, Position)) {
    if (ownerOf(world, e) === player) continue;
    if (world.has(e, Resting)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (distance <= SCOUT_CATCH_RADIUS_NODES) candidates.push({ entity: e, node, distance });
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
  for (const candidate of candidates) {
    const at = terrain.nodeAt(candidate.node.hx, candidate.node.hy);
    if (veto?.unroutable(reference, at) === true) continue;
    return candidate.node;
  }
  return null;
}
