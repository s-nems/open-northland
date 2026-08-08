import type { Rect } from '../../geometry.js';
import type { EquipGroup, EquipRow } from '../model/index.js';

// The Ekwipunek section's geometry, plus the flat list of per-slot action buttons a click hit-tests
// against.

/** One labeled equipment row (Buty/Narzędzia/…): a label column + a row of slot sockets. */
export const EQUIP_ROW_H = 24;
/** A round equipment-slot socket's square bounding box (design px). */
export const EQUIP_SOCKET = 18;
/** Gap after a slot cell's last action button before the next socket (the misc Ekwipunek row). */
const EQUIP_SOCKET_GAP = 4;
/** The row-label column width before the sockets (fits the widest slot label, "Narzędzia"). */
export const EQUIP_LABEL_W = 74;
/** Diameter of a round per-slot action button (equip/swap, and the take-off cross beside it). Sized so
 *  four misc cells share one line with the label at every menu uiscale. */
const EQUIP_ACTION_BTN = 15;
/** Gap between a socket and its first action button, clearing the icon's 3 px overflow past the ring. */
const EQUIP_BTN_INSET = 4;
/** Gap between a slot's equip/swap button and its take-off cross. */
const EQUIP_ACTION_GAP = 2;

/** One row's slots may span several {@link EQUIP_ROW_H} lines. */
export interface EquipRowRect {
  readonly label: Rect;
  readonly slots: readonly Rect[];
}

/** Which sim `Equipment` slot an action button addresses (`slot` indexes the misc row; 0 elsewhere). */
export interface EquipSlotRef {
  readonly group: EquipGroup;
  readonly slot: number;
}

/** `equip` opens the pick menu for an empty slot, `swap` for an occupied one, `unequip` orders the worn
 *  item taken off. */
export type EquipActionKind = 'equip' | 'swap' | 'unequip';

/** One per-slot equipment action button. Always enabled: what can actually be worn is the pick menu's
 *  decision, and a worn item can always come off. */
export interface EquipActionHit {
  readonly ref: EquipSlotRef;
  readonly kind: EquipActionKind;
  /** The worn good's name (the swap/take-off tooltips); absent for an empty slot's equip button. */
  readonly label?: string;
  readonly rect: Rect;
}

/** A hover identity for an action button, stable across panel rebuilds. */
export const equipActionKey = (hit: EquipActionHit): string => `${hit.ref.group}:${hit.ref.slot}:${hit.kind}`;

/**
 * The scaled slot-cell metrics: a cell is the socket, then its equip/swap button and take-off cross. The
 * pitch reserves both buttons for every cell so sockets stay column-aligned, and a row whose cells
 * overflow `bodyW` wraps onto further {@link EQUIP_ROW_H} lines. Separate from {@link layoutEquipRows}
 * because the caller needs `slotsPerLine` to size the body, before the section rects exist.
 */
export function equipSlotMetrics(bodyW: number, s: number): { slotsPerLine: number } {
  const socket = Math.round(EQUIP_SOCKET * s);
  const socketGap = Math.round(EQUIP_SOCKET_GAP * s);
  const slotPitch =
    socket +
    Math.round(EQUIP_BTN_INSET * s) +
    2 * Math.round(EQUIP_ACTION_BTN * s) +
    Math.round(EQUIP_ACTION_GAP * s) +
    socketGap;
  // The last cell needs no trailing gap, hence the +socketGap headroom.
  const slotsPerLine = Math.max(
    1,
    Math.floor((bodyW - Math.round(EQUIP_LABEL_W * s) + socketGap) / slotPitch),
  );
  return { slotsPerLine };
}

/** How many {@link EQUIP_ROW_H} lines each row occupies at `slotsPerLine` - the Ekwipunek body height. */
export function equipRowLines(rows: readonly EquipRow[], slotsPerLine: number): number[] {
  return rows.map((row) => Math.max(1, Math.ceil(row.slots.length / slotsPerLine)));
}

/**
 * Lay the equipment rows into `body` and collect their action buttons. A worn slot offers swap and
 * take-off, an empty one only equip, and a row the settler may no longer wear offers only take-off, so
 * no button opens a menu the sim would refuse to fill.
 */
export function layoutEquipRows(
  rows: readonly EquipRow[],
  body: Rect,
  s: number,
): { rects: EquipRowRect[]; hits: EquipActionHit[] } {
  const rowH = Math.round(EQUIP_ROW_H * s);
  const socket = Math.round(EQUIP_SOCKET * s);
  const labelW = Math.round(EQUIP_LABEL_W * s);
  const actionBtn = Math.round(EQUIP_ACTION_BTN * s);
  const btnInset = Math.round(EQUIP_BTN_INSET * s);
  const actionGap = Math.round(EQUIP_ACTION_GAP * s);
  const socketGap = Math.round(EQUIP_SOCKET_GAP * s);
  const slotPitch = socket + btnInset + actionBtn + actionGap + actionBtn + socketGap;
  const { slotsPerLine } = equipSlotMetrics(body.w, s);
  const lines = equipRowLines(rows, slotsPerLine);
  const socketPadY = Math.round((rowH - socket) / 2);
  const actionPadY = Math.round((rowH - actionBtn) / 2);

  const hits: EquipActionHit[] = [];
  let rowY = body.y;
  const rects = rows.map((row, i) => {
    const top = rowY;
    rowY += (lines[i] ?? 1) * rowH;
    const label: Rect = { x: body.x, y: top, w: labelW, h: rowH };
    const slotsX = body.x + labelW;
    const slots: Rect[] = row.slots.map((slot, j) => {
      const cellX = slotsX + (j % slotsPerLine) * slotPitch;
      const cellY = top + Math.floor(j / slotsPerLine) * rowH;
      const btnRect = (col: number): Rect => ({
        x: cellX + socket + btnInset + col * (actionBtn + actionGap),
        y: cellY + actionPadY,
        w: actionBtn,
        h: actionBtn,
      });
      const ref: EquipSlotRef = { group: row.group, slot: j };
      const named = slot.label !== undefined ? { label: slot.label } : {};
      if (row.wearable) {
        hits.push({ ref, kind: slot.occupied ? 'swap' : 'equip', ...named, rect: btnRect(0) });
      }
      // The cross keeps its column whether or not the first button is drawn, so an unwearable row's
      // socket still lines up with the rows above it.
      if (slot.occupied) hits.push({ ref, kind: 'unequip', ...named, rect: btnRect(1) });
      return { x: cellX, y: cellY + socketPadY, w: socket, h: socket };
    });
    return { label, slots };
  });
  return { rects, hits };
}
