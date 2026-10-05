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
import { formatMessage, messages } from '../../../i18n/index.js';
import { healthBar, pct } from './bars.js';
import { type BuildingPanelModel, buildingPanelModel } from './building.js';
import { liveAmounts } from './building-materials.js';
import { goodLabel, type UnitPanelModelContext } from './context.js';
import { type GroupPanelModel, groupPanelModel } from './group.js';
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
  ALL_SCOPE,
  type GroupGear,
  type GroupGearItem,
  type GroupGearRow,
  type GroupKindIcon,
  type GroupMemberModel,
  type GroupMilitaryModel,
  type GroupPanelModel,
  type GroupScopeModel,
  type GroupSiegeModel,
  type GroupStance,
} from './group.js';
export {
  EXPERIENCE_FOLDED_MAX,
  type ExperienceRowModel,
  experienceShown,
  type SettlerState,
  settlerStateHold,
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
  SettlerWorkAreaRow,
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
  readonly gateMode: 'open' | 'closed' | 'automatic' | null;
  readonly foreign: boolean;
  readonly underConstruction: boolean;
  /** A road site shares the wall site's panel: a title, its {@link siteStatus} and the button that
   *  withdraws it. */
  readonly roadSite: boolean;
  /** Where a road site's paving stands: its stone wanted, delivered, or a builder coming for it. */
  readonly siteStatus: string | null;
}

export type UnitPanelModel =
  | EmptyPanelModel
  | BuildingPanelModel
  | SettlerPanelModel
  | SignpostPanelModel
  | PalisadePanelModel
  | VehiclePanelModel
  | GroupPanelModel;

/** The one entity of a list holding exactly one. */
function only(list: readonly SnapshotEntity[]): SnapshotEntity | undefined {
  return list.length === 1 ? list[0] : undefined;
}

function palisadePanelModel(ent: SnapshotEntity, ctx: UnitPanelModelContext): PalisadePanelModel {
  const palisade = ent.components.Palisade as { built?: unknown; gate?: unknown } | undefined;
  const gate = palisade?.gate as { open?: unknown } | null | undefined;
  return {
    kind: 'palisade',
    entityId: ent.id,
    health: healthBar(ent),
    builtPct: pct(num(palisade?.built)),
    gateMode:
      (ent.components.GateControl as { mode: 'open' | 'closed' | 'automatic' } | undefined)?.mode ??
      (gate == null ? null : gate.open ? 'open' : 'closed'),
    foreign: (ent.components.Owner as { player: number } | undefined)?.player !== ctx.viewer?.seat(),
    gateOpen: gate === undefined || gate === null ? null : gate.open === true,
    underConstruction: ent.components.UnderConstruction !== undefined,
    roadSite: false,
    siteStatus: null,
  };
}

/** The bill's goods on site, else a builder that claimed the site, else the first good still wanted. */
function roadSiteStatus(ctx: UnitPanelModelContext, ent: SnapshotEntity): string | null {
  const copy = messages().hud;
  const site = ent.components.RoadSite as { construction?: unknown; reservation?: unknown } | undefined;
  const bill = Array.isArray(site?.construction) ? site.construction : [];
  const held = liveAmounts(ent.components.Stockpile);
  const goods: { goodType: number; have: number; need: number }[] = [];
  for (const entry of bill) {
    const goodType = num((entry as { goodType?: unknown }).goodType);
    const need = num((entry as { amount?: unknown }).amount);
    if (goodType !== undefined && need !== undefined)
      goods.push({ goodType, have: held.get(goodType) ?? 0, need });
  }
  const first = goods.find((good) => good.have < good.need);
  if (first === undefined) {
    const paved = goods[0];
    return paved === undefined
      ? null
      : formatMessage(copy.roadSiteSupplied, { good: goodLabel(ctx, paved.goodType) });
  }
  if (site?.reservation !== undefined && site.reservation !== null) return copy.roadSiteBuilderComing;
  return formatMessage(copy.roadSiteNeeds, {
    good: goodLabel(ctx, first.goodType),
    have: first.have,
    need: first.need,
  });
}

function roadSitePanelModel(ctx: UnitPanelModelContext, ent: SnapshotEntity): PalisadePanelModel {
  return {
    kind: 'palisade',
    entityId: ent.id,
    health: null,
    builtPct: 0,
    gateOpen: null,
    gateMode: null,
    foreign: false,
    underConstruction: true,
    roadSite: true,
    siteStatus: roadSiteStatus(ctx, ent),
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

  if (noUnitOrHouse && signposts.length === 0 && palisade !== undefined)
    return palisadePanelModel(palisade, ctx);
  const roadSite = only(roadSites);
  if (noUnitOrHouse && signposts.length === 0 && palisades.length === 0 && roadSite !== undefined) {
    return roadSitePanelModel(ctx, roadSite);
  }
  // A signpost is a direct-click-only selection (never marquee'd), so units/buildings always outrank
  // it. A vehicle's order window opens for it alone; settlers boxed with vehicles are a group.
  if (noUnitOrHouse && signpost !== undefined) return { kind: 'signpost', entityId: signpost.id };
  if (noUnitOrHouse && vehicle !== undefined) return vehiclePanelModel(ctx, snapshot, vehicle);
  if (settlers.length === 0 && building !== undefined) return buildingPanelModel(ctx, snapshot, building);
  if (settlers.length + vehicles.length > 1)
    return groupPanelModel(ctx, snapshot, [...settlers, ...vehicles]);
  if (settler !== undefined) return settlerPanelModel(ctx, snapshot, settler);
  return { kind: 'empty' };
}
