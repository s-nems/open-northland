import type { ContentSet, EquipCategory } from '@open-northland/data';
import {
  type Entity,
  type EquipPickEntry,
  entityById,
  type PlayerCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import { loadUiFont } from '../../content/ui-font.js';
import { type EquipSlotRef, equipmentRows } from '../../hud/details-panel/index.js';
import { messages } from '../../i18n/index.js';
import { createPickerWindow, type PickerWindow } from './picker-window.js';

export interface EquipPickControllerOptions {
  /** The sim's pick-list read seam (`Simulation.equipPickList`), bound by the shell. */
  readonly pickList: (entity: number, group: EquipCategory) => readonly EquipPickEntry[];
  readonly content: ContentSet;
  readonly snapshot: () => WorldSnapshot;
  readonly enqueue: (command: PlayerCommand) => void;
}

export interface EquipPickController {
  open(settlerId: number, ref: EquipSlotRef): void;
  /** The whole settler's gear, one row per slot - the ring's "Change Equipment" entry point. Picking a
   *  row steps into {@link open} for that slot. */
  openAll(settlerId: number): void;
  dispose(): void;
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
      title: '',
      onDismiss: () => window_?.hide(),
    });
    return window_;
  };

  const controller: EquipPickController = {
    open: (settlerId: number, ref: EquipSlotRef): void => {
      const w = win();
      w.setTitle(slotTitle(ref.group));
      w.clearList();
      const rows = opts.pickList(settlerId, ref.group);
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
    },
    openAll: (settlerId): void => {
      const entity = entityById(opts.snapshot(), settlerId);
      if (entity === undefined) return;
      const w = win();
      w.setTitle(messages().actionRing.changeEquipment);
      w.clearList();
      const empty = messages().hud.equipSlotFree;
      for (const row of equipmentRows(opts.content, entity.components)) {
        for (const [slot, worn] of row.slots.entries()) {
          const name = row.slots.length > 1 ? `${slotTitle(row.group)} ${slot + 1}` : slotTitle(row.group);
          w.addRow(`${name}: ${worn.label ?? empty}`, () => {
            controller.open(settlerId, { group: row.group, slot });
          });
        }
      }
      w.show();
    },
    dispose: (): void => {
      window_?.dispose();
      window_ = null;
    },
  };
  return controller;
}
