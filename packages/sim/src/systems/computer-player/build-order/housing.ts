import type { BuildingType, ContentSet } from '@open-northland/data';
import {
  Building,
  CHILD_FOOD_UNITS,
  Female,
  type GoodsLine,
  UnderConstruction,
  Upgrading,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { isBuilt, ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { buildingEnabled } from '../../progression/index.js';
import { seatStockOf } from '../../stores/index.js';
import { femaleDemand } from '../female-stock.js';
import { foodWorkshopBuilt, storedFoodUnits } from '../workforce/food.js';
import { billSourced } from './bill-sources.js';
import type { BuildOrderEntry } from './entries.js';
import { placementSpot } from './placement.js';
import { seatHasSide } from './seat-order.js';
import { suppliedUpgrade } from './upgrade-supply.js';

type HousingEntry = Extract<BuildOrderEntry, { kind: 'housing' }>;

/**
 * How far the housing lane runs ahead, by the seat's food (owner ruling: homes come slowly at the very
 * start while no workshop makes food and no fisher fishes; once food is made the lane stokes the furnace,
 * and once the brewery and an upper-tier bakery stand the seat is safe and raises many children):
 * `opening` before any food is made, `feeding` once a workshop making food stands or the seat fishes,
 * `thriving` once every {@link HOUSING_THRIVING_BUILDINGS} building stands too.
 */
export type HousingStage = 'opening' | 'feeding' | 'thriving';

/** The buildings, by stable content id (or a tier above), whose standing makes the seat `thriving` (owner
 *  ruling): the brewery for the adults' mead and the upper-tier bakery for the children's bread. */
export const HOUSING_THRIVING_BUILDINGS: readonly string[] = ['work_brewery', 'work_bakery_01'];

/** What the lane keeps at each stage: `freeSlots` family slots beyond the seat's female demand, and up to
 *  `sites` home sites at once, the first one of the clock's sites and the others beyond them
 *  ({@link housingExtraSites}). */
export interface HousingPace {
  readonly freeSlots: number;
  readonly sites: number;
}

/** Authored, owner ruling on the order. `opening`: two free slots, one for the next daughter the assistant
 *  books and one for the one after while the next home rises, on one site. `feeding` doubles the lead on a
 *  second site, `thriving` doubles it again on a third: on magiczny_las two free slots held six to eight
 *  women for the first forty game minutes while the bread and the meat already ran. */
export const HOUSING_PACE: Readonly<Record<HousingStage, HousingPace>> = {
  opening: { freeSlots: 2, sites: 1 },
  feeding: { freeSlots: 4, sites: 2 },
  thriving: { freeSlots: 8, sites: 3 },
};

/** Whether the seat has a built building of each {@link HOUSING_THRIVING_BUILDINGS} id or a tier above. */
function thrivingBuilt(world: World, ctx: SystemContext, owned: readonly Entity[]): boolean {
  const index = contentIndex(ctx.content);
  return HOUSING_THRIVING_BUILDINGS.every((id) => {
    const type = buildingTypeByContentId(ctx.content, id);
    if (type === undefined) return false;
    const tiers = tiersAtOrAbove(index, type);
    return owned.some((e) => tiers.has(world.get(e, Building).buildingType) && isBuilt(world, e));
  });
}

/** The seat's {@link HousingStage}. */
export function housingStage(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): HousingStage {
  if (!seatHasSide(world, player, 'fishing') && !foodWorkshopBuilt(world, ctx, owned)) return 'opening';
  return thrivingBuilt(world, ctx, owned) ? 'thriving' : 'feeding';
}

/** The home sites the lane may hold beyond the clock's `siteCap` at `stage`: its pace's sites but the one
 *  that is the clock's own, and never more than the clock's sites but one, so a one-site difficulty keeps
 *  its single site and a two-site one at most doubles it (`../difficulty.ts`). */
export function housingExtraSites(stage: HousingStage, siteCap: number): number {
  return Math.max(0, Math.min(HOUSING_PACE[stage].sites - 1, siteCap - 1));
}

/** The home tiers `entry`'s lane raises: its base tier and every tier above it; none when the content
 *  lacks the base. */
export function homeTiersOf(content: ContentSet, entry: HousingEntry): ReadonlySet<number> {
  const base = buildingTypeByContentId(content, entry.building);
  return base === undefined ? new Set() : tiersAtOrAbove(contentIndex(content), base);
}

/** The seat's homes on `entry`'s chain, canonical ascending. */
function homesOf(world: World, ctx: SystemContext, owned: readonly Entity[], entry: HousingEntry): Entity[] {
  const tiers = homeTiersOf(ctx.content, entry);
  return owned.filter((e) => tiers.has(world.get(e, Building).buildingType));
}

/** The family slots the seat's homes will hold, a site counted at the tier it is becoming. */
function familySlots(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  entry: HousingEntry,
): number {
  const index = contentIndex(ctx.content);
  let slots = 0;
  for (const e of homesOf(world, ctx, owned, entry)) {
    const tier = world.tryGet(e, Upgrading)?.target ?? world.get(e, Building).buildingType;
    slots += index.buildings.get(tier)?.homeSize ?? 0;
  }
  return slots;
}

/** Whether the {@link familySlots} fall short of the seat's women, girls and booked daughters
 *  ({@link femaleDemand}) plus the stage's free slots ({@link HOUSING_PACE}). The population module books
 *  daughters only up to the built homes' slots, so the lane keeps them ahead. */
function slotsShort(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: HousingEntry,
  stage: HousingStage,
): boolean {
  return (
    familySlots(world, ctx, owned, entry) < femaleDemand(world, ctx, player) + HOUSING_PACE[stage].freeSlots
  );
}

/** Whether a built home of `entry`'s chain stands below the seat's highest home tier, sites counted at
 *  the tier they are becoming. */
function homesLag(world: World, ctx: SystemContext, owned: readonly Entity[], entry: HousingEntry): boolean {
  const index = contentIndex(ctx.content);
  let lowest = Number.POSITIVE_INFINITY;
  let highest = 0;
  for (const e of homesOf(world, ctx, owned, entry)) {
    const tier = world.tryGet(e, Upgrading)?.target ?? world.get(e, Building).buildingType;
    const size = index.buildings.get(tier)?.homeSize ?? 0;
    highest = Math.max(highest, size);
    if (isBuilt(world, e) && !world.has(e, UnderConstruction)) lowest = Math.min(lowest, size);
  }
  return lowest < highest;
}

/** Whether the lane wants a site: the family slots fall short ({@link slotsShort}), or, once the seat
 *  makes food, a home lags below the highest tier (owner ruling: the opening's lower-tier homes are
 *  upgraded rather than left standing). */
export function housingShort(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: HousingEntry,
): boolean {
  const stage = housingStage(world, ctx, player, owned);
  return (
    slotsShort(world, ctx, player, owned, entry, stage) ||
    (stage !== 'opening' && homesLag(world, ctx, owned, entry))
  );
}

/** Whether the seat has women or daughters and no family slot left for the next daughter. */
export function daughtersBlocked(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: HousingEntry,
): boolean {
  const demand = femaleDemand(world, ctx, player);
  return demand > 0 && familySlots(world, ctx, owned, entry) <= demand;
}

/** Stored edible units a settler from which a seat counts as food-rich (authored): above every focus
 *  map's start stock (75 for 18-19 settlers on magiczny_las and diamentowa_dolina, 25-35 for 17-40 on
 *  mroczny_las, krwawa_rzeka and specjalna_forteca), so a seat starts rich by fishing or grows rich. */
export const FOOD_RICH_UNITS_PER_SETTLER = 5;

/** The seat's food runs short for the housing lane while its store holds under one child's food
 *  ({@link CHILD_FOOD_UNITS}) a woman: then its families cannot all stock a larder for the next child.
 *  Authored; a line a settler sat under it on magiczny_las from minute 20 to 50 while children were born. */
export const HOUSING_FOOD_UNITS_PER_WOMAN = CHILD_FOOD_UNITS;

/**
 * When the housing lane may open a home site (owner ruling: an upgraded home bears no children while
 * food is short): `closed` while the store's food runs short ({@link HOUSING_FOOD_UNITS_PER_WOMAN}), or
 * on a seat that is not food-rich until a workshop making food beyond the grain farm stands; `early` on
 * a food-rich seat (the `fishing` side, or {@link FOOD_RICH_UNITS_PER_SETTLER} in store), which may run
 * the lane from the start of the opening; `inLine` otherwise, from the lane's place in its line.
 */
export type HousingGate = 'closed' | 'inLine' | 'early';

export function housingGate(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): HousingGate {
  const food = storedFoodUnits(ctx.content, seatStockOf(world, player));
  const settlers = ownedSettlers(world, player);
  let women = 0;
  for (const e of settlers) if (world.has(e, Female) && isAdultSettler(world, e)) women++;
  if (food < women * HOUSING_FOOD_UNITS_PER_WOMAN) return 'closed';
  if (seatHasSide(world, player, 'fishing') || food >= settlers.length * FOOD_RICH_UNITS_PER_SETTLER)
    return 'early';
  return foodWorkshopBuilt(world, ctx, owned) ? 'inLine' : 'closed';
}

/** What the housing lane raises next: an upgrade of a built home, or a new home of a tier at a spot. */
export type HousingPick =
  | { readonly kind: 'upgrade'; readonly building: Entity; readonly target: number }
  | { readonly kind: 'place'; readonly type: BuildingType; readonly spot: HalfCellNode };

/** What a way to add family slots costs, in bill units, and the slots it adds. */
interface Price {
  readonly cost: number;
  readonly slots: number;
}

interface Option<T> extends Price {
  readonly pick: T;
}

function cheaper(a: Price, b: Price | null): boolean {
  return b === null || a.cost * b.slots < b.cost * a.slots;
}

function billUnits(bill: readonly GoodsLine[]): number {
  let units = 0;
  for (const line of bill) units += line.amount;
  return units;
}

/** Whether upgrade `a` goes before `b`: in the `opening` stage the cheaper slot, later the home of the
 *  lower tier first (owner ruling: the opening's homes are upgraded rather than left), the cheaper slot
 *  among one tier's upgrades. */
function upgradeFirst(
  a: Option<HousingPick> & { readonly from: number },
  b: typeof a | null,
  stage: HousingStage,
): boolean {
  if (b === null) return true;
  if (stage !== 'opening' && a.from !== b.from) return a.from < b.from;
  return cheaper(a, b);
}

/**
 * The family slot the seat builds next, priced in bill units per slot gained (authored approximation:
 * every good weighs one unit): an upgrade of a built home to any enabled tier above it whose bill the store
 * backs ({@link suppliedUpgrade}), or, while the slots fall short and below `entry.count` homes, a new home
 * of any enabled tier whose merged bill has a source ({@link billSourced}), placed by the home rule of
 * {@link placementSpot}. In the `opening` stage the cheapest slot wins, a tie going to the upgrade, which
 * needs no room, then to the higher tier. From the `feeding` stage any upgrade wins over a new home and the
 * lowest-tier home goes first, so no home is left at the base tier; with the slots not short only a home
 * below the highest tier is upgraded. A new home with no spot yields to the best upgrade, so a cramped seat
 * grows its homes upward. Null when nothing can be raised.
 */
export function housingPick(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  entry: HousingEntry,
  underFire: EnemyFire,
  reserveGrass: boolean,
  made: () => ReadonlySet<number>,
): HousingPick | null {
  const index = contentIndex(ctx.content);
  const stage = housingStage(world, ctx, player, owned);
  const short = slotsShort(world, ctx, player, owned, entry, stage);
  const homes = homesOf(world, ctx, owned, entry);
  let highest = 0;
  for (const home of homes) {
    const tier = world.tryGet(home, Upgrading)?.target ?? world.get(home, Building).buildingType;
    highest = Math.max(highest, index.buildings.get(tier)?.homeSize ?? 0);
  }
  let upgrade: (Option<HousingPick> & { readonly from: number }) | null = null;
  // Homes of one type offer the same upgrades, so only the lowest-id built one of each is asked.
  const asked = new Set<number>();
  for (const home of homes) {
    const building = world.get(home, Building);
    if (!isBuilt(world, home) || world.has(home, UnderConstruction) || asked.has(building.buildingType))
      continue;
    asked.add(building.buildingType);
    const from = index.buildings.get(building.buildingType);
    if (from === undefined || (!short && from.homeSize >= highest)) continue;
    const seen = new Set<number>();
    for (let tier = from.upgradeTarget; tier !== undefined && !seen.has(tier); ) {
      seen.add(tier);
      const to = index.buildings.get(tier);
      if (to === undefined || !buildingEnabled(world, ctx, player, building.tribe, tier)) break;
      const bill = index.upgradeBillByTarget.get(from.typeId)?.get(tier);
      const option = {
        pick: { kind: 'upgrade', building: home, target: tier } as const,
        cost: bill === undefined ? 0 : billUnits(bill),
        slots: to.homeSize - from.homeSize,
        from: from.homeSize,
      };
      if (
        bill !== undefined &&
        option.slots > 0 &&
        upgradeFirst(option, upgrade, stage) &&
        suppliedUpgrade(world, ctx, player, owned, home, [tier]) === tier
      )
        upgrade = option;
      tier = to.upgradeTarget;
    }
  }
  if (upgrade !== null && stage !== 'opening') return upgrade.pick;

  let place: Option<BuildingType> | null = null;
  if (short && homes.length < entry.count) {
    const types = [...homeTiersOf(ctx.content, entry)]
      .flatMap((id) => index.buildings.get(id) ?? [])
      .sort((a, b) => b.homeSize - a.homeSize);
    for (const type of types) {
      if (type.homeSize <= 0 || !buildingEnabled(world, ctx, player, tribe, type.typeId)) continue;
      const option = {
        pick: type,
        cost: billUnits(index.constructionBillByBuilding.get(type.typeId) ?? []),
        slots: type.homeSize,
      };
      const step: BuildOrderEntry = { kind: 'place', building: type.id, count: 1 };
      if (cheaper(option, place) && billSourced(world, ctx, player, step, made)) place = option;
    }
  }

  if (place !== null && (upgrade === null || cheaper(place, upgrade))) {
    const step: Extract<BuildOrderEntry, { kind: 'place' }> = {
      kind: 'place',
      building: place.pick.id,
      count: 1,
    };
    const spot = placementSpot(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      place.pick,
      tribe,
      step,
      underFire,
      reserveGrass,
    );
    if (spot !== null) return { kind: 'place', type: place.pick, spot };
  }
  return upgrade?.pick ?? null;
}
