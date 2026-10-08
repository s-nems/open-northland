import type { ContentSet } from '@open-northland/data';
import type { RangeRing } from '@open-northland/render';
import { components, entityById, nodeOfPosition, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTribeOf,
  buildingTypeOf,
  isBuilding,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  workAreaOf,
  workplaceOf,
} from '../../game/snapshot.js';

/**
 * The range circle `e` shows: the ground a worker looks for work in, or the ground a building would shoot
 * over in defence mode, raised or not. Undefined for everything else, an employed gatherer included: it
 * roams for the nearest node anywhere. A fisher's circle is where he looks for a shore; he still casts at
 * fish further out in the water.
 */
export function rangeRingOf(content: ContentSet, e: SnapshotEntity): RangeRing | undefined {
  if (isBuilding(e)) return defenceRing(content, e);
  const job = settlerJobType(e);
  if (job === undefined) return undefined;
  const fisher = systems.isFisherJob(content, job);
  const area = workAreaOf(e);
  if (area !== undefined) {
    // A fisher's flag carries the default work radius, but his search reads only where it stands.
    const radiusNodes = fisher ? systems.FISH_SHORE_SEARCH_RADIUS : area.radius;
    return { entity: area.flag, radiusNodes, kind: 'work' };
  }
  const workplace = workplaceOf(e);
  if (workplace === undefined) return undefined;
  if (systems.isHunterJob(content, job)) {
    return { entity: workplace, radiusNodes: components.HUNTER_WORK_FLAG_RADIUS, kind: 'work' };
  }
  // An employed fisher searches from his feet, which stand at his workplace each time he banks a catch.
  if (fisher) return { entity: workplace, radiusNodes: systems.FISH_SHORE_SEARCH_RADIUS, kind: 'work' };
  return undefined;
}

function defenceRing(content: ContentSet, e: SnapshotEntity): RangeRing | undefined {
  const type = buildingTypeOf(e);
  const tribe = buildingTribeOf(e);
  const pos = positionOf(e);
  if (type === undefined || tribe === undefined || pos === undefined) return undefined;
  const { hx, hy } = nodeOfPosition(pos.x, pos.y);
  const radiusNodes = systems.shelterFireRadius(content, type, tribe, hx, hy);
  return radiusNodes === undefined ? undefined : { entity: e.id, radiusNodes, kind: 'defence' };
}

/**
 * The range circles of `ids`, one per centre and kind: hunters posted at one lodge share its circle.
 * Resolved through the ids rather than the world, so the cost follows the selection.
 */
export function rangeRingsOf(
  content: ContentSet,
  snapshot: WorldSnapshot,
  ids: Iterable<number>,
): readonly RangeRing[] {
  const rings = new Map<string, RangeRing>();
  for (const id of ids) {
    const e = entityById(snapshot, id);
    const ring = e === undefined ? undefined : rangeRingOf(content, e);
    if (ring !== undefined) rings.set(`${ring.kind}:${ring.entity}`, ring);
  }
  return [...rings.values()];
}
