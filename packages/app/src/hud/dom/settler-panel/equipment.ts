import { formatMessage, messages } from '../../../i18n/index.js';
import type { EquipGroup, EquipRow, EquipSlotRef } from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import type { SocketModel } from '../parts/socket.js';

/** The worn slots in their fixed order (FOUNDATION.md); a person shows only the ones it has, a hero only
 *  the arms it carries. */
const WORN_ORDER: readonly EquipGroup[] = ['weapon', 'armor', 'tool', 'boots'];
const HERO_ORDER: readonly EquipGroup[] = ['weapon', 'armor'];

/** The ghost glyph an empty worn slot shows: what goes there. */
const GHOST: Readonly<Record<Exclude<EquipGroup, 'misc'>, string>> = {
  weapon: GLYPH.blade,
  armor: GLYPH.armor,
  tool: GLYPH.tool,
  boots: GLYPH.boot,
};

/** A condition below this is a part-used item, which taking off destroys. */
const FULL_CONDITION_PCT = 100;

/** One socket beside the portrait: its slot address and its look; an inert one (a hero's locked arms, a
 *  fighter's stray tool) opens no picker. */
export interface SocketSpec {
  readonly ref: EquipSlotRef;
  readonly fixed: boolean;
  readonly bag: boolean;
  readonly model: SocketModel;
}

/** The two socket rows: the worn slots in order, then the bag's cells. */
export interface EquipmentSockets {
  readonly worn: readonly SocketSpec[];
  readonly bag: readonly SocketSpec[];
}

function socketOf(row: EquipRow, slot: number, label: string, hero: boolean): SocketSpec {
  const copy = messages().hud;
  const ref = { group: row.group, slot };
  const cell = row.slots[slot];
  const bag = row.group === 'misc';
  const fixed = hero;
  if (cell === undefined || !cell.occupied) {
    return {
      ref,
      fixed,
      bag,
      model: {
        kind: 'empty',
        ghost: row.group === 'misc' ? null : GHOST[row.group],
        inert: !row.wearable,
        label: formatMessage(copy.settlerPanel.equipLabel, { slot: label }),
        tooltip: row.wearable
          ? formatMessage(copy.settlerPanel.equip, { slot: label })
          : formatMessage(copy.settlerPanel.cannotWear, { slot: label }),
      },
    };
  }
  const good = cell.label ?? label;
  const values = { slot: label, good, percent: cell.conditionPct ?? 0 };
  const tooltip = !row.wearable
    ? formatMessage(copy.settlerPanel.fixedSlot, values)
    : cell.conditionPct === null
      ? formatMessage(copy.settlerPanel.swap, values)
      : formatMessage(copy.settlerPanel.swapWorn, values);
  const takeOff = formatMessage(copy.settlerPanel.takeOff, { good });
  const discards = cell.conditionPct !== null && cell.conditionPct < FULL_CONDITION_PCT;
  return {
    ref,
    fixed,
    bag,
    model: {
      kind: 'item',
      inert: !row.wearable,
      goodId: cell.goodId,
      wearPct: cell.conditionPct,
      label: formatMessage(copy.settlerPanel.swapLabel, { good }),
      tooltip,
      removeLabel: hero ? null : discards ? `${takeOff}\n${copy.usedItemDiscardHint}` : takeOff,
    },
  };
}

/** The sockets a person's equipment rows show: a hero's arms are locked and inert, and a slot its class
 *  leaves empty is not shown. */
export function equipmentSockets(rows: readonly EquipRow[], hero: boolean): EquipmentSockets {
  const worn = (hero ? HERO_ORDER : WORN_ORDER).flatMap((group) => {
    const row = rows.find((candidate) => candidate.group === group);
    if (row === undefined || (hero && row.slots[0]?.occupied !== true)) return [];
    return [socketOf(row, 0, row.slotLabel, hero)];
  });
  const misc = rows.find((row) => row.group === 'misc');
  const bagLabel = messages().hud.settlerPanel.bag;
  const bag =
    hero || misc === undefined ? [] : misc.slots.map((_, slot) => socketOf(misc, slot, bagLabel, hero));
  return { worn, bag };
}

/** What decides the sockets' elements: a change rebuilds them, anything else patches in place. */
export function socketsKey(sockets: EquipmentSockets): string {
  return [...sockets.worn, ...sockets.bag]
    .map((spec) => `${spec.ref.group}${spec.ref.slot}${spec.fixed ? 'f' : ''}`)
    .join(',');
}
