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
  const radiusNodes = defenceRadiusAt(content, type, tribe, hx, hy);
  return radiusNodes === undefined ? undefined : { entity: e.id, radiusNodes, kind: 'defence' };
}

/** Each content's defence radii by type, tribe and anchor row parity, the only part of the anchor the
 *  reach depends on. Working one out walks rings around the walls, and a held tower asks every frame. */
const defenceRadii = new WeakMap<ContentSet, Map<string, number | undefined>>();

/** {@link systems.shelterFireRadius}, remembered per content. */
export function defenceRadiusAt(
  content: ContentSet,
  buildingType: number,
  tribe: number,
  hx: number,
  hy: number,
): number | undefined {
  let radii = defenceRadii.get(content);
  if (radii === undefined) {
    radii = new Map();
    defenceRadii.set(content, radii);
  }
  const key = `${buildingType}:${tribe}:${hy & 1}`;
  if (radii.has(key)) return radii.get(key);
  const radius = systems.shelterFireRadius(content, buildingType, tribe, hx, hy);
  radii.set(key, radius);
  return radius;
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
