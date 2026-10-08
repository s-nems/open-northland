import type { UiCue } from '@open-northland/audio';
import type { ContentSet, EquipCategory } from '@open-northland/data';
import {
  type Entity,
  type EquipPickEntry,
  type EquipSelectionPick,
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

export interface EquipPickControllerOptions {
  readonly uiString: UiString;
  /** The sim's pick-list read (`SessionHost.equipPickList`), asked afresh as a slot window opens. */
  readonly pickList: (entity: number, group: EquipCategory) => Promise<readonly EquipPickEntry[]>;
  /** The sim's selection-wide read (`SessionHost.equipPicksForSelection`), asked as the ring's window opens. */
  readonly selectionPicks: (entities: readonly number[]) => Promise<readonly EquipSelectionPick[]>;
  readonly content: ContentSet;
  readonly snapshot: () => WorldSnapshot;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly onOrderLimit?: (() => void) | undefined;
  /** The GUI click a picked row and the ✕ box confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
}

export interface EquipPickController {
  open(settlerId: number, ref: EquipSlotRef): void;
  /** Every good some of the selection can wear and reach - the ring's "Change Equipment" entry point. */
  openAll(settlerIds: readonly number[]): void;
  dispose(): void;
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
  pick: Pick<EquipSelectionPick, 'goodType' | 'group'>,
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
      void opts.selectionPicks(targets).then((rows) => {
        if (request === opening) showSelectionPicks(rows);
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

  /** Each row sends its own takers: the settlers that can wear the good and reach a unit of it. */
  function showSelectionPicks(rows: readonly EquipSelectionPick[]): void {
    const w = win();
    w.setTitle(actionLabel('changeEquipment', opts.uiString));
    w.clearList();
    if (rows.length === 0) w.addNote(messages().hud.equipPickEmpty);
    for (const row of rows) {
      const def = goods.find((g) => g.typeId === row.goodType);
      const label = `${def?.name ?? def?.id ?? `#${row.goodType}`} (${row.available})`;
      w.addRow(label, () => {
        enqueueUnitSelection(
          selectionEquipCommands(opts.snapshot(), row.takers, row),
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
