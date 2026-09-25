import type { BuildingType } from '@open-northland/data';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { FetchableStock } from '../../settlers/targets/index.js';
import { sitesShortfall } from '../build-order/upgrade-supply.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { openingRunPending } from './craft.js';

/** A building's staffing plan: workers per operator trade and total transport carriers, filled tier by
 *  tier so everyone's minimum beats anyone's second worker. Slot counts cap every value. */
export interface BuildingStaffing {
  readonly operatorMin: number;
  readonly operatorTarget: number;
  /** Operators filled only by the `surplus` pass. Absent: the target count is final. */
  readonly operatorSurplus?: number;
  readonly carrierMin: number;
  readonly carrierTarget: number;
  /** The carrier target of a grown seat ({@link LATE_GAME_CIVILIANS} civilians on). Absent: unchanged. */
  readonly grownCarrierTarget?: number;
}

/** The baseline workplace plan: one worker per operator trade, no carrier (authored). */
const DEFAULT_WORKPLACE_STAFFING: BuildingStaffing = {
  operatorMin: 1,
  operatorTarget: 1,
  carrierMin: 0,
  carrierTarget: 0,
};

/** Per-building overrides of {@link DEFAULT_WORKPLACE_STAFFING}, by stable content id (authored),
 *  applied per building instance. A second hand is a target-tier extra unless its row says otherwise,
 *  so a farm knowingly runs on one farmer until men are actually spare. */
export const STAFFING_BY_BUILDING_ID: Readonly<Record<string, Partial<BuildingStaffing>>> = {
  // A lone farmer cannot walk the watering circuit in time, so the second hand is worth more than its
  // own output; the third and fourth only pay off out of genuine surplus.
  work_farm_00: { operatorTarget: 2, operatorSurplus: 4 },
  // Surplus-only: one farm grows roughly what one miller grinds, so the second seat is worth filling
  // only once the farm's own extra hands have outgrown him.
  work_mill_00: { operatorSurplus: 2 },
  work_brewery: { operatorTarget: 2, carrierTarget: 1 },
  // Both breeders keep the cattle (CRAFT_PLANS_BY_BUILDING_ID), so the pair doubles the one herd's
  // output from the start.
  work_animal_farm: { operatorMin: 2, operatorTarget: 2 },
  // The level-0 bakery offers a single baker slot, so only its carrier is planned.
  work_bakery_00: { carrierMin: 1, carrierTarget: 1 },
  work_bakery_01: { operatorTarget: 2, carrierMin: 1, carrierTarget: 1 },
  work_joinery_01: { operatorTarget: 2 },
  // The first potter and mason work alone, so a carrier hauls for them. The upgraded tiers keep one only
  // while their goods run short (SUPPLY_CARRIER_GOODS_BY_BUILDING_ID). The pottery's second potter is a
  // minimum post, ahead of the builder reserve, but only once the opening run is done.
  work_pottery_00: { carrierMin: 1, carrierTarget: 1 },
  work_mason_hut_00: { carrierMin: 1, carrierTarget: 1 },
  work_pottery_01: { operatorMin: 2, operatorTarget: 2 },
  work_sewery_01: { operatorTarget: 2 },
  work_smithy_01: { operatorTarget: 2, carrierTarget: 1 },
  work_armory_01: { operatorTarget: 2, carrierTarget: 1 },
  // One herbalist keeps the druids in herbs; a second is worth a man only out of surplus.
  work_herb_hut: { operatorSurplus: 2 },
  work_druid_01: { operatorTarget: 2, carrierTarget: 1 },
  work_coin_mint: { operatorTarget: 2, carrierTarget: 1 },
  // The brewery's water and honey: self-served early, a drawer of their own once the seat has grown.
  work_well_00: { grownCarrierTarget: 1 },
  work_hive_00: { grownCarrierTarget: 1 },
};

/** The storage plan: the HQ and every warehouse run up to three transport carriers, all at the target
 *  tier (authored), so a warehouse post never comes ahead of workplace staffing or the builder
 *  reserve. */
const STORAGE_STAFFING: BuildingStaffing = {
  operatorMin: 0,
  operatorTarget: 0,
  carrierMin: 0,
  carrierTarget: 3,
};

/** The civilians from which a seat counts as grown (authored): its late bills are the largest and its
 *  sites the farthest apart. */
export const LATE_GAME_CIVILIANS = 60;

/** How far below {@link LATE_GAME_CIVILIANS} a grown seat's carrier keeps his post (authored), so a seat
 *  hovering at the line does not hire and release him with every birth and draft. */
export const GROWN_CARRIER_SLACK_CIVILIANS = 10;

/** The goods whose shortage puts a carrier into the workshop at the minimum tier (authored), by stable
 *  content ids: the building materials only these tiers make. */
export const SUPPLY_CARRIER_GOODS_BY_BUILDING_ID: Readonly<Record<string, readonly string[]>> = {
  work_pottery_01: ['brick', 'tile'],
  work_mason_hut_01: ['pillar', 'ornament'],
};

/** A supply carrier is hired while any of its goods has fewer fetchable units than this beyond what the
 *  seat's sites still lack, and kept until every one has {@link SUPPLY_COMFORT_UNITS} (authored: a home
 *  upgrade takes two, so three homes' round takes six). */
export const SUPPLY_SHORT_UNITS = 6;
export const SUPPLY_COMFORT_UNITS = 16;

/** The seat-wide inputs every building's plan reads this decision. */
export interface SeatStaffing {
  readonly player: number;
  readonly owned: readonly Entity[];
  readonly civilians: number;
}

/**
 * One building's plan this decision, or null for the kinds the allocator never staffs: homes, towers and
 * the barracks are military or residential, not production. A workshop on its opening run keeps to its
 * first craftsman so the run is not split; `holdsCarrier` says whether a carrier works there already,
 * which keeps a supply or grown-seat carrier through the band below the line that hired him.
 */
export function buildingStaffing(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  building: Entity,
  type: BuildingType,
  holdsCarrier: boolean,
): BuildingStaffing | null {
  if (type.kind === 'storage') return STORAGE_STAFFING;
  if (type.kind !== 'workplace') return null;
  let plan: BuildingStaffing = { ...DEFAULT_WORKPLACE_STAFFING, ...STAFFING_BY_BUILDING_ID[type.id] };
  if (openingRunPending(world, ctx, building, type)) {
    plan = {
      ...plan,
      operatorMin: Math.min(plan.operatorMin, 1),
      operatorTarget: Math.min(plan.operatorTarget, 1),
      operatorSurplus: Math.min(plan.operatorSurplus ?? plan.operatorTarget, 1),
    };
  }
  const grown = holdsCarrier ? LATE_GAME_CIVILIANS - GROWN_CARRIER_SLACK_CIVILIANS : LATE_GAME_CIVILIANS;
  if (plan.grownCarrierTarget !== undefined && seat.civilians >= grown) {
    plan = { ...plan, carrierTarget: Math.max(plan.carrierTarget, plan.grownCarrierTarget) };
  }
  if (suppliesShort(world, ctx, seat, type, holdsCarrier)) {
    plan = {
      ...plan,
      carrierMin: Math.max(plan.carrierMin, 1),
      carrierTarget: Math.max(plan.carrierTarget, 1),
    };
  }
  return plan;
}

/** Whether one of the type's supply goods is short: below {@link SUPPLY_SHORT_UNITS} spare units, or while
 *  a carrier already works there, below {@link SUPPLY_COMFORT_UNITS}. */
function suppliesShort(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  type: BuildingType,
  holdsCarrier: boolean,
): boolean {
  const goodIds = SUPPLY_CARRIER_GOODS_BY_BUILDING_ID[type.id];
  if (goodIds === undefined) return false;
  const stock = FetchableStock.of(world, ctx);
  const wanted = holdsCarrier ? SUPPLY_COMFORT_UNITS : SUPPLY_SHORT_UNITS;
  return goodIds.some((id) => {
    const good = goodTypeByContentId(ctx.content, id);
    if (good === undefined) return false;
    const owed = sitesShortfall(world, ctx, seat.owned, good.typeId);
    return !stock.exceeds(seat.player, good.typeId, owed + wanted - 1);
  });
}
