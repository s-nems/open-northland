import type { BuildingType, ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import {
  buildingTypeByContentId,
  goodTypeByContentId,
  tiersAtOrAbove,
} from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { farmWorkGood } from '../../economy/fields.js';
import { isCarrierJob } from '../../stores/index.js';
import { breadChainSupplier } from '../build-order/food-first.js';
import { seatHasSide, TUNIC_SIDES } from '../build-order/seat-order.js';
import type { ComputerProfile } from '../difficulty.js';
import {
  CORE_CREW_FROM_TICKS,
  STORE_CARRIERS_FROM_TICKS,
  TRAINING_CARRIERS_FROM_TICKS,
} from '../game-phase.js';
import { seatHerdKept } from '../herd.js';
import { COLLECTED_GOOD_IDS, COLLECTOR_WORKSHOP_BY_GOOD_ID } from './collectors/index.js';
import { craftGlutPending, openingRunPending, productsOf } from './craft.js';
import {
  type BuildingStaffing,
  discoveryPending,
  rowPlan,
  STAFFING_BY_BUILDING_ID,
} from './staffing-rows.js';
import type { SeatSupply } from './supply.js';

/** The civilians from which a seat counts as grown (authored): its late bills are the largest and its
 *  sites the farthest apart. */
export const LATE_GAME_CIVILIANS = 60;

/** The storage and training plan before their carrier clocks: no carrier (authored). The builders
 *  fetch from the gatherers' piles themselves, and the supply governor counts those piles as the seat's
 *  stock, so a store carrier would only cost a civilian a craftsman could use. */
const EARLY_STORAGE_STAFFING: BuildingStaffing = {
  operatorMin: 0,
  operatorTarget: 0,
  carrierMin: 0,
  carrierTarget: 0,
  carrierSurplus: 0,
};

type CarrierTiers = Readonly<Record<'carrierMin' | 'carrierTarget' | 'carrierSurplus', number>>;

/** The transport carriers the HQ and every warehouse run from {@link STORE_CARRIERS_FROM_TICKS} (owner
 *  ruling): one each, from the surplus tier, after every workshop's crew. */
export const STORE_CARRIERS: CarrierTiers = { carrierMin: 0, carrierTarget: 0, carrierSurplus: 1 };

/** The transport carriers a training building runs from {@link TRAINING_CARRIERS_FROM_TICKS} (owner
 *  ruling): two at the target tier, bringing the arms the drill hands out. */
export const TRAINING_CARRIERS: CarrierTiers = { carrierMin: 0, carrierTarget: 2, carrierSurplus: 2 };

const LATE_STORAGE_STAFFING: BuildingStaffing = { ...EARLY_STORAGE_STAFFING, ...STORE_CARRIERS };
const LATE_TRAINING_STAFFING: BuildingStaffing = { ...EARLY_STORAGE_STAFFING, ...TRAINING_CARRIERS };

/** The storage plan at `tick`. */
function storageStaffing(tick: number): BuildingStaffing {
  return tick >= STORE_CARRIERS_FROM_TICKS ? LATE_STORAGE_STAFFING : EARLY_STORAGE_STAFFING;
}

/** The training building plan at `tick`. */
function trainingStaffing(tick: number): BuildingStaffing {
  return tick >= TRAINING_CARRIERS_FROM_TICKS ? LATE_TRAINING_STAFFING : EARLY_STORAGE_STAFFING;
}

/** The goods whose shortage puts a carrier into the workshop at the minimum tier (authored), by stable
 *  content ids: the building materials only these tiers make. The carrier is hired below a good's short
 *  line and kept until every one reaches its comfort line ({@link SeatSupply}). */
export const SUPPLY_CARRIER_GOODS_BY_BUILDING_ID: Readonly<Record<string, readonly string[]>> = {
  work_pottery_01: ['brick', 'tile'],
  work_mason_hut_01: ['pillar', 'ornament'],
};

/** Who a building employs this decision, the live lever state its plan's hysteresis reads. */
export interface HeldStaff {
  readonly operators: number;
  readonly carriers: number;
}

/** The seat-wide inputs every building's plan reads this decision. */
export interface SeatStaffing {
  readonly player: number;
  readonly owned: readonly Entity[];
  readonly supply: SeatSupply;
  readonly profile: ComputerProfile;
  /** The men pinned on the work earning a discovery (`technology/apprentices.ts`), never released. */
  readonly apprentices?: ReadonlySet<Entity>;
  /** Whether the seat's bread chain is open and unfinished (`../build-order/food-first.ts`). */
  readonly breadChainOpen?: boolean;
}

/**
 * One building's plan this decision, or null for the kinds the allocator never staffs: homes and towers.
 * A store runs the carriers of its {@link storageStaffing}, a training building those of its
 * {@link trainingStaffing}. A workshop on its opening run keeps to its first craftsman so the run
 * is not split; `held` is who works there already, which keeps a supply carrier or a product-gated
 * craftsman through the band below the line that hired him. A raw good's own workshop runs without a
 * carrier while that good is short for the sites ({@link rawGoodShort}), and a workshop with nothing left
 * to make runs with nobody early in the game, or later while its input runs short for the sites
 * ({@link productsRest}), whatever the rows above say. A livestock workplace employs nobody while the seat
 * keeps no pair of either species.
 */
export function buildingStaffing(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  building: Entity,
  type: BuildingType,
  held: HeldStaff,
): BuildingStaffing | null {
  if (type.kind === 'storage') return storageStaffing(ctx.tick);
  if (type.kind === 'training') return trainingStaffing(ctx.tick);
  if (type.kind !== 'workplace') return null;
  const { plan: row, gateFloor } = rowPlan(ctx, type);
  const authored = STAFFING_BY_BUILDING_ID[type.id];
  let plan =
    authored?.tunicSeat !== undefined && TUNIC_SIDES.some((side) => seatHasSide(world, seat.player, side))
      ? { ...row, ...authored.tunicSeat }
      : row;
  if (authored?.herdIndustry === true && seatHerdKept(world, ctx, seat.player) === 'none')
    return withoutCarriers(capOperators(plan, 0));
  const opening = openingRunPending(world, ctx, building, type);
  const gated = authored?.productGated === true ? gatedOperators(ctx, seat, type, held.operators) : null;
  const gate = gated === null ? null : Math.max(gated, gateFloor);
  if (opening || discoveryPending(world, ctx, seat.player, authored?.aloneUntil))
    plan = capOperators(plan, 1);
  else if (gate !== null) {
    const crafting = craftGlutPending(ctx, seat.supply, seat.profile, type, held.operators > gate);
    plan = capOperators(plan, gate, crafting ? Number.POSITIVE_INFINITY : gate);
  }
  const holdsCarrier = held.carriers > 0;
  if (
    suppliesShort(ctx, seat, type, holdsCarrier) ||
    discoveryPending(world, ctx, seat.player, authored?.porterUntil)
  ) {
    plan = {
      ...plan,
      carrierMin: Math.max(plan.carrierMin, 1),
      carrierTarget: Math.max(plan.carrierTarget, 1),
    };
  }
  if (rawGoodShort(ctx, seat, type, holdsCarrier)) plan = withoutCarriers(plan);
  if (breadSupplyPending(ctx, seat, type))
    plan = {
      ...plan,
      operatorMin: Math.max(plan.operatorMin, 1),
      operatorTarget: Math.max(plan.operatorTarget, 1),
    };
  else if (
    !opening &&
    !discoveryPending(world, ctx, seat.player, authored?.keptUntil) &&
    productsRest(world, ctx, seat, building, type, held.operators)
  )
    plan = withoutCarriers(capOperators(plan, 0));
  if (held.operators === 0 && hasCraftPost(ctx, type)) plan = withoutCarriers(plan);
  return plan;
}

/** Whether `type` is the bread chain's supplier while the seat's chain is unfinished and holds none of
 *  its products: its craftsman works whatever the products' supply lines say, so the bakery's pillar is
 *  made before its site waits on it (owner ruling: the bakery is built the moment it unlocks). */
function breadSupplyPending(ctx: SystemContext, seat: SeatStaffing, type: BuildingType): boolean {
  return (
    seat.breadChainOpen === true &&
    breadChainSupplier(ctx, type) &&
    productsOf(ctx, type).every((good) => seat.supply.units(good) <= 0)
  );
}

/**
 * Whether `type` has a craft post: a slot neither a transport carrier nor a flag gatherer holds. Owner
 * ruling: such a workshop posts no carrier while no craftsman works there, as one a map's papers
 * raise ahead of its trade, since they have nothing to do there without him; they follow him once he is in.
 * A carrier-only workplace (the well, the hive) has no craft post to wait on.
 */
function hasCraftPost(ctx: SystemContext, type: BuildingType): boolean {
  const index = contentIndex(ctx.content);
  return type.workers.some(
    (slot) => !isCarrierJob(ctx, slot.jobType) && !index.harvestJobs.has(slot.jobType),
  );
}

function withoutCarriers(plan: BuildingStaffing): BuildingStaffing {
  return { ...plan, carrierMin: 0, carrierTarget: 0, carrierSurplus: 0 };
}

function capOperators(plan: BuildingStaffing, cap: number, surplusCap = cap): BuildingStaffing {
  return {
    ...plan,
    operatorMin: Math.min(plan.operatorMin, cap),
    operatorTarget: Math.min(plan.operatorTarget, cap),
    operatorSurplus: Math.min(plan.operatorSurplus ?? plan.operatorTarget, surplusCap),
  };
}

/**
 * The operators a product-gated type may employ: one while none of its products is short, and while one
 * is, one more per supply unit the shortest lacks to its comfort line. One man or none reads the comfort
 * line; a crew of more reads the glut line and holds at least one man over the first until every product
 * reaches it, so the men hired stay with their trade. A crew already `held` beyond the hire count keeps one
 * man over it, so the stock crossing a unit step does not release a man for the next unit to re-hire. Null
 * for a type none of whose products has supply lines: its row stands as authored.
 */
function gatedOperators(
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  held: number,
): number | null {
  const engaged = held > 1;
  let managed = false;
  let extra = 0;
  for (const good of productsOf(ctx, type)) {
    const lines = seat.supply.lines(good);
    if (lines === undefined) continue;
    managed = true;
    if (!seat.supply.isUnder(good, engaged ? 'glut' : 'comfort')) continue;
    const lacking = Math.ceil(seat.supply.lackToComfort(good) / lines.unit);
    extra = Math.max(extra, engaged ? Math.max(1, lacking) : lacking);
  }
  if (!managed) return null;
  const hire = 1 + extra;
  return extra > 0 ? Math.max(hire, Math.min(held, hire + 1)) : hire;
}

/**
 * Whether a workshop has nothing worth making: it has no craft sink (the profile's craft plans) and sows
 * no fields, every product has supply lines, and each lies at its glut line, or, once its crew has gone,
 * none is short yet. A product without supply lines keeps the crew on, as does a type with no product at
 * all. A farm never rests, since a resting farm loses its sown fields. While a recipe input of the
 * workshop runs short for the sites ({@link inputsShortForSites}), at any clock, it rests once none of
 * its products is short, read at the comfort line while it works: the scarce good goes to the sites, not
 * to a shelf filling toward its glut. Otherwise, from {@link CORE_CREW_FROM_TICKS}, the first craftsman
 * stays to keep his experience.
 */
function productsRest(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  building: Entity,
  type: BuildingType,
  operators: number,
): boolean {
  if (seat.profile.craftPlans[type.id]?.sink !== undefined) return false;
  if (farmWorkGood(world, ctx, building) !== null) return false;
  const products = productsOf(ctx, type);
  if (products.length === 0 || products.some((good) => seat.supply.lines(good) === undefined)) return false;
  if (inputsShortForSites(ctx, seat, type, operators === 0))
    return products.every((good) => !seat.supply.isShort(good, operators > 0));
  if (ctx.tick >= CORE_CREW_FROM_TICKS) return false;
  return operators === 0
    ? products.every((good) => !seat.supply.isShort(good, false))
    : products.every((good) => seat.supply.atGlut(good));
}

/**
 * Whether a recipe input of `type` that the sites build with ({@link COLLECTED_GOOD_IDS}) runs short for
 * them: under its short line, or while the
 * workshop already rests (`resting`), under its comfort line, so the rest holds until the sites have
 * enough. Authored: on battle_for_the_four_hills_multiplayer (seed 7) a seat's mason turned the 2-8 stone
 * its sites waited for into 23-52 pillars nobody used.
 */
function inputsShortForSites(
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  resting: boolean,
): boolean {
  const inputs = contentIndex(ctx.content).mergedRecipeByBuilding.get(type.typeId)?.inputs ?? [];
  const siteGoods = siteGoodsOf(ctx.content);
  return inputs.some(
    (input) => siteGoods.has(input.goodType) && seat.supply.isShort(input.goodType, resting),
  );
}

/** The {@link COLLECTED_GOOD_IDS} the content has, by good type: content-static, so memoized. */
function siteGoodsOf(content: ContentSet): ReadonlySet<number> {
  let goods = siteGoodsByContent.get(content);
  if (goods === undefined) {
    const index = contentIndex(content);
    goods = new Set(COLLECTED_GOOD_IDS.flatMap((id) => index.goodTypeBySlug.get(id) ?? []));
    siteGoodsByContent.set(content, goods);
  }
  return goods;
}

const siteGoodsByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

/** Whether one of the type's supply goods is short: below its short line, or while a carrier already
 *  works there, below its comfort line. */
function suppliesShort(
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  holdsCarrier: boolean,
): boolean {
  const goodIds = SUPPLY_CARRIER_GOODS_BY_BUILDING_ID[type.id];
  if (goodIds === undefined) return false;
  return goodIds.some((id) => {
    const good = goodTypeByContentId(ctx.content, id);
    return good !== undefined && seat.supply.isShort(good.typeId, holdsCarrier);
  });
}

/**
 * Whether `type` is a collected raw good's own workshop ({@link COLLECTOR_WORKSHOP_BY_GOOD_ID}) while that
 * good runs short for the seat's sites: under its short line, or while no carrier works there, under its
 * comfort line. Its carrier only hauls the good onto the workshop's shelf, where the builders cannot take
 * it, so he goes back to the pool and the craftsman fetches his own until the good is plentiful again
 * (authored).
 */
function rawGoodShort(
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  holdsCarrier: boolean,
): boolean {
  for (const good of rawGoodsServedBy(ctx.content, type))
    if (seat.supply.isShort(good, !holdsCarrier)) return true;
  return false;
}

/** The collected goods, in {@link COLLECTED_GOOD_IDS} order, whose own workshop `type` is or upgrades
 *  from: content-static, so memoized per content and type id. */
function rawGoodsServedBy(content: ContentSet, type: BuildingType): readonly number[] {
  let byType = rawGoodsByContent.get(content);
  if (byType === undefined) {
    byType = new Map();
    rawGoodsByContent.set(content, byType);
  }
  let goods = byType.get(type.typeId);
  if (goods === undefined) {
    const index = contentIndex(content);
    const served: number[] = [];
    for (const id of COLLECTED_GOOD_IDS) {
      const collector = COLLECTOR_WORKSHOP_BY_GOOD_ID[id];
      const workshop =
        collector === undefined ? undefined : buildingTypeByContentId(content, collector.building);
      if (workshop === undefined || !tiersAtOrAbove(index, workshop).has(type.typeId)) continue;
      const good = goodTypeByContentId(content, id);
      if (good !== undefined) served.push(good.typeId);
    }
    goods = served;
    byType.set(type.typeId, goods);
  }
  return goods;
}

const rawGoodsByContent = new WeakMap<ContentSet, Map<number, readonly number[]>>();
