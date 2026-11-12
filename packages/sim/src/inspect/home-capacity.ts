import type { BuildingType, GoodType, HomeQualityUse } from '@open-northland/data';
import { ONE } from '../core/fixed.js';
import { isPlainRecord } from '../core/plain-value.js';
import { householdGoodPolicyView } from './household-policy.js';
import { entityById, homeQualityView, type WorldSnapshot } from './snapshot.js';

// Owner's design: furniture lets a home take `furnishedFamilies` more families than its `homeSize`. The
// sim's `homeFamilyCapacity` and the snapshot reader below decide it by the same two rules.

/** What decides whether a home's stored household ware serves it now. */
export interface HomeWareState {
  readonly kind: BuildingType['kind'] | undefined;
  /** Construction progress, `ONE` once finished. */
  readonly built: number;
  /** Zero-based upgrade level. */
  readonly level: number;
  /** Quality points of the ware's effect the home stores. */
  readonly pool: number;
  /** The owner's household policy lets the home use the ware. */
  readonly allowed: boolean;
}

/** Whether a home's stored ware serves it now: a finished home at the ware's level or above, holding some
 *  of it, that its owner lets use it. */
export function homeWareServes(home: HomeWareState, use: Pick<HomeQualityUse, 'minimumHomeLevel'>): boolean {
  return (
    home.pool > 0 &&
    home.kind === 'home' &&
    home.built >= ONE &&
    home.level >= use.minimumHomeLevel &&
    home.allowed
  );
}

/** What a home at zero-based upgrade `level` keeps of `use`: a lodging ware's `largeHome` figures from
 *  that row's level on, the ware's own below it. */
export function homeWareStock(
  use: HomeQualityUse,
  level: number,
): Pick<HomeQualityUse, 'capacity' | 'fetchBelow'> {
  const large = use.effect === 'lodging' ? use.largeHome : undefined;
  return large !== undefined && level >= large.fromLevel ? large : use;
}

/** The families a home of `type` takes: its `homeSize`, plus its `furnishedFamilies` while `furnished`. */
export function familyCapacity(
  type: Pick<BuildingType, 'homeSize' | 'furnishedFamilies'>,
  furnished: boolean,
): number {
  return furnished ? type.homeSize + type.furnishedFamilies : type.homeSize;
}

const lodgingWares = new WeakMap<readonly GoodType[], HomeQualityUse | null>();

/** The first lodging ware of `goods`, in content order, as the sim picks the one that houses families. */
function lodgingWareOf(goods: readonly GoodType[]): HomeQualityUse | null {
  let ware = lodgingWares.get(goods);
  if (ware === undefined) {
    ware = goods.find((good) => good.homeQuality?.effect === 'lodging')?.homeQuality ?? null;
    lodgingWares.set(goods, ware);
  }
  return ware;
}

/** Whether `home`'s furniture serves it as `snapshot` shows it. */
function homeFurnished(
  snapshot: WorldSnapshot,
  home: number,
  kind: BuildingType['kind'],
  furniture: HomeQualityUse,
): boolean {
  const e = entityById(snapshot, home);
  const building = e?.components.Building;
  if (!isPlainRecord(building)) return false;
  const { built, level } = building;
  if (typeof built !== 'number' || typeof level !== 'number') return false;
  const owner = e?.components.Owner;
  const player = isPlainRecord(owner) && typeof owner.player === 'number' ? owner.player : undefined;
  const pool = homeQualityView(snapshot, home)?.lodging ?? 0;
  const allowed = player === undefined || householdGoodPolicyView(snapshot, player).lodging;
  return homeWareServes({ kind, built, level, pool, allowed }, furniture);
}

/**
 * How many families `home` takes as `snapshot` shows it, by the sim's rule ({@link familyCapacity}): `type`
 * is its building type, and the first lodging ware of `goods` is the furniture that may add to it.
 */
export function homeFamilyCapacityView(
  snapshot: WorldSnapshot,
  home: number,
  type: Pick<BuildingType, 'kind' | 'homeSize' | 'furnishedFamilies'>,
  goods: readonly GoodType[],
): number {
  const furniture = type.furnishedFamilies > 0 ? lodgingWareOf(goods) : null;
  return familyCapacity(type, furniture !== null && homeFurnished(snapshot, home, type.kind, furniture));
}
