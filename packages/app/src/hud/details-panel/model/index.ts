import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, isPalisade, isSettler, isSignpost, isVehicle, num } from '../../../game/snapshot.js';
import { healthBar, pct } from './bars.js';
import { type BuildingPanelModel, buildingPanelModel } from './building.js';
import type { UnitPanelModelContext } from './context.js';
import { type SettlerPanelModel, settlerPanelModel } from './settler-panel.js';
import { type VehiclePanelModel, vehiclePanelModel } from './vehicle.js';

export { type BarTone, barTone, type PanelBar, remainingPct } from './bars.js';
export {
  type BuildingOfferModel,
  type BuildingOrdersModel,
  type BuildingPanelModel,
  type BuildingStaffModel,
  type BuildingStatusModel,
  type BuildingStatusTone,
  buildingPeersOf,
  type ConstructionModel,
  type ConstructionRow,
  type HomeQualityModel,
  type HomeQualityRow,
  type HouseholdEffect,
  type PersonLook,
  type ProductionModel,
  type ProductionRow,
  type StaffGroup,
  type StaffPerson,
  type StockRow,
  type UpgradeCostRow,
} from './building.js';
export {
  type DiplomacyStance,
  PRODUCTION_COUNT_MAX,
  PRODUCTION_UNLIMITED,
  SETTLER_NAME_MAX_CHARS,
  type SettlerWorkStatus,
  type UnitPanelModelContext,
} from './context.js';
export {
  EXPERIENCE_FOLDED_MAX,
  type ExperienceRowModel,
  experienceShown,
  type SettlerState,
} from './settler.js';
export {
  type EquipGroup,
  type EquipRow,
  type EquipSlotModel,
  type EquipSlotRef,
  equipmentRows,
} from './settler-equipment.js';
export type {
  SeatControl,
  SettlerFamilyModel,
  SettlerPersonLink,
  SettlerRole,
  SettlerSeatRow,
} from './settler-household.js';
export type {
  CarriedGoodModel,
  SettlerMilitaryModel,
  SettlerPanelModel,
  SettlerStatusModel,
} from './settler-panel.js';
export type { UnlockProgressRowModel } from './settler-unlocks.js';
export type { SettlerVehicleLink, SettlerVehicleRow } from './settler-vehicle.js';
export type { SettlerPlace, SettlerProductionModel, SettlerProductionRow } from './settler-work.js';
export {
  TRADE_LIMIT_MAX,
  TRADE_LIMIT_NONE,
  TRADE_ROUTE_HOUSES,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeDirection,
  type TradeOfferModel,
  type TradeOfferSide,
  type TradePanelModel,
  type TradeRouteStock,
  type TraderSubject,
  type TradeStockRow,
  type TradeStopModel,
  type TradeTransferModel,
} from './trade.js';
export {
  type RiderLook,
  type VehicleCargoGood,
  type VehicleCargoRow,
  type VehicleClass,
  type VehicleCrewModel,
  type VehicleDeckModel,
  type VehicleHoldModel,
  type VehicleOrder,
  type VehicleOrderModel,
  type VehiclePanelModel,
  type VehicleRiderModel,
  type VehicleStance,
  type VehicleStatusModel,
  type VehicleTradeModel,
  vehicleClassOf,
} from './vehicle.js';

export interface MultiSettlerPanelModel {
  readonly kind: 'multi-settler';
  readonly count: number;
}

export interface GenericSelectionPanelModel {
  readonly kind: 'generic';
  readonly count: number;
}

export interface EmptyPanelModel {
  readonly kind: 'empty';
}

/** A selected signpost: title (miscwindow 270 "Signpost") + the tear-down button (miscwindow 273). */
export interface SignpostPanelModel {
  readonly kind: 'signpost';
  readonly entityId: number;
}

export interface PalisadePanelModel {
  readonly kind: 'palisade';
  readonly entityId: number;
  readonly health: ReturnType<typeof healthBar>;
  readonly builtPct: number;
  readonly gateOpen: boolean | null;
  readonly underConstruction: boolean;
}

export type UnitPanelModel =
  | EmptyPanelModel
  | BuildingPanelModel
  | SettlerPanelModel
  | SignpostPanelModel
  | PalisadePanelModel
  | VehiclePanelModel
  | MultiSettlerPanelModel
  | GenericSelectionPanelModel;

export function buildUnitPanelModel(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
  ctx: UnitPanelModelContext,
): UnitPanelModel {
  if (selected.size === 0) return { kind: 'empty' };

  // Classifying goes through the snapshot's id index, so it costs O(selected · log entities) rather than
  // a walk over a decoded map's scenery. The sorts below, not the selection's iteration order, decide the
  // single-pick branches' winner.
  const settlerIds: number[] = [];
  const buildingIds: number[] = [];
  const signpostIds: number[] = [];
  const palisadeIds: number[] = [];
  const vehicleIds: number[] = [];
  for (const id of selected) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    if (isSettler(e)) settlerIds.push(e.id);
    else if (isBuilding(e)) buildingIds.push(e.id);
    else if (isSignpost(e)) signpostIds.push(e.id);
    else if (isPalisade(e)) palisadeIds.push(e.id);
    else if (isVehicle(e)) vehicleIds.push(e.id);
  }
  settlerIds.sort((a, b) => a - b);
  buildingIds.sort((a, b) => a - b);
  signpostIds.sort((a, b) => a - b);
  palisadeIds.sort((a, b) => a - b);

  if (
    settlerIds.length === 0 &&
    buildingIds.length === 0 &&
    signpostIds.length === 0 &&
    palisadeIds.length === 1
  ) {
    const entityId = palisadeIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const palisade = ent.components.Palisade as { built?: unknown; gate?: unknown } | undefined;
    const gate = palisade?.gate as { open?: unknown } | null | undefined;
    return {
      kind: 'palisade',
      entityId,
      health: healthBar(ent),
      builtPct: pct(num(palisade?.built)),
      gateOpen: gate === undefined || gate === null ? null : gate.open === true,
      underConstruction: ent.components.UnderConstruction !== undefined,
    };
  }
  vehicleIds.sort((a, b) => a - b);

  // A signpost is a direct-click-only selection (never marquee'd), so units/buildings always outrank
  // it. A vehicle's order window opens for it alone; settlers boxed with vehicles are a group.
  if (settlerIds.length === 0 && buildingIds.length === 0 && signpostIds.length === 1) {
    return { kind: 'signpost', entityId: signpostIds[0] as number };
  }
  if (settlerIds.length === 0 && buildingIds.length === 0 && vehicleIds.length === 1) {
    const ent = entityById(snapshot, vehicleIds[0] as number);
    return ent === undefined ? { kind: 'empty' } : vehiclePanelModel(ctx, snapshot, ent);
  }
  if (settlerIds.length > 0 && vehicleIds.length > 0) return { kind: 'generic', count: selected.size };

  if (settlerIds.length === 0 && buildingIds.length === 1) {
    const ent = entityById(snapshot, buildingIds[0] as number);
    return ent === undefined ? { kind: 'empty' } : buildingPanelModel(ctx, snapshot, ent);
  }

  if (settlerIds.length === 1) {
    const ent = entityById(snapshot, settlerIds[0] as number);
    return ent === undefined ? { kind: 'empty' } : settlerPanelModel(ctx, snapshot, ent);
  }

  if (settlerIds.length > 1) return { kind: 'multi-settler', count: settlerIds.length };
  return { kind: 'generic', count: selected.size };
}
