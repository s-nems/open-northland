import type { BuildingType, GoodType, HomeQualityUse } from '@open-northland/data';
import { ONE } from '../core/fixed.js';
import { isPlainRecord } from '../core/plain-value.js';
import { householdGoodPolicyView } from './household-policy.js';
import { entityById, homeQualityView, type WorldSnapshot } from './snapshot.js';

// Owner's design: a piece of furniture houses one family above a home's `homeSize`, up to its
// `furnishedFamilies`. The sim's `homeFamilyCapacity` and the snapshot reader below decide it by the same
// rules.

type LodgingUse = Extract<HomeQualityUse, { readonly effect: 'lodging' }>;
type HomeSlots = Pick<BuildingType, 'homeSize' | 'furnishedFamilies'>;

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

/** What a home of `type` keeps of `use` in store: a lodging ware as one spare unit per extra family the
 *  type takes, restocked whenever a whole one is missing, the other wares by their own figures. */
export function homeWareStock(
  use: HomeQualityUse,
  type: Pick<BuildingType, 'furnishedFamilies'>,
): { readonly capacity: number; readonly fetchBelow: number } {
  if (use.effect !== 'lodging') return use;
  const capacity = type.furnishedFamilies * use.deliveryValue;
  return { capacity, fetchBelow: capacity };
}

/** The families furniture can house in a home: one per piece in use and per whole spare unit of `pool`. */
export function furnishedSlots(use: LodgingUse, piecesInUse: number, pool: number): number {
  return piecesInUse + Math.floor(pool / use.deliveryValue);
}

/** The families a home of `type` takes: its `homeSize`, plus one per furnished slot up to its
 *  `furnishedFamilies`. */
export function familyCapacity(type: HomeSlots, slots: number): number {
  return type.homeSize + Math.min(type.furnishedFamilies, slots);
}

const lodgingWares = new WeakMap<readonly GoodType[], LodgingUse | null>();

/** The first lodging ware of `goods`, in content order, as the sim picks the one that houses families. */
function lodgingWareOf(goods: readonly GoodType[]): LodgingUse | null {
  let ware = lodgingWares.get(goods);
  if (ware === undefined) {
    const found = goods.find((good) => good.homeQuality?.effect === 'lodging')?.homeQuality;
    ware = found?.effect === 'lodging' ? found : null;
    lodgingWares.set(goods, ware);
  }
  return ware;
}

/** What is left of each piece `home`'s extra families live on, as `snapshot` shows it. */
export function lodgingPiecesView(snapshot: WorldSnapshot, home: number): readonly number[] {
  const raw = entityById(snapshot, home)?.components.Lodgings;
  const pieces = isPlainRecord(raw) ? raw.pieces : undefined;
  return Array.isArray(pieces) ? pieces.filter((left): left is number => typeof left === 'number') : [];
}

/** The slots `home`'s furniture serves as `snapshot` shows it. */
function furnishedSlotsView(
  snapshot: WorldSnapshot,
  home: number,
  kind: BuildingType['kind'],
  furniture: LodgingUse,
): number {
  const e = entityById(snapshot, home);
  const building = e?.components.Building;
  if (!isPlainRecord(building)) return 0;
  const { built, level } = building;
  if (typeof built !== 'number' || typeof level !== 'number') return 0;
  const owner = e?.components.Owner;
  const player = isPlainRecord(owner) && typeof owner.player === 'number' ? owner.player : undefined;
  const allowed = player === undefined || householdGoodPolicyView(snapshot, player).lodging;
  const slots = furnishedSlots(
    furniture,
    lodgingPiecesView(snapshot, home).length,
    homeQualityView(snapshot, home)?.lodging ?? 0,
  );
  return homeWareServes({ kind, built, level, pool: slots, allowed }, furniture) ? slots : 0;
}

/**
 * How many families `home` takes as `snapshot` shows it, by the sim's rule ({@link familyCapacity}): `type`
 * is its building type, and the first lodging ware of `goods` is the furniture that may add to it.
 */
export function homeFamilyCapacityView(
  snapshot: WorldSnapshot,
  home: number,
  type: HomeSlots & Pick<BuildingType, 'kind'>,
  goods: readonly GoodType[],
): number {
  const furniture = type.furnishedFamilies > 0 ? lodgingWareOf(goods) : null;
  return familyCapacity(
    type,
    furniture === null ? 0 : furnishedSlotsView(snapshot, home, type.kind, furniture),
  );
}
