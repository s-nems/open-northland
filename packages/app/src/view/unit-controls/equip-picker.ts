import type { UiCue } from '@open-northland/audio';
import type { ContentSet, EquipCategory } from '@open-northland/data';
import {
  type Entity,
  type EquipPickEntry,
  type EquipSelectionPick,
  entityById,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  components as simComponents,
  type UnitSelectionCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { UiString } from '../../content/gui-gfx.js';
import { actionLabel } from '../../hud/action-ring/labels.js';
import type { EquipSlotRef } from '../../hud/details-panel/index.js';
import { type ChoiceGroup, type ChoiceRow, createChoiceWindow } from '../../hud/dom/choice-window.js';
import type { GoodIconPainter } from '../../hud/dom/good-art.js';
import { compareLabels, formatMessage, goodName, messages } from '../../i18n/index.js';
import { enqueueUnitSelection } from './group-orders.js';

const { MISC_EQUIP_SLOTS } = simComponents;

export interface EquipPickControllerOptions {
  readonly uiString: UiString;
  /** The sim's pick-list read (`SessionHost.equipPickList`), asked afresh as a slot window opens. */
  readonly pickList: (entity: number, group: EquipCategory) => Promise<readonly EquipPickEntry[]>;
  /** The sim's selection-wide read (`SessionHost.equipPicksForSelection`), asked as the ring's window opens. */
  readonly selectionPicks: (entities: readonly number[]) => Promise<readonly EquipSelectionPick[]>;
  readonly content: ContentSet;
  /** The HUD plane's current scale, read as the window opens. */
  readonly scale: () => number;
  readonly icons: GoodIconPainter;
  readonly snapshot: () => WorldSnapshot;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly onOrderLimit?: (() => void) | undefined;
  /** The GUI click a picked row and a dismissal confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
}

export interface EquipPickController {
  open(settlerId: number, ref: EquipSlotRef): void;
  /** Every good some of the selection can wear and reach - the ring's "Change Equipment" entry point. */
  openAll(settlerIds: readonly number[]): void;
  dispose(): void;
}

interface EquipIntentView {
  readonly group?: unknown;
  readonly slot?: unknown;
}

/** The misc slots the settler's own equip errand, under way or queued, is already filling. The sim lets
 *  a later order for one of them replace it, so a second pick must aim at another slot to queue. */
function pendingMiscSlots(components: Readonly<Record<string, unknown>>): Set<number> {
  const order = components.EquipOrder as
    | (EquipIntentView & { readonly issuer?: unknown; readonly queued?: readonly EquipIntentView[] })
    | undefined;
  const slots = new Set<number>();
  // An assistant's hand-out gives way to the player's order instead of holding it back.
  if (order?.issuer !== 'player') return slots;
  for (const intent of [order, ...(order.queued ?? [])]) {
    if (intent.group === 'misc' && typeof intent.slot === 'number') slots.add(intent.slot);
  }
  return slots;
}

/** Fixed groups replace their only slot. Misc fills the first gap no pending errand fills, then replaces
 *  the first worn good no errand is replacing, and slot zero once every slot is spoken for. */
export function equipSlotFor(components: Readonly<Record<string, unknown>>, group: EquipCategory): number {
  if (group !== 'misc') return 0;
  const equipment = components.Equipment as { readonly misc?: unknown } | undefined;
  const misc: readonly unknown[] = Array.isArray(equipment?.misc) ? equipment.misc : [];
  const pending = pendingMiscSlots(components);
  let replaceable: number | undefined;
  for (let slot = 0; slot < MISC_EQUIP_SLOTS; slot++) {
    if (pending.has(slot)) continue;
    if (misc[slot] == null) return slot;
    replaceable ??= slot;
  }
  return replaceable ?? 0;
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

/** The window's groups in the settler panel's slot order. */
const GROUP_ORDER: readonly EquipCategory[] = ['weapon', 'armor', 'tool', 'boots', 'misc'];

function slotTitle(group: EquipCategory): string {
  const slots = messages().hud.equipmentSlots;
  if (group === 'tool') return slots.tools;
  return slots[group];
}

/** What a pick commits: the slot window equips one settler's slot, the selection window sends a good to
 *  its takers. */
type PendingPick =
  | { readonly kind: 'slot'; readonly settlerId: number; readonly ref: EquipSlotRef }
  | { readonly kind: 'selection'; readonly rows: readonly EquipSelectionPick[] };

export function mountEquipPicker(opts: EquipPickControllerOptions): EquipPickController {
  const goods = opts.content.goods;
  let dialog: ReturnType<typeof createChoiceWindow> | null = null;
  let pending: PendingPick | null = null;
  const hide = (): void => {
    pending = null;
    dialog?.hide();
  };
  const pick = (key: string): void => {
    const goodType = Number(key);
    const current = pending;
    hide();
    if (current?.kind === 'slot') {
      opts.enqueue({
        kind: 'equipGood',
        entity: current.settlerId as Entity,
        group: current.ref.group,
        slot: current.ref.slot,
        goodType,
      });
    } else if (current?.kind === 'selection') {
      const row = current.rows.find((candidate) => candidate.goodType === goodType);
      if (row === undefined) return;
      enqueueUnitSelection(
        selectionEquipCommands(opts.snapshot(), row.takers, row),
        opts.enqueue,
        opts.onOrderLimit,
      );
    }
  };
  const show = (
    next: PendingPick,
    groups: readonly ChoiceGroup[],
    caption: string,
    search: boolean,
  ): void => {
    const title = actionLabel('changeEquipment', opts.uiString);
    dialog ??= createChoiceWindow({
      title,
      scale: opts.scale(),
      icons: opts.icons,
      emptyLabel: messages().hud.equipPickEmpty,
      onPick: pick,
      onDismiss: hide,
      ...(opts.cue !== undefined ? { cue: opts.cue } : {}),
    });
    pending = next;
    void dialog.setUiScale(opts.scale());
    dialog.update(groups, caption);
    dialog.show(title, { search });
  };
  const row = (entry: EquipPickEntry, tooltip: (good: string) => string): ChoiceRow => {
    const def = goods.find((g) => g.typeId === entry.goodType);
    const label = def === undefined ? `#${entry.goodType}` : goodName(def);
    return {
      key: String(entry.goodType),
      label,
      detail: String(entry.available),
      tooltip: tooltip(label),
      ...(def !== undefined ? { goodId: def.id } : {}),
    };
  };
  const sorted = (rows: ChoiceRow[]): ChoiceRow[] => {
    const compare = compareLabels();
    return rows.sort((a, b) => compare(a.label, b.label));
  };

  // Each open supersedes the one before it, so a slow answer never fills a window opened since.
  let opening = 0;
  const controller: EquipPickController = {
    open: (settlerId: number, ref: EquipSlotRef): void => {
      const request = ++opening;
      void opts.pickList(settlerId, ref.group).then((entries) => {
        if (request !== opening) return;
        const copy = messages().hud;
        const rows = sorted(
          entries.map((entry) =>
            row(entry, (good) => formatMessage(copy.equipPickRow, { good, available: entry.available })),
          ),
        );
        show({ kind: 'slot', settlerId, ref }, [{ label: slotTitle(ref.group), rows }], '', false);
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
      void opts.selectionPicks(targets).then((entries) => {
        if (request !== opening) return;
        const copy = messages().hud;
        const count = targets.length;
        // Each row sends its own takers: the settlers that can wear the good and reach a unit of it.
        const groups = GROUP_ORDER.map((group) => ({
          label: slotTitle(group),
          rows: sorted(
            entries
              .filter((entry) => entry.group === group)
              .map((entry) =>
                row(entry, (good) =>
                  entry.takers.length < count
                    ? formatMessage(copy.equipPickTakers, {
                        good,
                        available: entry.available,
                        takers: entry.takers.length,
                        count,
                      })
                    : formatMessage(copy.equipPickRow, { good, available: entry.available }),
                ),
              ),
          ),
        })).filter((group) => group.rows.length > 0);
        const caption = count > 1 ? formatMessage(copy.equipPickSelected, { count }) : '';
        show({ kind: 'selection', rows: entries }, groups, caption, true);
      });
    },
    dispose: (): void => {
      opening++;
      pending = null;
      dialog?.dispose();
      dialog = null;
    },
  };
  return controller;
}
