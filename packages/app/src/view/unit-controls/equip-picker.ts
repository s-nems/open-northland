import type { UiCue } from '@open-northland/audio';
import type { ContentSet, EquipCategory } from '@open-northland/data';
import {
  type Entity,
  type EquipPickEntry,
  entityById,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type UnitSelectionCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { UiString } from '../../content/gui-gfx.js';
import { loadUiFont } from '../../content/ui-font.js';
import { actionLabel } from '../../hud/action-ring/labels.js';
import type { EquipSlotRef } from '../../hud/details-panel/index.js';
import { messages } from '../../i18n/index.js';
import { enqueueUnitSelection } from './group-orders.js';
import { createPickerWindow, type PickerWindow } from './picker-window.js';

/** The goods a settler could fetch and wear in one slot group. */
type PickList = (entity: number, group: EquipCategory) => readonly EquipPickEntry[];

export interface EquipPickControllerOptions {
  readonly uiString: UiString;
  /** The sim's pick-list read (`SessionHost.equipPickList`), asked afresh as a window opens. */
  readonly pickList: (entity: number, group: EquipCategory) => Promise<readonly EquipPickEntry[]>;
  readonly content: ContentSet;
  readonly snapshot: () => WorldSnapshot;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly onOrderLimit?: (() => void) | undefined;
  /** The GUI click a picked row and the ✕ box confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
}

export interface EquipPickController {
  open(settlerId: number, ref: EquipSlotRef): void;
  /** Every good the whole selection can wear and reach - the ring's "Change Equipment" entry point. */
  openAll(settlerIds: readonly number[]): void;
  dispose(): void;
}

export interface CommonEquipPick extends EquipPickEntry {
  readonly group: EquipCategory;
}

const EQUIP_GROUPS: readonly EquipCategory[] = ['boots', 'tool', 'weapon', 'armor', 'misc'];

/** The content-ordered intersection of goods every selected settler can currently fetch and wear. */
export function commonEquipPicks(
  content: ContentSet,
  settlerIds: readonly number[],
  pickList: PickList,
): CommonEquipPick[] {
  if (settlerIds.length === 0) return [];
  const picksBySettler = settlerIds.map((entity) => {
    const picks = new Map<number, CommonEquipPick>();
    for (const group of EQUIP_GROUPS) {
      for (const row of pickList(entity, group)) picks.set(row.goodType, { ...row, group });
    }
    return picks;
  });
  const rows: CommonEquipPick[] = [];
  for (const good of content.goods) {
    const first = picksBySettler[0]?.get(good.typeId);
    if (first === undefined) continue;
    let available = first.available;
    let common = true;
    for (let i = 1; i < picksBySettler.length; i++) {
      const pick = picksBySettler[i]?.get(good.typeId);
      if (pick === undefined || pick.group !== first.group) {
        common = false;
        break;
      }
      available = Math.min(available, pick.available);
    }
    if (common) rows.push({ goodType: good.typeId, group: first.group, available });
  }
  return rows;
}

/** Fixed groups replace their only slot; misc fills the first gap and replaces slot zero once full. */
export function equipSlotFor(components: Readonly<Record<string, unknown>>, group: EquipCategory): number {
  if (group !== 'misc') return 0;
  const equipment = components.Equipment as { readonly misc?: unknown } | undefined;
  if (!Array.isArray(equipment?.misc)) return 0;
  const free = equipment.misc.findIndex((slot) => slot == null);
  return free < 0 ? 0 : free;
}

/** One selected good becomes one order per still-live selected settler. `skipReturn` skips the walk
 *  back to where each settler stood. */
export function selectionEquipCommands(
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  pick: Pick<CommonEquipPick, 'goodType' | 'group'>,
  { skipReturn = false }: { readonly skipReturn?: boolean } = {},
): UnitSelectionCommand[] {
  const commands: UnitSelectionCommand[] = [];
  for (const settlerId of settlerIds) {
    const entity = entityById(snapshot, settlerId);
    if (entity === undefined) continue;
    commands.push({
      kind: 'equipGood',
      entity: settlerId as Entity,
      group: pick.group,
      slot: equipSlotFor(entity.components, pick.group),
      goodType: pick.goodType,
      ...(skipReturn ? { skipReturn } : {}),
    });
  }
  return commands;
}

function slotTitle(group: EquipCategory): string {
  const slots = messages().hud.equipmentSlots;
  if (group === 'tool') return slots.tools;
  return slots[group];
}

export async function mountEquipPicker(opts: EquipPickControllerOptions): Promise<EquipPickController> {
  const uiFont = await loadUiFont();
  const goods = opts.content.goods;
  let window_: PickerWindow | null = null;
  const win = (): PickerWindow => {
    window_ ??= createPickerWindow({
      uiFont,
      onDismiss: () => window_?.hide(),
      ...(opts.cue !== undefined ? { cue: opts.cue } : {}),
    });
    return window_;
  };

  // Each open supersedes the one before it, so a slow answer never fills a window opened since.
  let opening = 0;
  const controller: EquipPickController = {
    open: (settlerId: number, ref: EquipSlotRef): void => {
      const request = ++opening;
      void opts.pickList(settlerId, ref.group).then((rows) => {
        if (request === opening) showSlotPicks(settlerId, ref, rows);
      });
    },
    openAll: (settlerIds): void => {
      const snapshot = opts.snapshot();
      const targets = settlerIds.filter((id) => entityById(snapshot, id) !== undefined);
      if (targets.length === 0) return;
      if (new Set(targets).size > MAX_UNIT_ORDER_MEMBERS) {
        opts.onOrderLimit?.();
        return;
      }
      const request = ++opening;
      const asked = targets.flatMap((entity) =>
        EQUIP_GROUPS.map((group) =>
          opts.pickList(entity, group).then((rows) => [`${entity}:${group}`, rows] as const),
        ),
      );
      void Promise.all(asked).then((answered) => {
        if (request !== opening) return;
        const lists = new Map(answered);
        showCommonPicks(targets, (entity, group) => lists.get(`${entity}:${group}`) ?? []);
      });
    },
    dispose: (): void => {
      opening++;
      window_?.dispose();
      window_ = null;
    },
  };

  function showSlotPicks(settlerId: number, ref: EquipSlotRef, rows: readonly EquipPickEntry[]): void {
    const w = win();
    w.setTitle(slotTitle(ref.group));
    w.clearList();
    if (rows.length === 0) w.addNote(messages().hud.equipPickEmpty);
    for (const row of rows) {
      const def = goods.find((g) => g.typeId === row.goodType);
      const label = `${def?.name ?? def?.id ?? `#${row.goodType}`} (${row.available})`;
      w.addRow(label, () => {
        opts.enqueue({
          kind: 'equipGood',
          entity: settlerId as Entity,
          group: ref.group,
          slot: ref.slot,
          goodType: row.goodType,
        });
        w.hide();
      });
    }
    w.show();
  }

  function showCommonPicks(targets: readonly number[], pickList: PickList): void {
    const w = win();
    w.setTitle(actionLabel('changeEquipment', opts.uiString));
    w.clearList();
    const rows = commonEquipPicks(opts.content, targets, pickList);
    if (rows.length === 0) w.addNote(messages().hud.equipPickEmpty);
    for (const row of rows) {
      const def = goods.find((g) => g.typeId === row.goodType);
      const label = `${def?.name ?? def?.id ?? `#${row.goodType}`} (${row.available})`;
      w.addRow(label, () => {
        enqueueUnitSelection(
          selectionEquipCommands(opts.snapshot(), targets, row),
          opts.enqueue,
          opts.onOrderLimit,
        );
        w.hide();
      });
    }
    w.show();
  }
  return controller;
}
