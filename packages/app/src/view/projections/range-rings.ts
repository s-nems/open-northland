import { type ContentSet, PRAYER_SITE } from '@open-northland/data';
import type { RangeRing } from '@open-northland/render';
import { components, entityById, nodeOfPosition, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingRecordOf,
  buildingTribeOf,
  buildingTypeOf,
  isBuilding,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  staffOf,
  workAreaOf,
  workplaceOf,
} from '../../game/snapshot/index.js';

/**
 * The range circle `e` shows: the ground a worker looks for work in, or the ground a building would shoot
 * over in defence mode, raised or not. A building without a defence circle shows its porters' pickup area
 * while one works there. Undefined for everything else, an employed gatherer without a flag included: it
 * roams for the nearest node anywhere. A fisher's circle is where he looks for a shore; he still casts at
 * fish further out in the water.
 */
export function rangeRingOf(
  content: ContentSet,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
): RangeRing | undefined {
  if (isBuilding(e)) {
    const radius = templeAuraRadius(content, buildingTypeOf(e));
    if (radius !== undefined) return { entity: e.id, radiusNodes: radius, metric: 'hex', kind: 'blessing' };
    return defenceRing(content, e) ?? porterRing(content, snapshot, e);
  }
  const job = settlerJobType(e);
  if (job === undefined) return undefined;
  const fisher = systems.isFisherJob(content, job);
  // A hunter's ground counts map points; every other work area counts Manhattan nodes.
  const metric = systems.isHunterJob(content, job) ? 'hex' : 'manhattan';
  const area = workAreaOf(e);
  if (area !== undefined) {
    // A fisher's flag carries the default work radius, but his search reads only where it stands.
    const radiusNodes = fisher ? systems.FISH_SHORE_SEARCH_RADIUS : area.radius;
    return { entity: area.flag, radiusNodes, metric, kind: 'work' };
  }
  const workplace = workplaceOf(e);
  if (workplace === undefined) return undefined;
  if (metric === 'hex') {
    return { entity: workplace, radiusNodes: components.HUNTER_WORK_FLAG_RADIUS, metric, kind: 'work' };
  }
  if (fisher) return employedFisherRing(content, snapshot, workplace);
  const building = entityById(snapshot, workplace);
  return building !== undefined && collectsAround(content, e, building) ? porterArea(workplace) : undefined;
}

/** The pickup area around `building` while a porter without a flag works there. */
function porterRing(
  content: ContentSet,
  snapshot: WorldSnapshot,
  building: SnapshotEntity,
): RangeRing | undefined {
  return staffOf(snapshot, building.id).some((s) => collectsAround(content, s, building))
    ? porterArea(building.id)
    : undefined;
}

/** Whether `settler` is a porter at `building` that lifts ground piles around it, holding no flag. */
function collectsAround(content: ContentSet, settler: SnapshotEntity, building: SnapshotEntity): boolean {
  const job = settlerJobType(settler);
  const type = buildingTypeOf(building);
  return (
    job !== undefined &&
    type !== undefined &&
    workAreaOf(settler) === undefined &&
    systems.postCollectsAroundWorkplace(content, job, type)
  );
}

/** Potential coverage, also shown for construction and damaged temples when planning the settlement. */
export function templeAuraRadius(content: ContentSet, typeId: number | undefined): number | undefined {
  return content.buildings.find((type) => type.typeId === typeId)?.prayerSite === PRAYER_SITE.temple
    ? systems.TEMPLE_AURA_RANGE
    : undefined;
}

function porterArea(building: number): RangeRing {
  return {
    entity: building,
    radiusNodes: systems.WORKPLACE_COLLECT_RADIUS,
    metric: 'manhattan',
    kind: 'work',
  };
}

/** An employed fisher searches from where he banked his last catch, the door of his workplace. */
function employedFisherRing(
  content: ContentSet,
  snapshot: WorldSnapshot,
  workplace: number,
): RangeRing | undefined {
  const building = entityById(snapshot, workplace);
  const type = building === undefined ? undefined : buildingTypeOf(building);
  const tribe = building === undefined ? undefined : buildingTribeOf(building);
  const pos = building === undefined ? undefined : positionOf(building);
  if (building === undefined || type === undefined || tribe === undefined || pos === undefined)
    return undefined;
  const radiusNodes = systems.workplaceShoreSearchRadius(
    content,
    { buildingType: type, tribe, record: buildingRecordOf(building) },
    nodeOfPosition(pos.x, pos.y).hy,
  );
  return { entity: workplace, radiusNodes, metric: 'manhattan', kind: 'work' };
}

function defenceRing(content: ContentSet, e: SnapshotEntity): RangeRing | undefined {
  const type = buildingTypeOf(e);
  const tribe = buildingTribeOf(e);
  const pos = positionOf(e);
  if (type === undefined || tribe === undefined || pos === undefined) return undefined;
  const { hx, hy } = nodeOfPosition(pos.x, pos.y);
  const radiusNodes = systems.shelterFireRadius(
    content,
    { buildingType: type, tribe, record: buildingRecordOf(e) },
    hx,
    hy,
  );
  return radiusNodes === undefined
    ? undefined
    : { entity: e.id, radiusNodes, metric: 'hex', kind: 'defence' };
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
    const ring = e === undefined ? undefined : rangeRingOf(content, snapshot, e);
    if (ring !== undefined) rings.set(`${ring.kind}:${ring.entity}`, ring);
  }
  return [...rings.values()];
}
