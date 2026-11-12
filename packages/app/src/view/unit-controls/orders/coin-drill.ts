import type { BuildingType, ContentSet } from '@open-northland/data';
import {
  entityById,
  hexDistanceBetween,
  nodeOfPosition,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  buildingTypeOf,
  isFinishedBuilding,
  isPlayerControllable,
  isSettler,
  num,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerExperienceOf,
} from '../../../game/snapshot/index.js';

/** The slice of a building type the gate reads. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/**
 * The sim's `mayCoinDrillAt` as far as a snapshot shows it: a finished barracks of the soldier's own owner,
 * and `mayCoinDrill` on his trade, weapon and fight points. The walk to its door and the barracks' free
 * coins are the sim's to judge: it refuses the men past the free coins, who then stay where they are.
 */
export function mayCoinDrillHere(
  content: ContentSet,
  settler: SnapshotEntity,
  building: SnapshotEntity,
  byType: ReadonlyMap<number, BuildingInfo>,
): boolean {
  if (!isSettler(settler) || !isPlayerControllable(settler)) return false;
  if (!isFinishedBuilding(building) || ownerPlayerOf(building) !== ownerPlayerOf(settler)) return false;
  const typeId = buildingTypeOf(building);
  const def = typeId === undefined ? undefined : byType.get(typeId);
  if (def === undefined || !systems.isBarracksType(def)) return false;
  const identity = settler.components.Settler as
    | { tribe?: unknown; jobType?: unknown; humanForm?: unknown }
    | undefined;
  const tribe = num(identity?.tribe);
  if (tribe === undefined) return false;
  const weapon = num((settler.components.Weapon as { weaponTypeId?: unknown } | undefined)?.weaponTypeId);
  return systems.mayCoinDrill(
    content,
    { tribe, jobType: num(identity?.jobType) ?? null, humanForm: identity?.humanForm === true },
    weapon,
    settlerExperienceOf(settler.components),
  );
}

/** The settlers among `settlers` a coin drill at `building` takes, {@link nearestToBuildingFirst}. */
export function coinDrillersAt(
  content: ContentSet,
  snapshot: WorldSnapshot,
  building: number,
  settlers: readonly number[],
  byType: ReadonlyMap<number, BuildingInfo>,
): number[] {
  const house = entityById(snapshot, building);
  if (house === undefined) return [];
  const drillers = settlers.filter((id) => {
    const settler = entityById(snapshot, id);
    return settler !== undefined && mayCoinDrillHere(content, settler, house, byType);
  });
  return nearestToBuildingFirst(snapshot, building, drillers, (id) => id);
}

/**
 * `units` ordered nearest to `building` first, then by id; an unplaced one goes last. The sim admits a
 * group's drill orders in command order while free coins last, so the nearest men get them.
 */
export function nearestToBuildingFirst<T>(
  snapshot: WorldSnapshot,
  building: number,
  units: readonly T[],
  idOf: (unit: T) => number,
): T[] {
  const house = entityById(snapshot, building);
  const at = house === undefined ? undefined : positionOf(house);
  if (at === undefined) return [...units];
  const target = nodeOfPosition(at.x, at.y);
  const distanceOf = (unit: T): number => {
    const settler = entityById(snapshot, idOf(unit));
    const pos = settler === undefined ? undefined : positionOf(settler);
    if (pos === undefined) return Number.POSITIVE_INFINITY;
    const node = nodeOfPosition(pos.x, pos.y);
    return hexDistanceBetween(node.hx, node.hy, target.hx, target.hy);
  };
  return units
    .map((unit) => ({ unit, id: idOf(unit), distance: distanceOf(unit) }))
    .sort((a, b) => a.distance - b.distance || a.id - b.id)
    .map(({ unit }) => unit);
}
