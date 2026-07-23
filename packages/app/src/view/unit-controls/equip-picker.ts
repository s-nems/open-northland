import type { ContentSet, EquipCategory } from '@open-northland/data';
import type { Command, Entity, EquipPickEntry } from '@open-northland/sim';
import { loadUiFont } from '../../content/ui-font.js';
import type { EquipSlotRef } from '../../hud/details-panel/index.js';
import { messages } from '../../i18n/index.js';
import { createPickerWindow, type PickerWindow } from './picker-window.js';

/**
 * The equipment pick-menu: the centred window the equipment panel's plus/swap buttons open, listing
 * every good wearable in the clicked slot that the settler can reach right now (the sim's
 * `equipPickList` read seam), each with the reachable unit count. A row click issues the `equipGood`
 * order; an empty settlement shows a dim "nothing available" line instead of rows.
 */

export interface EquipPickControllerOptions {
  /** The sim's pick-list read seam (`Simulation.equipPickList`), bound by the shell. */
  readonly pickList: (entity: number, group: EquipCategory) => readonly EquipPickEntry[];
  /** The running content's goods - the row labels (localized `name`, id fallback, like the panel). */
  readonly goods: ContentSet['goods'];
  readonly enqueue: (command: Command) => void;
}

export interface EquipPickController {
  /** Open the menu for one settler's slot: rebuild the rows from the live pick list and show. */
  open(settlerId: number, ref: EquipSlotRef): void;
  dispose(): void;
}

/** The window title per slot group - the panel's own row labels (`hud.equipmentSlots`). */
function slotTitle(group: EquipCategory): string {
  const slots = messages().hud.equipmentSlots;
  if (group === 'tool') return slots.tools;
  return slots[group];
}

export async function mountEquipPicker(opts: EquipPickControllerOptions): Promise<EquipPickController> {
  const uiFont = await loadUiFont();
  let window_: PickerWindow | null = null;
  const win = (): PickerWindow => {
    window_ ??= createPickerWindow({
      uiFont,
      title: '',
      onDismiss: () => window_?.hide(),
    });
    return window_;
  };

  return {
    open: (settlerId, ref): void => {
      const w = win();
      w.setTitle(slotTitle(ref.group));
      w.clearList();
      const rows = opts.pickList(settlerId, ref.group);
      if (rows.length === 0) w.addNote(messages().hud.equipPickEmpty);
      for (const row of rows) {
        const def = opts.goods.find((g) => g.typeId === row.goodType);
        const label = `${def?.name ?? def?.id ?? `#${row.goodType}`} ×${row.available}`;
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
    dispose: (): void => {
      window_?.dispose();
      window_ = null;
    },
  };
}
