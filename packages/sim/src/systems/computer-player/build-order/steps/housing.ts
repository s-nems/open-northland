import { BUILDING_KIND, type BuildingType, type ContentSet } from '@open-northland/data';
import {
  Building,
  CHILD_FOOD_UNITS,
  Female,
  type GoodsLine,
  UnderConstruction,
  Upgrading,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../../ai-shared/content-lookup.js';
import { homeSettlers } from '../../../ai-shared/home-roster.js';
import type { EnemyFire } from '../../../ai-shared/military/defence/index.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { isAdultSettler } from '../../../family/eligibility.js';
import { buildingEnabled } from '../../../progression/index.js';
import { femaleDemand } from '../../female-stock.js';
import { homeStockOf } from '../../home-stock.js';
import { seatFishes } from '../../workforce/fisher.js';
import { foodSourcesAtWork, foodWorkshopBuilt, storedFoodUnits } from '../../workforce/food.js';
import { seatHuntsGame } from '../../workforce/hunter.js';
import { placementSpot } from '../ground/placement.js';
import { seatHomesCap } from '../ground/plots.js';
import { roomHomesCap } from '../ground/room.js';
import type { BuildOrder, BuildOrderEntry } from '../order/entries.js';
import { billSourced, sourcedTiers } from '../supply/bill-sources.js';
import { suppliedUpgrade } from '../supply/upgrade-supply.js';

type HousingEntry = Extract<BuildOrderEntry, { kind: 'housing' }>;

/**
 * How far the housing lane runs ahead, by the seat's food (owner ruling: homes come slowly at the very
 * start while no workshop makes food and no fisher fishes; the animal farm's meat feeds the homes only
 * somewhat; once bread or fish is made the lane stokes the furnace, and once the brewery and an
 * upper-tier bakery stand the seat is safe and raises many children): `opening` before any food is made,
 * `herding` once a workshop making food stands but no {@link HOUSING_STAPLE_BUILDING} and no fisher,
 * `feeding` once the bakery stands or the seat fishes, `thriving` once every
 * {@link HOUSING_THRIVING_BUILDINGS} building stands too.
 */
export type HousingStage = 'opening' | 'herding' | 'feeding' | 'thriving';

/** The building, by stable content id (or a tier above), whose standing ends the `herding` stage (owner
 *  ruling): the first bakery, from which food grows to meet the population. */
export const HOUSING_STAPLE_BUILDING = 'work_bakery_00';

/** The buildings, by stable content id (or a tier above), whose standing makes the seat `thriving` (owner
 *  ruling): the brewery for the adults' mead and the upper-tier bakery for the children's bread. */
export const HOUSING_THRIVING_BUILDINGS: readonly string[] = ['work_brewery', 'work_bakery_01'];

/** What the lane keeps at each stage: `freeSlots` family slots beyond the seat's female demand, and up to
 *  `sites` home sites at once, the first one of the clock's sites, or none once they stand apart, and the
 *  others beyond them ({@link housingExtraSites}). */
export interface HousingPace {
  readonly freeSlots: number;
  readonly sites: number;
}

/** Authored: two free slots, one for the next daughter the assistant books and one for the one after
 *  while the next home rises, on one site. */
const OPENING_PACE: HousingPace = { freeSlots: 2, sites: 1 };

/** Authored, owner ruling on the order. `opening` keeps {@link OPENING_PACE} and `herding` keeps it too
 *  (owner ruling: the animal farm alone does not speed the homes). `feeding` doubles the lead on a second
 *  site, `thriving` doubles it again on a third: on magiczny_las two free slots held six to eight women for
 *  the first forty game minutes while the bread and the meat already ran. */
export const HOUSING_PACE: Readonly<Record<HousingStage, HousingPace>> = {
  opening: OPENING_PACE,
  herding: OPENING_PACE,
  feeding: { freeSlots: 4, sites: 2 },
  thriving: { freeSlots: 8, sites: 3 },
};

/** Whether the seat has a built building of content id `id` or a tier above. */
function builtAtOrAbove(world: World, ctx: SystemContext, owned: readonly Entity[], id: string): boolean {
  const type = buildingTypeByContentId(ctx.content, id);
  if (type === undefined) return false;
  const tiers = tiersAtOrAbove(contentIndex(ctx.content), type);
  return owned.some((e) => tiers.has(world.get(e, Building).buildingType) && isBuilt(world, e));
}

/** The seat's {@link HousingStage}. */
export function housingStage(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): HousingStage {
  if (!seatFishes(world, ctx, player)) {
    if (!foodWorkshopBuilt(world, ctx, owned)) return 'opening';
    if (!builtAtOrAbove(world, ctx, owned, HOUSING_STAPLE_BUILDING)) return 'herding';
  }
  return HOUSING_THRIVING_BUILDINGS.every((id) => builtAtOrAbove(world, ctx, owned, id))
    ? 'thriving'
    : 'feeding';
}

/** The home tier, by stable content id, the `herding` stage raises at most {@link HERDING_TOP_HOMES} homes
 *  to and none beyond (owner ruling: the animal farm satisfies the homes only somewhat, the third tier). */
export const HERDING_HOME_TIER_CAP = 'home_level_02';

/** The homes the `herding` stage keeps at {@link HERDING_HOME_TIER_CAP}, `wellFed` on a seat with extra
 *  food: {@link FOOD_RICH_UNITS_PER_SETTLER} in store, or game on its hunting ground (owner ruling). */
export const HERDING_TOP_HOMES = { lean: 1, wellFed: 2 } as const;

/** The `herding` stage's limit on home upgrades: `capped` the chain's tiers from the cap up, of which only
 *  `cap` itself is a target, and that while `left` homes may still reach it. */
interface HerdingCeiling {
  readonly cap: number;
  readonly capped: ReadonlySet<number>;
  readonly left: number;
}

/** The seat's {@link HerdingCeiling}; null outside the `herding` stage or when the content lacks the cap
 *  tier, which leaves the upgrades free. */
function herdingCeiling(
  world: World,
  ctx: SystemContext,
  player: number,
  homes: readonly Entity[],
  stage: HousingStage,
): HerdingCeiling | null {
  if (stage !== 'herding') return null;
  const cap = buildingTypeByContentId(ctx.content, HERDING_HOME_TIER_CAP);
  if (cap === undefined) return null;
  const capped = tiersAtOrAbove(contentIndex(ctx.content), cap);
  let top = 0;
  for (const e of homes)
    if (capped.has(world.tryGet(e, Upgrading)?.target ?? world.get(e, Building).buildingType)) top++;
  const settlers = homeSettlers(world, ctx, player).length;
  const wellFed =
    storedFoodUnits(ctx.content, homeStockOf(world, ctx, player)) >= settlers * FOOD_RICH_UNITS_PER_SETTLER ||
    seatHuntsGame(world, ctx, player);
  const quota = wellFed ? HERDING_TOP_HOMES.wellFed : HERDING_TOP_HOMES.lean;
  return { cap: cap.typeId, capped, left: Math.max(0, quota - top) };
}

/** Whether the `herding` stage still raises a built home below its cap to the cap: the ceiling has room
 *  and such a home may be upgraded to the cap tier. */
function herdingUpgradeLeft(
  world: World,
  ctx: SystemContext,
  player: number,
  homes: readonly Entity[],
  ceiling: HerdingCeiling | null,
): boolean {
  if (ceiling === null || ceiling.left === 0) return false;
  return homes.some((e) => {
    const building = world.get(e, Building);
    return (
      isBuilt(world, e) &&
      !world.has(e, UnderConstruction) &&
      !world.has(e, Upgrading) &&
      !ceiling.capped.has(building.buildingType) &&
      buildingEnabled(world, ctx, player, building.tribe, ceiling.cap)
    );
  });
}

/** The home sites the lane may hold beyond the clock's `siteCap` at `stage`: its pace's sites but the one
 *  that is the clock's own, and never more than the clock's sites but one, so a one-site difficulty keeps
 *  its single site and a two-site one at most doubles it (`../../difficulty.ts`). With `apart` every home site
 *  stands beyond the clock, never more than the clock's sites. */
export function housingExtraSites(stage: HousingStage, siteCap: number, apart: boolean): number {
  const counted = apart ? 0 : 1;
  return Math.max(0, Math.min(HOUSING_PACE[stage].sites - counted, siteCap - counted));
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

/** The homes of the seat's first wave: the most a home `place` step of its `opening` line raises (owner
 *  ruling: three on a cramped seat, four with room, five on a rich one), 0 when the line raises none. */
export function openingHomeCount(ctx: SystemContext, order: BuildOrder): number {
  let count = 0;
  for (const line of order.lines) {
    if (line.id !== 'opening') continue;
    for (const entry of line.steps) {
      if (entry.kind !== 'place') continue;
      if (buildingTypeByContentId(ctx.content, entry.building)?.kind !== BUILDING_KIND.home) continue;
      count = Math.max(count, entry.count);
    }
  }
  return count;
}

/** Whether the seat's first wave of homes stands: it owns {@link openingHomeCount} built homes of any
 *  tier. */
export function openingHomesStand(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  owned: readonly Entity[],
): boolean {
  const wave = seatHomesCap(world, player, openingHomeCount(ctx, order));
  if (wave === 0) return true;
  const index = contentIndex(ctx.content);
  let built = 0;
  for (const e of owned) {
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind !== BUILDING_KIND.home) continue;
    if (isBuilt(world, e) && ++built >= wave) return true;
  }
  return false;
}

/** Whether the lane wants a site: the family slots fall short ({@link slotsShort}); in the `herding`
 *  stage, a home may still rise to its ceiling ({@link herdingUpgradeLeft}); from the `feeding` stage, a
 *  home lags below the highest tier (owner ruling: the opening's lower-tier homes are upgraded rather
 *  than left standing). */
export function housingShort(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: HousingEntry,
): boolean {
  const stage = housingStage(world, ctx, player, owned);
  if (slotsShort(world, ctx, player, owned, entry, stage)) return true;
  if (stage === 'opening') return false;
  if (stage === 'herding') {
    const homes = homesOf(world, ctx, owned, entry);
    return herdingUpgradeLeft(world, ctx, player, homes, herdingCeiling(world, ctx, player, homes, stage));
  }
  return homesLag(world, ctx, owned, entry);
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

/** The women and daughters one food source at work carries past a short store (owner ruling: more homes,
 *  more women, more people, held back only at the very start with no fisher and no bakery). Authored: the
 *  four women every start brings; on battle_for_the_four_hills_multiplayer a seat with its bakery and
 *  animal farm staffed made three to five food a minute from minute 40 and fed 30 to 37 settlers with an
 *  empty store, its homes' larders taking the bread as it was baked. */
export const HOUSING_WOMEN_PER_FOOD_SOURCE = 4;

/** Whether the seat feeds its women steadily whatever its store holds: a staple source works (a staffed
 *  workshop making food, or a fisher) and its sources, hunters added, carry
 *  {@link HOUSING_WOMEN_PER_FOOD_SOURCE} each beyond its female demand. */
function foodMadeCarriesWomen(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): boolean {
  const sources = foodSourcesAtWork(world, ctx, player, owned);
  if (sources.staples === 0) return false;
  return (
    femaleDemand(world, ctx, player) < (sources.staples + sources.hunters) * HOUSING_WOMEN_PER_FOOD_SOURCE
  );
}

/**
 * When the housing lane may open a home site (owner ruling: an upgraded home bears no children while
 * food is short): `closed` while the store's food runs short ({@link HOUSING_FOOD_UNITS_PER_WOMAN}) and
 * the food made does not carry the women ({@link foodMadeCarriesWomen}), or on a seat that is not
 * food-rich until a workshop making food beyond the grain farm stands; `early` on
 * a food-rich seat (one that fishes, or holds {@link FOOD_RICH_UNITS_PER_SETTLER} in store), which may run
 * the lane from the start of the opening; `inLine` otherwise, from the lane's place in its line.
 */
export type HousingGate = 'closed' | 'inLine' | 'early';

export function housingGate(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): HousingGate {
  const food = storedFoodUnits(ctx.content, homeStockOf(world, ctx, player));
  const settlers = homeSettlers(world, ctx, player);
  let women = 0;
  for (const e of settlers) if (world.has(e, Female) && isAdultSettler(world, e)) women++;
  if (food < women * HOUSING_FOOD_UNITS_PER_WOMAN && !foodMadeCarriesWomen(world, ctx, player, owned))
    return 'closed';
  if (seatFishes(world, ctx, player) || food >= settlers.length * FOOD_RICH_UNITS_PER_SETTLER) return 'early';
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

/** Whether the stage puts any upgrade before a new home and lifts the lowest-tier homes first (owner
 *  ruling: from the `feeding` stage the opening's homes are upgraded rather than left). */
function upgradesLead(stage: HousingStage): boolean {
  return stage === 'feeding' || stage === 'thriving';
}

/** Whether upgrade `a` goes before `b`: while {@link upgradesLead}, the home of the lower tier first, the
 *  cheaper slot among one tier's upgrades; otherwise the cheaper slot. */
function upgradeFirst(
  a: Option<HousingPick> & { readonly from: number },
  b: typeof a | null,
  stage: HousingStage,
): boolean {
  if (b === null) return true;
  if (upgradesLead(stage) && a.from !== b.from) return a.from < b.from;
  return cheaper(a, b);
}

/**
 * Whether the seat may start upgrading a standing home of `size` slots: while no home of the lane is
 * upgrading, or while the standing homes without it still keep a slot free beyond the seat's female
 * demand ({@link femaleDemand}). An upgrading home holds no slot the population module books a daughter
 * into, so several at once leave the seat no room to grow while they rise (authored: on krwawa_rzeka a
 * seat upgraded all four of its base homes at once and stayed at 4-5 women from game minute 40 to 80).
 */
function upgradeLeavesRoom(
  world: World,
  ctx: SystemContext,
  player: number,
  homes: readonly Entity[],
): (size: number) => boolean {
  if (!homes.some((e) => world.has(e, Upgrading))) return () => true;
  const index = contentIndex(ctx.content);
  let standing = 0;
  for (const e of homes)
    if (isBuilt(world, e) && !world.has(e, UnderConstruction))
      standing += index.buildings.get(world.get(e, Building).buildingType)?.homeSize ?? 0;
  const demand = femaleDemand(world, ctx, player);
  return (size) => standing - size > demand;
}

/**
 * The family slot the seat builds next, priced in bill units per slot gained (authored approximation:
 * every good weighs one unit): an upgrade of a built home, while it leaves room ({@link upgradeLeavesRoom}),
 * to any enabled tier above it, every tier on the way with a source for its own bill ({@link sourcedTiers}),
 * whose bill the store backs ({@link suppliedUpgrade}), or, while the slots fall short and below
 * `entry.count` homes, a new home of any enabled tier whose merged bill has a source ({@link billSourced}),
 * placed by the home rule of {@link placementSpot}. In the `opening` stage the cheapest slot wins, a tie
 * going to the upgrade, which needs no room, then to the higher tier. The `herding` stage picks as the
 * opening does, but raises no home, new or upgraded, above its ceiling ({@link HerdingCeiling}) and, with
 * the slots not short, only a home to the cap while the ceiling has room. From the `feeding` stage any
 * upgrade wins over a new home and the lowest-tier home goes first, so no home is left at the base tier;
 * with the slots not short only a home below the highest tier is upgraded. A new home with no spot yields
 * to the best upgrade, so a cramped seat grows its homes upward. A seat's ground plan cuts `entry.count`
 * further ({@link seatHomesCap}); once its homes reach that, the room its land still holds lifts it
 * ({@link roomHomesCap}). Null when nothing can be raised.
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
  const ceiling = herdingCeiling(world, ctx, player, homes, stage);
  const upgradeOpen = upgradeLeavesRoom(world, ctx, player, homes);
  let upgrade: (Option<HousingPick> & { readonly from: number }) | null = null;
  // Homes of one type offer the same tiers, so only the lowest-id built one of each is asked; its own pile
  // alone weighs in the supply check (`suppliedUpgrade`), which another home's may judge differently.
  const asked = new Set<number>();
  for (const home of homes) {
    const building = world.get(home, Building);
    if (!isBuilt(world, home) || world.has(home, UnderConstruction) || asked.has(building.buildingType))
      continue;
    asked.add(building.buildingType);
    const from = index.buildings.get(building.buildingType);
    if (from === undefined || !upgradeOpen(from.homeSize)) continue;
    const seen = new Set<number>();
    for (let tier = from.upgradeTarget; tier !== undefined && !seen.has(tier); ) {
      seen.add(tier);
      const to = index.buildings.get(tier);
      if (to === undefined || !buildingEnabled(world, ctx, player, building.tribe, tier)) break;
      if (sourcedTiers(world, ctx, player, [tier], made).length === 0) break;
      if (ceiling?.capped.has(tier) && (tier !== ceiling.cap || ceiling.left === 0)) break;
      const lags = ceiling === null ? from.homeSize < highest : tier === ceiling.cap;
      if (!short && !lags) {
        tier = to.upgradeTarget;
        continue;
      }
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
  if (upgrade !== null && upgradesLead(stage)) return upgrade.pick;

  let place: Option<BuildingType> | null = null;
  const cap = roomHomesCap(world, player, seatHomesCap(world, player, entry.count));
  if (short && homes.length < cap) {
    const types = [...homeTiersOf(ctx.content, entry)]
      .flatMap((id) => index.buildings.get(id) ?? [])
      .sort((a, b) => b.homeSize - a.homeSize);
    for (const type of types) {
      if (type.homeSize <= 0 || !buildingEnabled(world, ctx, player, tribe, type.typeId)) continue;
      if (ceiling?.capped.has(type.typeId) && (type.typeId !== ceiling.cap || ceiling.left === 0)) continue;
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
