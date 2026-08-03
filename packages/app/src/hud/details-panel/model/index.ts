import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { vikingBuildingByTypeId } from '../../../catalog/buildings.js';
import { JOB_IDLE } from '../../../catalog/jobs.js';
import { characterName } from '../../../game/character-names/index.js';
import { PRIMARY_TRIBE } from '../../../game/rules.js';
import {
  familiesByHome,
  isBuilding,
  isFemale,
  isSettler,
  isSignpost,
  num,
  ownerPlayerOf,
  progressionGatesSettler,
  residenceHomeOf,
  shelterClaimCount,
  surnameSourceOf,
} from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
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
import { unlockProgressRows } from './settler-unlocks.js';
import { settlerWork } from './settler-work.js';

export { type BarTone, barTone, type PanelBar, remainingPct } from './bars.js';
export type {
  BuildingPanelModel,
  ConstructionModel,
  ConstructionRow,
  HomeResidentsModel,
  ProductionModel,
  StockRow,
  UpgradeCostRow,
  WorkerSlotRow,
} from './building.js';
export type { UnitPanelModelContext } from './context.js';
export { HUMANWINDOW } from './humanwindow.js';
export type { SettlerPanelModel } from './settler.js';
export type { EquipGroup, EquipRow, EquipSlotModel } from './settler-equipment.js';
export type { UnlockProgressRowModel } from './settler-unlocks.js';

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

export type UnitPanelModel =
  | EmptyPanelModel
  | BuildingPanelModel
  | SettlerPanelModel
  | SignpostPanelModel
  | MultiSettlerPanelModel
  | GenericSelectionPanelModel;

export function buildUnitPanelModel(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
  ctx: UnitPanelModelContext,
): UnitPanelModel {
  if (selected.size === 0) return { kind: 'empty' };

  // Classifying goes through the snapshot's id index, so it costs O(selected · log entities) rather
  // than a walk over a decoded map's scenery. The sorts below, not the selection's iteration order,
  // keep the single-pick branches' winner deterministic.
  const settlerIds: number[] = [];
  const buildingIds: number[] = [];
  const signpostIds: number[] = [];
  for (const id of selected) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    if (isSettler(e)) settlerIds.push(e.id);
    else if (isBuilding(e)) buildingIds.push(e.id);
    else if (isSignpost(e)) signpostIds.push(e.id);
  }
  settlerIds.sort((a, b) => a - b);
  buildingIds.sort((a, b) => a - b);
  signpostIds.sort((a, b) => a - b);

  // A signpost is a direct-click-only selection (never marquee'd), so units/buildings always outrank it.
  if (settlerIds.length === 0 && buildingIds.length === 0 && signpostIds.length === 1) {
    return { kind: 'signpost', entityId: signpostIds[0] as number };
  }

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
    // While anyone holds a seat, the workers field draws the garrison instead of the staff.
    const sheltered = shelterClaimCount(snapshot, entityId);
    return {
      kind: 'building',
      entityId,
      typeId,
      title: buildingTitle(ctx, rawType),
      category,
      owner: `#${ownerPlayerOf(ent) ?? '-'}`,
      tribe: `${num(b.tribe) ?? '-'}`,
      level: num(b.level) ?? 0,
      builtPct: pct(num(b.built)),
      health: healthBar(ent),
      stock: stockRows(ctx, def, ent.components.Stockpile, ent.components.ProductionBonus),
      workerSlots: workerSlotsFor(ctx, snapshot, def, entityId),
      home:
        def?.kind === 'home'
          ? {
              families: (familiesByHome(snapshot).get(entityId) ?? []).map((f) => ({ members: f.members })),
              capacity: def.homeSize,
            }
          : null,
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
      construction: constructionModel(ctx, def, ent),
      upgradable,
      cancelable: ent.components.Upgrading !== undefined,
      upgradeCost: upgradable ? upgradeCostRows(ctx, def) : [],
    };
  }

  if (settlerIds.length === 1) {
    const entityId = settlerIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const comps = ent.components as Comp;
    const s = (ent.components.Settler ?? {}) as Comp;
    const stance = ent.components.Stance as { mode?: unknown } | undefined;
    const stanceMode = num(stance?.mode);
    const stanceSuffix =
      stanceMode !== undefined
        ? formatMessage(messages().hud.stance, { stance: stanceLabel(stanceMode) })
        : '';
    const meta = formatMessage(messages().hud.playerTribe, {
      player: ownerPlayerOf(ent) ?? '-',
      tribe: num(s.tribe) ?? '-',
      stance: stanceSuffix,
    });
    // Only a born-young (baby or child) settler carries `Age`.
    const young = comps.Age !== undefined;
    // Whether the experience tree gates this settler; an AI-owned unit never is.
    const progressionGated = progressionGatesSettler(snapshot, ent);
    // Adulthood at 12 years ends the `Age` component, so the rendered age is only ever 0..11.
    const ageTicks = num((comps.Age as { ticks?: unknown } | undefined)?.ticks);
    const ageSuffix =
      young && ageTicks !== undefined
        ? ` · ${formatMessage(messages().hud.age, {
            years: Math.floor(ageTicks / systems.TICKS_PER_AGE_YEAR),
          })}`
        : '';
    return {
      kind: 'settler',
      entityId,
      name: characterName(
        num(s.tribe) ?? PRIMARY_TRIBE,
        num(s.jobType),
        young,
        entityId,
        surnameSourceOf(snapshot, ent),
        isFemale(ent),
      ),
      profession: jobDisplayName(ctx, num(s.jobType)),
      // A woman takes no trade at all, and an idle settler has no trade to place.
      canAssignWorkplace: num(s.jobType) !== undefined && num(s.jobType) !== JOB_IDLE && !isFemale(ent),
      // A growing child moves with its parents instead of picking a home.
      canAssignHome: !young,
      // Removing a home moves the settler's whole family out and frees the slot.
      canUnassignHome: !young && residenceHomeOf(ent) !== undefined,
      meta: meta + ageSuffix,
      statusCaption: settlerStatus(snapshot, comps),
      bars: satisfactionBars(ent),
      work: settlerWork(ctx, snapshot, comps, progressionGated),
      experience: experienceRows(ctx, comps),
      upcomingUnlocks: unlockProgressRows(ctx, comps, progressionGated),
      equipmentRows: equipmentRows(ctx, comps),
    };
  }

  if (settlerIds.length > 1) return { kind: 'multi-settler', count: settlerIds.length };
  return { kind: 'generic', count: selected.size };
}
