import type { BuildingType } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { buildingTypeByContentId, goodTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { COLLECTED_GOOD_IDS, COLLECTOR_WORKSHOP_BY_GOOD_ID } from './collectors/index.js';
import { CRAFT_PLANS_BY_BUILDING_ID, openingRunPending, productsOf } from './craft.js';
import type { SeatSupply } from './supply.js';

/** A building's staffing plan: workers per operator trade and total transport carriers, filled tier by
 *  tier so everyone's minimum beats anyone's second worker. Slot counts cap every value. */
export interface BuildingStaffing {
  readonly operatorMin: number;
  readonly operatorTarget: number;
  /** Operators filled only by the `surplus` pass. Absent: the target count is final. */
  readonly operatorSurplus?: number;
  readonly carrierMin: number;
  readonly carrierTarget: number;
  /** Carriers filled only by the `surplus` pass, and the count a release keeps. Absent: the target count
   *  is final. */
  readonly carrierSurplus?: number;
}

/** The baseline workplace plan: one worker per operator trade, no carrier (authored). */
const DEFAULT_WORKPLACE_STAFFING: BuildingStaffing = {
  operatorMin: 1,
  operatorTarget: 1,
  carrierMin: 0,
  carrierTarget: 0,
};

/** One {@link STAFFING_BY_BUILDING_ID} row. */
export interface StaffingRow extends Partial<BuildingStaffing> {
  /** Operators beyond the first are posts only while one of the type's products is short: under its
   *  comfort line while more than one works there, under its short line otherwise ({@link SeatSupply}).
   *  A short product allows one operator more per supply unit it lacks to its comfort line, within the
   *  row's own tiers ({@link gatedOperators}). */
  readonly productGated?: true;
}

/** Per-building overrides of {@link DEFAULT_WORKPLACE_STAFFING}, by stable content id (authored),
 *  applied per building instance. A second hand is a target-tier extra unless its row says otherwise,
 *  so a farm knowingly runs on one farmer until men are actually spare. */
export const STAFFING_BY_BUILDING_ID: Readonly<Record<string, StaffingRow>> = {
  // One farmer while the grain keeps up. Short of it, one more per unit it lacks: a lone farmer cannot walk
  // the watering circuit in time, so the second hand comes at the target tier, and the third and fourth,
  // which only pay off out of genuine surplus, from the surplus tier. The crew rests at the grain's glut.
  work_farm_00: { operatorTarget: 2, operatorSurplus: 4, productGated: true },
  // One miller while the flour keeps up; one farm grows roughly what one miller grinds, so the second seat
  // is worth filling only out of surplus and only while the flour runs short. The crew rests at the
  // flour's glut.
  work_mill_00: { operatorSurplus: 2, productGated: true },
  work_brewery: { operatorTarget: 2, carrierTarget: 1 },
  // Both breeders keep the cattle (CRAFT_PLANS_BY_BUILDING_ID), so the pair doubles the one herd's
  // output from the start.
  work_animal_farm: { operatorMin: 2, operatorTarget: 2 },
  // The level-0 bakery offers a single baker slot, so only its carrier is planned.
  work_bakery_00: { carrierMin: 1, carrierTarget: 1 },
  work_bakery_01: { operatorTarget: 2, carrierMin: 1, carrierTarget: 1 },
  work_joinery_01: { operatorTarget: 2 },
  // The first potter and mason work alone, so a carrier hauls for them. The upgraded tiers keep one only
  // while their goods run short (SUPPLY_CARRIER_GOODS_BY_BUILDING_ID), and a second craftsman likewise.
  // The pottery's second potter is a minimum post, ahead of the builder reserve, once the opening run is
  // done.
  work_pottery_00: { carrierMin: 1, carrierTarget: 1 },
  work_mason_hut_00: { carrierMin: 1, carrierTarget: 1 },
  work_pottery_01: { operatorMin: 2, operatorTarget: 2, productGated: true },
  work_mason_hut_01: { operatorTarget: 2, productGated: true },
  work_sewery_01: { operatorTarget: 2 },
  work_smithy_01: { operatorTarget: 2, carrierTarget: 1 },
  work_armory_01: { operatorTarget: 2, carrierTarget: 1 },
  // One herbalist keeps the druids in herbs; a second is worth a man only out of surplus.
  work_herb_hut: { operatorSurplus: 2 },
  work_druid_01: { operatorTarget: 2, carrierTarget: 1 },
  work_coin_mint: { operatorTarget: 2, carrierTarget: 1 },
  // The well and the hive stay unstaffed: the brewery's carrier draws its water and honey himself.
};

/** The civilians from which a seat counts as grown (authored): its late bills are the largest and its
 *  sites the farthest apart. */
export const LATE_GAME_CIVILIANS = 60;

/** The transport carriers the HQ and every warehouse run in a grown seat (authored). */
export const STORE_CARRIERS = 3;

/** The storage plan of a seat below {@link LATE_GAME_CIVILIANS} civilians: no carrier. A store carrier is
 *  a luxury that costs a civilian, and a seat has men to spare for one only once it is grown. */
const SMALL_SEAT_STORAGE_STAFFING: BuildingStaffing = {
  operatorMin: 0,
  operatorTarget: 0,
  carrierMin: 0,
  carrierTarget: 0,
  carrierSurplus: 0,
};

/** The storage plan of a grown seat: {@link STORE_CARRIERS} carriers, all at the surplus tier, so a store
 *  post never comes ahead of workplace staffing or the builder reserve. */
const GROWN_SEAT_STORAGE_STAFFING: BuildingStaffing = {
  ...SMALL_SEAT_STORAGE_STAFFING,
  carrierSurplus: STORE_CARRIERS,
};

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
  readonly civilians: number;
  readonly supply: SeatSupply;
}

/** The operators a workplace type's plan staffs at the target tier, each operator trade capped by its
 *  slot count; 0 for any other kind. */
export function plannedOperators(ctx: SystemContext, type: BuildingType): number {
  if (type.kind !== 'workplace') return 0;
  const want = { ...DEFAULT_WORKPLACE_STAFFING, ...STAFFING_BY_BUILDING_ID[type.id] }.operatorTarget;
  const index = contentIndex(ctx.content);
  let operators = 0;
  for (const slot of type.workers) {
    if (isCarrierJob(ctx, slot.jobType) || index.harvestJobs.has(slot.jobType)) continue;
    operators += Math.min(slot.count, want);
  }
  return operators;
}

/**
 * One building's plan this decision, or null for the kinds the allocator never staffs: homes, towers and
 * the barracks are military or residential, not production. A workshop on its opening run keeps to its
 * first craftsman so the run is not split; `held` is who works there already, which keeps a supply carrier
 * or a product-gated craftsman through the band below the line that hired him. A raw good's own workshop
 * runs without a carrier while that good is short for the sites ({@link rawGoodShort}), and a workshop
 * with nothing left to make runs with nobody ({@link productsRest}), whatever the rows above say.
 */
export function buildingStaffing(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  building: Entity,
  type: BuildingType,
  held: HeldStaff,
): BuildingStaffing | null {
  if (type.kind === 'storage') {
    return seat.civilians >= LATE_GAME_CIVILIANS ? GROWN_SEAT_STORAGE_STAFFING : SMALL_SEAT_STORAGE_STAFFING;
  }
  if (type.kind !== 'workplace') return null;
  const { productGated, ...row } = STAFFING_BY_BUILDING_ID[type.id] ?? {};
  let plan: BuildingStaffing = { ...DEFAULT_WORKPLACE_STAFFING, ...row };
  const opening = openingRunPending(world, ctx, building, type);
  const gate = productGated === true ? gatedOperators(ctx, seat, type, held.operators > 1) : null;
  if (opening) plan = capOperators(plan, 1);
  else if (gate !== null) plan = capOperators(plan, gate);
  const holdsCarrier = held.carriers > 0;
  if (suppliesShort(ctx, seat, type, holdsCarrier)) {
    plan = {
      ...plan,
      carrierMin: Math.max(plan.carrierMin, 1),
      carrierTarget: Math.max(plan.carrierTarget, 1),
    };
  }
  if (rawGoodShort(ctx, seat, type, holdsCarrier)) plan = withoutCarriers(plan);
  if (!opening && productsRest(ctx, seat, type, held.operators))
    plan = withoutCarriers(capOperators(plan, 0));
  return plan;
}

function withoutCarriers(plan: BuildingStaffing): BuildingStaffing {
  return { ...plan, carrierMin: 0, carrierTarget: 0, carrierSurplus: 0 };
}

function capOperators(plan: BuildingStaffing, cap: number): BuildingStaffing {
  return {
    ...plan,
    operatorMin: Math.min(plan.operatorMin, cap),
    operatorTarget: Math.min(plan.operatorTarget, cap),
    operatorSurplus: Math.min(plan.operatorSurplus ?? plan.operatorTarget, cap),
  };
}

/**
 * The operators a product-gated type may employ: one while none of its products is short (under its comfort
 * line while `engaged`, else its short line), and while one is, one more per supply unit the shortest lacks
 * to its comfort line. Null for a type none of whose products has supply lines: its row stands as authored.
 */
function gatedOperators(
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  engaged: boolean,
): number | null {
  let managed = false;
  let extra = 0;
  for (const good of productsOf(ctx, type)) {
    const lines = seat.supply.lines(good);
    if (lines === undefined) continue;
    managed = true;
    if (seat.supply.isShort(good, engaged)) {
      extra = Math.max(extra, Math.ceil(seat.supply.lackToComfort(good) / lines.unit));
    }
  }
  return managed ? 1 + extra : null;
}

/**
 * Whether a workshop with no craft sink ({@link CRAFT_PLANS_BY_BUILDING_ID}) has nothing worth making:
 * every product has supply lines and lies at its glut line, or, once its crew has gone, none is short
 * yet. A product without supply lines keeps the crew on, as does a type with no product at all.
 */
function productsRest(
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  operators: number,
): boolean {
  if (CRAFT_PLANS_BY_BUILDING_ID[type.id]?.sink !== undefined) return false;
  const products = productsOf(ctx, type);
  if (products.length === 0 || products.some((good) => seat.supply.lines(good) === undefined)) return false;
  return operators === 0
    ? products.every((good) => !seat.supply.isShort(good, false))
    : products.every((good) => seat.supply.atGlut(good));
}

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
  const index = contentIndex(ctx.content);
  return COLLECTED_GOOD_IDS.some((id) => {
    const served = COLLECTOR_WORKSHOP_BY_GOOD_ID[id];
    const workshop = served === undefined ? undefined : buildingTypeByContentId(ctx.content, served.building);
    if (workshop === undefined || !tiersAtOrAbove(index, workshop).has(type.typeId)) return false;
    const good = goodTypeByContentId(ctx.content, id);
    return good !== undefined && seat.supply.isShort(good.typeId, !holdsCarrier);
  });
}
