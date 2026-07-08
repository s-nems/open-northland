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
  /** The sim's live placement rule for the held type at a tile (`Simulation.placementProbe`) — a click
   *  on a rejecting tile does NOTHING (the original: the cursor house is hidden there and the click is
   *  inert), so build mode only ends on a placement that actually lands. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
}

/** Placement mode: pick a building in the menu, then ONE left-click on buildable ground places and
 *  exits the mode (the original's flow; Esc/right-click abandons). */
export interface PlacementController {
  isActive(): boolean;
  /** The building typeId currently being placed, or null when not in placement — drives the map's
   *  buildable/blocked overlay (the type decides which tiles its footprint fits). */
  activeType(): number | null;
  enter(typeId: number): void;
  cancel(): void;
  /**
   * Route a left-click while placing: on a tile the placement rule ACCEPTS, enqueue `placeBuilding`
   * and exit build mode (one click = one building — the future construction-site flow extends here);
   * on a rejecting or off-map tile the click is consumed but inert (placement claims the canvas until
   * placed or cancelled). Returns true when consumed.
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

  /** Leave build mode: clear the flag + banner (shared by cancel and a landed placement). */
  const exitPlacement = (): void => {
    placementType = null;
    graphics.clear();
    bannerRun?.destroy();
    bannerRun = null;
  };

  return {
    isActive: () => placementType !== null,
    activeType: () => placementType,
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
    cancel: exitPlacement,
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      // Placement claims every click; only one on ACCEPTED ground places — and then exits build mode
      // (the original's flow: pick → place once → the build UI is gone). A rejected tile is inert, so
      // the mode survives a mis-click on the dimmed wash (Esc / right-click still abandon).
      if (tile !== null && deps.canPlaceAt(placementType, tile.col, tile.row)) {
        deps.enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
        });
        exitPlacement();
      }
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
