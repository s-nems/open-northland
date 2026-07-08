import type { Command } from '@vinland/sim';
import { type Container, Graphics } from 'pixi.js';
import type { TextRun } from '../bitmap-text.js';
import { WIN_PAD, WIN_TITLE_H, drawWindowPanel } from '../chrome.js';
import type { PanelContext } from './context.js';

/** Placement banner width (design px) — fits "<label> - klik: postaw, Esc: anuluj" in font10. */
const BANNER_WIDTH = 260;
/** Banner top offset + text inset (design px). */
const BANNER_OFFSET_Y = 2;
const BANNER_TEXT_INSET_Y = 3;

export interface PlacementDeps {
  readonly ctx: PanelContext;
  /** The panel's banner container (drawn over the windows). */
  readonly container: Container;
  /** typeId → display label for the banner text. */
  readonly labelByType: ReadonlyMap<number, string>;
  /** Submit the `placeBuilding` command (the one-way seam). */
  readonly enqueue: (command: Command) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map — the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
}

/** Placement mode: pick a building in the menu, then every left-click drops one until Esc/right-click. */
export interface PlacementController {
  isActive(): boolean;
  enter(typeId: number): void;
  cancel(): void;
  /**
   * Route a left-click while placing: enqueue `placeBuilding` at the clicked tile (a click off the map
   * is still consumed — placement claims the canvas until cancelled). Returns true when consumed.
   */
  handleClick(clientX: number, clientY: number): boolean;
  /** Per-frame: re-place the banner text against the live canvas size. */
  placeBanner(): void;
}

/** Build the placement controller: the mode flag, the "klik: postaw, Esc: anuluj" banner, and the drop. */
export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx } = deps;
  const { scale } = ctx;

  let placementType: number | null = null;
  const graphics = new Graphics();
  deps.container.addChild(graphics);
  let bannerRun: TextRun | null = null;

  const bannerX = (): number => ctx.layout.width + WIN_PAD * scale;

  return {
    isActive: () => placementType !== null,
    enter: (typeId): void => {
      placementType = typeId;
      graphics.clear();
      bannerRun?.destroy();
      const label = deps.labelByType.get(typeId) ?? `#${typeId}`;
      const rect = {
        x: bannerX(),
        y: BANNER_OFFSET_Y * scale,
        w: BANNER_WIDTH * scale,
        h: (WIN_TITLE_H + WIN_PAD) * scale,
      };
      drawWindowPanel(graphics, rect, scale);
      bannerRun = ctx.makeText(`${label} - klik: postaw, Esc: anuluj`, 'white');
      deps.container.addChild(bannerRun.container);
      const { width: rw, height: rh } = ctx.screen();
      bannerRun.place(rect.x + WIN_PAD * scale, rect.y + BANNER_TEXT_INSET_Y * scale, scale, rw, rh);
    },
    cancel: (): void => {
      placementType = null;
      graphics.clear();
      bannerRun?.destroy();
      bannerRun = null;
    },
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      if (tile !== null) {
        deps.enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
        });
      }
      // Placement claims the click whether or not the tile is on-map; stay in placement for repeats
      // (Esc / right-click / the Buildings button exit).
      return true;
    },
    // NOTE the old code inset the text by WIN_PAD on enter but dropped the inset in its per-frame
    // re-place (the visible position) — unified here on the inset version, a ~6px banner-text fix.
    placeBanner: (): void => {
      if (bannerRun === null) return;
      const { width: rw, height: rh } = ctx.screen();
      bannerRun.place(
        bannerX() + WIN_PAD * scale,
        (BANNER_OFFSET_Y + BANNER_TEXT_INSET_Y) * scale,
        scale,
        rw,
        rh,
      );
    },
  };
}
