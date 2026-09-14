import { type Paper, PLACING_PAPER_KINDS } from '@open-northland/sim';
import type { Rect } from '../geometry.js';

/**
 * The extras window's plans tab: the player's papers as rows. A placing paper is clickable and starts the
 * build flow that spends it; the rest are listed inert, as the original greys them.
 */

/** One paper as the plans tab lists it: its slot order, name, and whether a click spends it. */
export interface PaperFace {
  readonly paper: Paper;
  readonly label: string;
  readonly usable: boolean;
}

export function paperFace(paper: Paper, label: string): PaperFace {
  return { paper, label, usable: PLACING_PAPER_KINDS.has(paper.kind) };
}

export interface ExtrasPaperRow {
  /** The row's index into the faces the layout was given. */
  readonly index: number;
  readonly label: string;
  readonly usable: boolean;
  /** The row's card slot. */
  readonly rect: Rect;
}

/**
 * The most papers the tab lists, the oldest first. Approximation: the original scrolls its list box;
 * spent papers free their slots for the next find, so the visible rows are the ones to spend first.
 */
export const PAPER_ROWS_SHOWN = 12;

/** Lay the first {@link PAPER_ROWS_SHOWN} faces out as rows of `rowH` from `top`, across `width`. */
export function layoutPaperRows(
  faces: readonly PaperFace[],
  x: number,
  top: number,
  width: number,
  rowH: number,
): ExtrasPaperRow[] {
  return faces.slice(0, PAPER_ROWS_SHOWN).map((face, index) => ({
    index,
    label: face.label,
    usable: face.usable,
    rect: { x, y: top + index * rowH, w: width, h: rowH },
  }));
}
