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
import { liveAmounts } from '../../../hud/details-panel/model/building-materials.js';

/** The slice of a building type the gate reads. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/**
 * The sim's `mayCoinDrillAt` as far as a snapshot shows it: a finished barracks of the soldier's own owner
 * that shows a coin, and `mayCoinDrill` on his trade, weapon and fight points. The walk to its door is the
 * sim's to judge.
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
  if (drillCoinsShown(content, building) <= 0) return false;
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

/**
 * The drill coins on `building`'s shelf as the snapshot shows them. An estimate: the coins men already
 * walking there speak for do not show, and the sim refuses an order past the free ones.
 */
export function drillCoinsShown(content: ContentSet, building: SnapshotEntity): number {
  const coin = systems.drillCoinGood(content);
  return coin === undefined ? 0 : (liveAmounts(building.components.Stockpile).get(coin) ?? 0);
}

/**
 * The settlers among `settlers` who may coin-drill at `building` (`eligible`), and those of them it sends
 * (`sent`): nearest first while the coins it shows last. The eligible men past them get no order.
 */
export function coinDrillersAt(
  content: ContentSet,
  snapshot: WorldSnapshot,
  building: number,
  settlers: readonly number[],
  byType: ReadonlyMap<number, BuildingInfo>,
): { readonly eligible: readonly number[]; readonly sent: readonly number[] } {
  const house = entityById(snapshot, building);
  if (house === undefined) return { eligible: [], sent: [] };
  const eligible = settlers.filter((id) => {
    const settler = entityById(snapshot, id);
    return settler !== undefined && mayCoinDrillHere(content, settler, house, byType);
  });
  return { eligible, sent: paidDrillers(content, snapshot, building, eligible, (id) => id) };
}

/**
 * The `drillers` the coins `building` shows pay for, nearest first. The sim admits a group's drill orders
 * in command order while free coins last, so the nearest men get them.
 */
export function paidDrillers<T>(
  content: ContentSet,
  snapshot: WorldSnapshot,
  building: number,
  drillers: readonly T[],
  idOf: (unit: T) => number,
): T[] {
  const house = entityById(snapshot, building);
  const coins = house === undefined ? 0 : drillCoinsShown(content, house);
  return nearestToBuildingFirst(snapshot, building, drillers, idOf).slice(0, coins);
}

/** `units` ordered nearest to `building` first, then by id; an unplaced one goes last. */
function nearestToBuildingFirst<T>(
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
