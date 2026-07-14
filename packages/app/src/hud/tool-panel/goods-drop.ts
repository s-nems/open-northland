import type { Command } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { PanelContext } from './context.js';
import { createHeldItemBanner } from './held-item-banner.js';

/** Units dropped per click — one, so each click adds a single unit to the pile on that tile (the sim stacks
 *  repeat clicks up to its ground-stack cap). Click the same tile again to grow the heap. */
const DROP_AMOUNT = 1;

export interface GoodsDropDeps {
  readonly ctx: PanelContext;
  /** The banner container (drawn over the windows). */
  readonly container: Container;
  /** goodType → display label for the banner text. */
  readonly labelByGood: ReadonlyMap<number, string>;
  /** Submit the `dropGood` command (the one-way seam). */
  readonly enqueue: (command: Command) => void;
  /** Convert a client (CSS) point to a map tile (half-cell node), or `null` off the map. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
}

/**
 * Good-drop mode: pick a good in the palette, then each left-click on the map drops a loose pile of it there
 * (via the `dropGood` command) — the mode stays active so many piles drop in a row (Esc / right-click ends).
 * This differs from building placement (one click = one building, then the mode exits); the two controllers
 * stay separate because their click semantics differ, though both draw a "what's held" banner.
 */
export interface GoodsDropController {
  isActive(): boolean;
  /** The good currently held for dropping, or null when not in drop mode. */
  activeGood(): number | null;
  enter(goodType: number): void;
  cancel(): void;
  /** Route a left-click while dropping: an in-bounds tile drops a pile and keeps the mode; off-map is inert
   *  but still consumed (drop mode claims the canvas until cancelled). Returns true when consumed. */
  handleClick(clientX: number, clientY: number): boolean;
  /** Per-frame: re-place the banner text against the live canvas size. */
  placeBanner(): void;
}

/** Build the good-drop controller: the mode flag, the "klik: połóż, Esc: koniec" banner, and the drop. */
export function createGoodsDropController(deps: GoodsDropDeps): GoodsDropController {
  const { ctx } = deps;

  let goodType: number | null = null;
  const banner = createHeldItemBanner(ctx, deps.container);

  const exitDrop = (): void => {
    goodType = null;
    banner.clear();
  };

  return {
    isActive: () => goodType !== null,
    activeGood: () => goodType,
    enter: (type): void => {
      goodType = type;
      const label = deps.labelByGood.get(type) ?? `#${type}`;
      banner.show(formatMessage(messages().hud.dropHint, { label }));
    },
    cancel: exitDrop,
    handleClick: (clientX, clientY): boolean => {
      if (goodType === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      // Every click is claimed; an in-bounds tile drops a pile and the mode stays (drop many). Off-map is
      // inert (Esc / right-click still ends the mode).
      if (tile !== null) {
        deps.enqueue({ kind: 'dropGood', good: goodType, x: tile.col, y: tile.row, amount: DROP_AMOUNT });
      }
      return true;
    },
    placeBanner: () => banner.place(),
  };
}
