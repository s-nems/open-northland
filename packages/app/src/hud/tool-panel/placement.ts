import type { Command } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { PanelContext } from './context.js';
import { createHeldItemBanner } from './held-item-banner.js';

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
   *  on a rejecting tile does nothing (the original: the cursor house is hidden there and the click is
   *  inert), so build mode only ends on a placement that actually lands. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
}

/** Placement mode: pick a building in the menu, then one left-click on buildable ground places and
 *  exits the mode (the original's flow; Esc/right-click abandons). */
export interface PlacementController {
  isActive(): boolean;
  /** The building typeId currently being placed, or null when not in placement — drives the map's
   *  buildable/blocked overlay (the type decides which tiles its footprint fits). */
  activeType(): number | null;
  enter(typeId: number): void;
  cancel(): void;
  /**
   * Route a left-click while placing: on a tile the placement rule accepts, enqueue `placeBuilding` as a
   * construction site (`underConstruction`) and exit build mode (one click = one foundation); on a rejecting
   * or off-map tile the click is consumed but inert (placement claims the canvas until placed or cancelled).
   * The foundation is then raised the original way — builders deliver materials and hammer it up
   * (the ConstructionSystem). Returns true when consumed.
   */
  handleClick(clientX: number, clientY: number): boolean;
  /** Per-frame: re-place the banner text against the live canvas size. */
  placeBanner(): void;
}

/** Build the placement controller: the mode flag, the "klik: postaw, Esc: anuluj" banner, and the drop. */
export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx } = deps;

  let placementType: number | null = null;
  const banner = createHeldItemBanner(ctx, deps.container);

  /** Leave build mode: clear the flag + banner (shared by cancel and a landed placement). */
  const exitPlacement = (): void => {
    placementType = null;
    banner.clear();
  };

  return {
    isActive: () => placementType !== null,
    activeType: () => placementType,
    enter: (typeId): void => {
      placementType = typeId;
      const label = deps.labelByType.get(typeId) ?? `#${typeId}`;
      banner.show(formatMessage(messages().hud.placementHint, { label }));
    },
    cancel: exitPlacement,
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      // Placement claims every click; only one on accepted ground places and exits build mode. A rejected
      // tile is inert, so the mode survives a mis-click on the dimmed wash (Esc / right-click still abandon).
      if (tile !== null && deps.canPlaceAt(placementType, tile.col, tile.row)) {
        deps.enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
          // Place a construction site, not a finished building: the foundation stands at 0% and builders
          // raise it (deliver + hammer). The type's `construction` cost + `hitpoints` (global content) drive it.
          underConstruction: true,
        });
        exitPlacement();
      }
      return true;
    },
    placeBanner: () => banner.place(),
  };
}
