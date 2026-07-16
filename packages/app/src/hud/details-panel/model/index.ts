import type { WorldSnapshot } from '@open-northland/sim';
import { vikingBuildingByTypeId } from '../../../catalog/buildings.js';
import { characterName } from '../../../game/character-names.js';
import { PRIMARY_TRIBE } from '../../../game/rules.js';
import { JOB_IDLE } from '../../../game/sandbox/ids/index.js';
import { entityById, isBuilding, isSettler, num, ownerPlayerOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { pct } from './bars.js';
import {
  type BuildingPanelModel,
  constructionModel,
  productionModel,
  stockRows,
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
  equipmentRows,
  highestExperience,
  type SettlerPanelModel,
  satisfactionBars,
  settlerStatus,
  settlerWork,
  stanceLabel,
} from './settler.js';

/**
 * The pure selection→panel-model half of the details panel: what the bottom-right panel shows for the
 * current selection, with no Pixi/DOM in sight (the headless tests exercise exactly this seam). The
 * rendering half lives in `sections.ts`/`panel.ts`. The per-selection model builders are split by domain:
 * shared context/lookups in `context.ts`, gauge primitives in `bars.ts`, the settler half in `settler.ts`,
 * the building half in `building.ts`; this module is the barrel + the top-level {@link buildUnitPanelModel}
 * classifier that dispatches a selection to one of the model shapes.
 */

export { type BarTone, barTone, type PanelBar } from './bars.js';
export type {
  BuildingPanelModel,
  ConstructionModel,
  ConstructionRow,
  ProductionModel,
  StockRow,
  WorkerSlotRow,
} from './building.js';
export type { UnitPanelModelContext } from './context.js';
export {
  type EquipRow,
  type EquipSlotModel,
  HUMANWINDOW,
  type SettlerPanelModel,
} from './settler.js';

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

export type UnitPanelModel =
  | EmptyPanelModel
  | BuildingPanelModel
  | SettlerPanelModel
  | MultiSettlerPanelModel
  | GenericSelectionPanelModel;

/** The catalog id of the one storage building that also mounts a defence (the HQ's defence section). */
const HEADQUARTERS_ID = 'headquarters';

export function buildUnitPanelModel(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
  ctx: UnitPanelModelContext,
): UnitPanelModel {
  if (selected.size === 0) return { kind: 'empty' };

  // One entity pass classifies the whole selection (never O(selected × entities) — a marquee can hold
  // hundreds of ids). Ascending-id sort keeps the single-pick branches' winner deterministic.
  const settlerIds: number[] = [];
  const buildingIds: number[] = [];
  for (const e of snapshot.entities) {
    if (!selected.has(e.id)) continue;
    if (isSettler(e)) settlerIds.push(e.id);
    else if (isBuilding(e)) buildingIds.push(e.id);
  }
  settlerIds.sort((a, b) => a - b);
  buildingIds.sort((a, b) => a - b);

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
      stock: stockRows(ctx, def, ent.components.Stockpile),
      workerSlots: workerSlotsFor(ctx, snapshot, def, entityId),
      showDefense: catalog?.id === HEADQUARTERS_ID || category === 'tower',
      // Pinned approximation until a defence-mode component exists; the original state/toggle strings
      // live at `housewindow` 140–143 ("Rozpocznij/Zatrzymaj Tryb Obrony", "Obrona rozpoczęta/zakończona.").
      defenseLabel: messages().hud.defenseStopped,
      production: productionModel(ctx, snapshot, def, ent),
      construction: constructionModel(ctx, def, ent),
    };
  }

  if (settlerIds.length === 1) {
    const entityId = settlerIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const comps = ent.components as Comp;
    const s = (ent.components.Settler ?? {}) as Comp;
    const stance = ent.components.Stance as { mode?: unknown } | undefined;
    // Meta line: owner + tribe, with the military stance appended only for a unit that has one (a soldier).
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
    // Only a born-young (baby/child) settler carries `Age`; that flag, with the job, fixes the drawn body's
    // sex so the name matches the character (mirrors the render body-join in `content/settler-gfx.ts`).
    const young = comps.Age !== undefined;
    return {
      kind: 'settler',
      entityId,
      name: characterName(num(s.tribe) ?? PRIMARY_TRIBE, num(s.jobType), young, entityId),
      // The profession name resolves through the shared catalog + i18n (and, for a building-bound settler,
      // its rebased slot job's content name) so a bound druid reads "Druid", not "Bezrobotny".
      profession: jobDisplayName(ctx, num(s.jobType)),
      // The assign-workplace button is active only for a settler with a real trade (jobType not idle/absent):
      // an idle settler has no trade to place at a building.
      canAssignWorkplace: num(s.jobType) !== undefined && num(s.jobType) !== JOB_IDLE,
      meta,
      statusCaption: settlerStatus(comps),
      bars: satisfactionBars(comps),
      work: settlerWork(ctx, snapshot, comps),
      experience: highestExperience(comps),
      equipmentRows: equipmentRows(ctx, comps),
    };
  }

  if (settlerIds.length > 1) return { kind: 'multi-settler', count: settlerIds.length };
  return { kind: 'generic', count: selected.size };
}
