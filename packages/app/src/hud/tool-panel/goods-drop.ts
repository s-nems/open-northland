import type { Command } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { PanelContext } from './context.js';
import { createHeldItemBanner } from './held-item-banner.js';

/** Units dropped per click; repeat clicks on a tile stack up to the sim's ground-stack cap. */
const DROP_AMOUNT = 1;

export interface GoodsDropDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  readonly labelByGood: ReadonlyMap<number, string>;
  readonly enqueue: (command: Command) => void;
  /** Convert a client (CSS) point to a map tile (half-cell node), or `null` off the map. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
}

/**
 * Good-drop mode: each left-click on the map drops a loose pile via `dropGood`, and the mode stays active
 * for further drops until Esc or a right-click ends it.
 */
export interface GoodsDropController {
  isActive(): boolean;
  activeGood(): number | null;
  enter(goodType: number): void;
  cancel(): void;
  /** An off-map click is inert but still consumed: drop mode claims the canvas until cancelled. */
  handleClick(clientX: number, clientY: number): boolean;
  /** Re-place the banner text against the live canvas size; call once per frame. */
  placeBanner(): void;
}

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
      if (tile !== null) {
        deps.enqueue({ kind: 'dropGood', good: goodType, x: tile.col, y: tile.row, amount: DROP_AMOUNT });
        ctx.cue('confirm');
      }
      return true;
    },
    placeBanner: () => banner.place(),
  };
}
