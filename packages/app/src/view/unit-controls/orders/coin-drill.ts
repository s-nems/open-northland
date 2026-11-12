import type { BuildingType, ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTypeOf,
  isFinishedBuilding,
  isPlayerControllable,
  isSettler,
  num,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerExperienceOf,
} from '../../../game/snapshot/index.js';

/** The slice of a building type the gate reads. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/**
 * The sim's `mayCoinDrillAt` as far as a snapshot shows it: a finished barracks of the soldier's own owner,
 * and `mayCoinDrill` on his trade, weapon and fight points. The walk to its door is the sim's to judge, and
 * a coin in the barracks is not asked for, as the order does not ask for one.
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

/** The settlers among `settlers` a coin drill at `building` takes, in their order. */
export function coinDrillersAt(
  content: ContentSet,
  snapshot: WorldSnapshot,
  building: number,
  settlers: readonly number[],
  byType: ReadonlyMap<number, BuildingInfo>,
): number[] {
  const house = entityById(snapshot, building);
  if (house === undefined) return [];
  return settlers.filter((id) => {
    const settler = entityById(snapshot, id);
    return settler !== undefined && mayCoinDrillHere(content, settler, house, byType);
  });
}
