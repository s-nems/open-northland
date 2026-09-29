import { entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  isBuilding,
  isPalisade,
  isRoadSite,
  isSettler,
  isSignpost,
  isVehicle,
  num,
  type SnapshotEntity,
} from '../../../game/snapshot.js';
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
  /** A road site shares the wall site's panel: a title and the button that withdraws it. */
  readonly roadSite: boolean;
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

/** The one entity of a list holding exactly one. */
function only(list: readonly SnapshotEntity[]): SnapshotEntity | undefined {
  return list.length === 1 ? list[0] : undefined;
}

function palisadePanelModel(ent: SnapshotEntity): PalisadePanelModel {
  const palisade = ent.components.Palisade as { built?: unknown; gate?: unknown } | undefined;
  const gate = palisade?.gate as { open?: unknown } | null | undefined;
  return {
    kind: 'palisade',
    entityId: ent.id,
    health: healthBar(ent),
    builtPct: pct(num(palisade?.built)),
    gateOpen: gate === undefined || gate === null ? null : gate.open === true,
    underConstruction: ent.components.UnderConstruction !== undefined,
    roadSite: false,
  };
}

function roadSitePanelModel(ent: SnapshotEntity): PalisadePanelModel {
  return {
    kind: 'palisade',
    entityId: ent.id,
    health: null,
    builtPct: 0,
    gateOpen: null,
    underConstruction: true,
    roadSite: true,
  };
}

export function buildUnitPanelModel(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
  ctx: UnitPanelModelContext,
): UnitPanelModel {
  if (selected.size === 0) return { kind: 'empty' };

  // Classifying goes through the snapshot's id index, so it costs O(selected · log entities) rather than
  // a walk over a decoded map's scenery. A single-entity panel opens only when its kind holds exactly one.
  const settlers: SnapshotEntity[] = [];
  const buildings: SnapshotEntity[] = [];
  const signposts: SnapshotEntity[] = [];
  const palisades: SnapshotEntity[] = [];
  const roadSites: SnapshotEntity[] = [];
  const vehicles: SnapshotEntity[] = [];
  for (const id of selected) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    if (isSettler(e)) settlers.push(e);
    else if (isBuilding(e)) buildings.push(e);
    else if (isSignpost(e)) signposts.push(e);
    else if (isPalisade(e)) palisades.push(e);
    else if (isRoadSite(e)) roadSites.push(e);
    else if (isVehicle(e)) vehicles.push(e);
  }
  const settler = only(settlers);
  const building = only(buildings);
  const signpost = only(signposts);
  const palisade = only(palisades);
  const vehicle = only(vehicles);
  const noUnitOrHouse = settlers.length === 0 && buildings.length === 0;

  if (noUnitOrHouse && signposts.length === 0 && palisade !== undefined) return palisadePanelModel(palisade);
  const roadSite = only(roadSites);
  if (noUnitOrHouse && signposts.length === 0 && palisades.length === 0 && roadSite !== undefined) {
    return roadSitePanelModel(roadSite);
  }
  // A signpost is a direct-click-only selection (never marquee'd), so units/buildings always outrank
  // it. A vehicle's order window opens for it alone; settlers boxed with vehicles are a group.
  if (noUnitOrHouse && signpost !== undefined) return { kind: 'signpost', entityId: signpost.id };
  if (noUnitOrHouse && vehicle !== undefined) return vehiclePanelModel(ctx, snapshot, vehicle);
  if (settlers.length > 0 && vehicles.length > 0) return { kind: 'generic', count: selected.size };
  if (settlers.length === 0 && building !== undefined) return buildingPanelModel(ctx, snapshot, building);
  if (settler !== undefined) return settlerPanelModel(ctx, snapshot, settler);
  if (settlers.length > 1) return { kind: 'multi-settler', count: settlers.length };
  return { kind: 'generic', count: selected.size };
}
