import {
  entityById,
  homeQualityView,
  householdGoodPolicyView,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { vikingBuildingByTypeId } from '../../../catalog/buildings.js';
import { JOB_IDLE } from '../../../catalog/jobs.js';
import {
  familiesByHome,
  isBuilding,
  isFemale,
  isPalisade,
  isSettler,
  isSignpost,
  isVehicle,
  needsRuleEnabled,
  num,
  ownerPlayerOf,
  progressionGatesSettler,
  residenceHomeOf,
  shelterClaimCount,
  stanceModeOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { healthBar, pct } from './bars.js';
import {
  type BuildingPanelModel,
  constructionModel,
  defenseLine,
  productionModel,
  stockRows,
  upgradeCostRows,
  workerSlotsFor,
} from './building.js';
import {
  buildingDef,
  buildingTitle,
  type Comp,
  goodLabel,
  jobDisplayName,
  type UnitPanelModelContext,
} from './context.js';
import {
  experienceRows,
  type SettlerPanelModel,
  satisfactionBars,
  settlerStatus,
  stanceLabel,
} from './settler.js';
import { equipmentRows } from './settler-equipment.js';
import { settlerDisplayName } from './settler-name.js';
import { unlockProgressRows } from './settler-unlocks.js';
import { settlerWork } from './settler-work.js';
import { tradeOfferLabel, tradePanelModel } from './trade.js';
import { type VehiclePanelModel, vehiclePanelModel } from './vehicle.js';

export { type BarTone, barTone, type PanelBar, remainingPct } from './bars.js';
export type {
  BuildingPanelModel,
  ConstructionModel,
  ConstructionRow,
  HomeQualityRow,
  HomeResidentsModel,
  ProductionModel,
  StockRow,
  UpgradeCostRow,
  WorkerSlotRow,
} from './building.js';
export type { UnitPanelModelContext } from './context.js';
export { HUMANWINDOW } from './humanwindow.js';
export type { SettlerPanelModel } from './settler.js';
export { type EquipGroup, type EquipRow, type EquipSlotModel, equipmentRows } from './settler-equipment.js';
export type { UnlockProgressRowModel } from './settler-unlocks.js';
export type { TradeImportModel, TradeOfferModel, TradePanelModel, TradeStopModel } from './trade.js';
export {
  VEHICLE_ORDER_STRING,
  VEHICLEWINDOW,
  type VehicleCargoRow,
  type VehicleCrewRow,
  type VehicleOrder,
  type VehicleOrderModel,
  type VehiclePanelModel,
  type VehicleTradeModel,
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

/** The content's own name for a tribe the locale catalogs do not translate, so a selected animal reads as
 *  its species rather than a bare id. */
function contentTribeName(ctx: UnitPanelModelContext, tribe: number | undefined): string | undefined {
  if (tribe === undefined) return undefined;
  const row = ctx.tribes.find((t) => t.typeId === tribe);
  return row?.name ?? row?.id;
}

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
    const entityId = buildingIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const b = (ent.components.Building ?? {}) as Comp;
    const rawType = num(b.buildingType);
    const typeId = rawType ?? -1;
    const def = buildingDef(ctx, rawType);
    const catalog = rawType === undefined ? undefined : vikingBuildingByTypeId(rawType);
    const category = def?.kind ?? catalog?.kind ?? 'unknown';
    // Computed once, so the Upgrade button's presence and its cost-preview tooltip cannot disagree.
    const upgradable =
      def?.upgradeTarget !== undefined &&
      ent.components.UnderConstruction === undefined &&
      pct(num(b.built)) >= 100;
    // `shelterCapacity` is also the gate the sim's `setDefenceMode` reads, so the panel can never offer
    // an order the sim refuses. Neither side gates on ownership: an enemy garrison offers its alarm too.
    const shelterCapacity = def?.shelterCapacity ?? 0;
    const defenseEnabled = ent.components.DefenceMode !== undefined;
    const sheltered = shelterClaimCount(snapshot, entityId);
    const level = num(b.level) ?? 0;
    const finished = ent.components.UnderConstruction === undefined && pct(num(b.built)) >= 100;
    const pools = homeQualityView(snapshot, entityId) ?? { cooking: 0, rest: 0, piety: 0 };
    const ownerPlayer = ownerPlayerOf(ent);
    const policy = householdGoodPolicyView(snapshot, ownerPlayer ?? -1);
    const effectOrder = { cooking: 0, rest: 1, piety: 2 } as const;
    const homeQuality =
      def?.kind === 'home' && finished
        ? ctx.goods
            .flatMap((good) => {
              const use = good.homeQuality;
              if (use === undefined || level < use.minimumHomeLevel) return [];
              const value = pools[use.effect];
              return [
                {
                  effect: use.effect,
                  goodId: good.id,
                  label: goodLabel(ctx, good.typeId),
                  value,
                  capacity: use.capacity,
                  allowed: policy[use.effect],
                  ...(use.effect === 'piety'
                    ? { holyFireActive: value > 0 && policy.piety }
                    : { uses: Math.floor(value / use.useCost) }),
                },
              ];
            })
            .sort((a, b) => effectOrder[a.effect] - effectOrder[b.effect])
        : [];
    return {
      kind: 'building',
      entityId,
      typeId,
      title: buildingTitle(ctx, rawType),
      category,
      owner: `#${ownerPlayerOf(ent) ?? '-'}`,
      ownerPlayer,
      canSetHouseholdGoodPolicy: ownerPlayer !== undefined && ownerPlayer === ctx.viewer?.seat(),
      tribe: tribeName(num(b.tribe), contentTribeName(ctx, num(b.tribe))),
      tribeId: num(b.tribe),
      level,
      builtPct: pct(num(b.built)),
      health: healthBar(ent),
      stock: stockRows(ctx, def, ent.components.Stockpile, ent.components.ProductionBonus),
      workerSlots: workerSlotsFor(ctx, snapshot, def, entityId),
      home:
        def?.kind === 'home'
          ? {
              families: (familiesByHome(snapshot).get(entityId) ?? []).map((f) => ({
                members: [
                  ...f.members.slice(0, f.adults).sort((a, b) => {
                    const left = entityById(snapshot, a);
                    const right = entityById(snapshot, b);
                    return (
                      Number(left !== undefined && isFemale(left)) -
                      Number(right !== undefined && isFemale(right))
                    );
                  }),
                  ...f.members.slice(f.adults),
                ],
              })),
              capacity: def.homeSize,
            }
          : null,
      homeQuality,
      showDefense: shelterCapacity > 0,
      defenseEnabled,
      garrison: sheltered > 0 ? { sheltered, capacity: shelterCapacity } : null,
      defenseLabel: defenseLine(
        snapshot,
        def,
        entityId,
        defenseEnabled ? { sheltered, capacity: shelterCapacity } : null,
      ),
      production: productionModel(ctx, snapshot, def, ent),
      construction: constructionModel(ctx, snapshot, def, ent),
      upgradable,
      cancelable: ent.components.Upgrading !== undefined,
      upgradeBlockedReason:
        def?.upgradeTarget === undefined
          ? null
          : (ctx.technologyReason?.('house', def.upgradeTarget, num(b.tribe) ?? 0, ownerPlayerOf(ent)) ??
            null),
      upgradeCost: upgradable ? upgradeCostRows(ctx, def) : [],
      tradeOffers: (ctx.tradeOffersAt?.(entityId) ?? []).map((offer) => tradeOfferLabel(ctx, offer)),
    };
  }

  if (settlerIds.length === 1) {
    const entityId = settlerIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const comps = ent.components as Comp;
    const s = (ent.components.Settler ?? {}) as Comp;
    const stanceMode = stanceModeOf(ent);
    const stanceSuffix =
      stanceMode !== undefined
        ? formatMessage(messages().hud.stance, { stance: stanceLabel(stanceMode) })
        : '';
    const meta = formatMessage(messages().hud.playerTribe, {
      player: ownerPlayerOf(ent) ?? '-',
      tribe: tribeName(num(s.tribe), contentTribeName(ctx, num(s.tribe))),
      stance: stanceSuffix,
    });
    const young = comps.Age !== undefined;
    const progressionGated = progressionGatesSettler(snapshot, ent);
    // `Age` is the sim's marker for a settler still growing up, dropped at adulthood, so this reads out
    // whole years below the adult age.
    const ageTicks = num((comps.Age as { ticks?: unknown } | undefined)?.ticks);
    const ageSuffix =
      young && ageTicks !== undefined
        ? ` · ${formatMessage(messages().hud.age, {
            years: Math.floor(ageTicks / systems.TICKS_PER_AGE_YEAR),
          })}`
        : '';
    const experience = experienceRows(ctx, comps);
    const hero = ctx.jobs.some((job) => job.typeId === num(s.jobType) && systems.isHeroJobRow(job));
    return {
      kind: 'settler',
      entityId,
      name: settlerDisplayName(ctx, snapshot, ent),
      profession: jobDisplayName(ctx, num(s.jobType)),
      // The child and woman gates are the sim's own `isTradeAssignable` refusals. The idle gate is the
      // panel's alone: a settler with no trade has nothing to place.
      canAssignWorkplace:
        !young && !isFemale(ent) && num(s.jobType) !== undefined && num(s.jobType) !== JOB_IDLE,
      // Releasing a post keeps the trade, so beyond that same gate it needs only a post.
      canUnassignWorkplace: !young && !isFemale(ent) && workplaceOf(ent) !== undefined,
      // A growing child moves with its parents instead of picking a home.
      canAssignHome: !young,
      canUnassignHome: !young && residenceHomeOf(ent) !== undefined,
      meta: meta + ageSuffix,
      statusCaption: settlerStatus(ctx, snapshot, entityId, comps),
      bars: satisfactionBars(ent, needsRuleEnabled(snapshot), !hero),
      work: settlerWork(ctx, snapshot, comps, progressionGated),
      trade: tradePanelModel(ctx, snapshot, entityId),
      showsExperience: hero || (!young && !isFemale(ent)) || experience.length > 0,
      experience,
      upcomingUnlocks: unlockProgressRows(ctx, comps, progressionGated),
      equipmentRows: equipmentRows(ctx, comps),
    };
  }

  if (settlerIds.length > 1) return { kind: 'multi-settler', count: settlerIds.length };
  return { kind: 'generic', count: selected.size };
}
