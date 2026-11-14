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
  coinDrillHouseOf,
  isBarredFromExperience,
  isFinishedBuilding,
  isPlayerControllable,
  isSettler,
  num,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerExperienceOf,
  settlerJobType,
} from '../../../game/snapshot/index.js';
import { liveAmounts } from '../../../hud/details-panel/model/building-materials.js';

/** The slice of a building type the gate reads. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/** A barracks judged once for a press or a hint: its id and owner, and the drill coins it shows. */
export interface CoinDrillHouse {
  readonly id: number;
  readonly owner: number | undefined;
  readonly coins: number;
}

/**
 * `building` as a coin-drill barracks as far as a snapshot shows it: a finished barracks that shows a coin.
 * Undefined for any other building.
 */
export function coinDrillHouse(
  content: ContentSet,
  building: SnapshotEntity,
  byType: ReadonlyMap<number, BuildingInfo>,
): CoinDrillHouse | undefined {
  if (!isFinishedBuilding(building)) return undefined;
  const typeId = buildingTypeOf(building);
  const def = typeId === undefined ? undefined : byType.get(typeId);
  if (def === undefined || !systems.isBarracksType(def)) return undefined;
  const coins = drillCoinsShown(content, building);
  return coins > 0 ? { id: building.id, owner: ownerPlayerOf(building), coins } : undefined;
}

/**
 * The sim's `mayCoinDrillAt` for one soldier at a judged barracks of his own owner: `mayCoinDrill` on his
 * trade, weapon and fight points, not barred from experience by a script, and not drilling there already.
 * The snapshot leaves out two things the sim judges: the coins men already on their way speak for, and the
 * walk to the door, so the sim may still refuse an order this admits.
 */
export function mayCoinDrillAtHouse(
  content: ContentSet,
  settler: SnapshotEntity,
  house: CoinDrillHouse,
): boolean {
  if (!isSettler(settler) || !isPlayerControllable(settler)) return false;
  if (house.owner !== ownerPlayerOf(settler)) return false;
  if (isBarredFromExperience(settler) || coinDrillHouseOf(settler) === house.id) return false;
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

/** Whether the settler `id` is a soldier or a hero, whom a barracks never enlists again. */
export function isFighterSettler(content: ContentSet, snapshot: WorldSnapshot, id: number): boolean {
  const settler = entityById(snapshot, id);
  return settler !== undefined && systems.isFighterJob(content, settlerJobType(settler) ?? null);
}

/** The drill coins on `building`'s shelf as the snapshot shows them. */
function drillCoinsShown(content: ContentSet, building: SnapshotEntity): number {
  const coin = systems.drillCoinGood(content);
  return coin === undefined ? 0 : (liveAmounts(building.components.Stockpile).get(coin) ?? 0);
}

/** The settlers among `settlers` a press on `building` sends to coin-drill: nearest first while the coins
 *  it shows last. Empty for a building that is no coin-drill barracks. */
export function coinDrillersAt(
  content: ContentSet,
  snapshot: WorldSnapshot,
  building: number,
  settlers: readonly number[],
  byType: ReadonlyMap<number, BuildingInfo>,
): readonly number[] {
  const entity = entityById(snapshot, building);
  const house = entity === undefined ? undefined : coinDrillHouse(content, entity, byType);
  if (house === undefined) return NO_DRILLERS;
  const eligible = settlers.filter((id) => {
    const settler = entityById(snapshot, id);
    return settler !== undefined && mayCoinDrillAtHouse(content, settler, house);
  });
  return paidDrillers(snapshot, house, eligible, (id) => id);
}

const NO_DRILLERS: readonly number[] = [];

/**
 * The `drillers` the coins `house` shows pay for, nearest first. The sim admits a group's drill orders
 * in command order while free coins last, so the nearest men get them.
 */
export function paidDrillers<T>(
  snapshot: WorldSnapshot,
  house: CoinDrillHouse,
  drillers: readonly T[],
  idOf: (unit: T) => number,
): T[] {
  return nearestToBuildingFirst(snapshot, house.id, drillers, idOf).slice(0, house.coins);
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
