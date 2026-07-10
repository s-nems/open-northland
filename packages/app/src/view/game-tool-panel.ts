import type { Camera, ElevationField } from '@vinland/render';
import type { Command } from '@vinland/sim';
import type { Application } from 'pixi.js';
import { localizedBuildingName } from '../catalog/building-i18n.js';
import { vikingBuildingByTypeId } from '../catalog/buildings.js';
import { DEFAULT_UI_LANG } from '../content/gui-gfx.js';
import type { MenuBuildingEntry } from '../hud/tool-panel/building-menu.js';
import type { GameSpeedChangeCause, GameSpeedStateSpec } from '../hud/tool-panel/game-speed.js';
import type { MenuGoodEntry } from '../hud/tool-panel/goods-menu.js';
import { type ToolPanelController, mountToolPanel } from '../hud/tool-panel/index.js';
import { screenScale } from './camera.js';
import { nodeBounds, screenToWorld, worldToTile } from './picking.js';

/**
 * The in-game LEFT tool panel is part of the standard game HUD, not a per-scene feature — so BOTH the map
 * viewer (`entries/map.ts`) and every acceptance scene (`entries/scene.ts`) mount it through this one
 * helper. It wraps {@link mountToolPanel} with the wiring both entries share: the
 * client-point → tile mapping (camera + client→screen scale, null off the map so a stray click never
 * clamp-places). The entry supplies only what differs — the app, canvas, the live camera/sim/enqueue
 * closures, its content's buildings, and how a speed change lands on its loop control.
 */

export interface GameToolPanelDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale (the entry parses `?uiscale=` once and shares it with the unit controls). May be fractional. */
  readonly uiscale: number;
  /** The live camera (read each click to map a screen point to a world tile). */
  readonly camera: () => Camera;
  /** Submit a command into the CURRENT sim (a closure, so it follows a scene restart). */
  readonly enqueue: (command: Command) => void;
  /** The CURRENT sim's placement rule for a type at a tile (a closure over `Simulation.placementProbe`,
   *  so it follows a scene restart) — gates the placement click. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  /** The map bounds — a placement click outside them is rejected (no clamp-to-border). */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field, so a placement click on a lifted hill resolves to the tile drawn
   *  there (elevation-aware inverse). Optional: absent / flat → the plain unlifted inverse. */
  readonly elevation?: ElevationField;
  /** The buildings the menu lists (typeId + label + kind). */
  readonly buildings: readonly MenuBuildingEntry[];
  /** The goods the drop palette lists (goodType + id + label) — the whole content catalog. */
  readonly goods: readonly MenuGoodEntry[];
  /** The tribe whose stats the statistics window shows. */
  readonly tribe: number;
  /** The player a placed building is owned by. */
  readonly owner: number;
  /** UI string language (`pol`/`eng`); defaults to Polish. */
  readonly lang?: string;
  /** Apply a game-speed change to the entry's loop control (drive the fixed-timestep multiplier / pause). */
  readonly onSpeed: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
}

export interface GameToolPanelHandle {
  readonly controller: ToolPanelController;
  /** True when a client point is over the HUD (strip / open window / active placement) — the input router
   *  asks this BEFORE world picking so a HUD click never falls through to unit selection/orders. */
  claimPointer(clientX: number, clientY: number): boolean;
  /** True when a client point is over an OPEN pop-up window (menu / stats) — wired into the camera so
   *  scrolling that window's list never also zooms the world behind it. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** The panel's client-point → map-tile mapping (camera + backing scale + elevation), shared with the
   *  frame loop's build-mode hover so the cursor ghost and the placement click resolve identically. */
  clientToTile(clientX: number, clientY: number): { col: number; row: number } | null;
}

/** The mutable loop control the shared game-view runtime drives (pause flag + tick-rate multiplier). */
export interface LoopSpeedControl {
  paused: boolean;
  speed: number;
}

/**
 * Apply the panel's game-speed spec to an entry's loop control (pause + tick multiplier). Shared so `map`
 * and `scene` wire the panel's `onSpeed` identically. A `'cycle'` (button click) is an explicit speed
 * pick: it sets the multiplier and un-pauses. A `'pause-toggle'` (the `P` key) only flips the pause flag —
 * it must never write the multiplier, or resuming would replace a fractional `?speed=` seed with the
 * button's discrete ×1/×2/×3 (see {@link GameSpeedChangeCause}).
 */
export function applyGameSpeed(
  control: LoopSpeedControl,
  spec: GameSpeedStateSpec,
  cause: GameSpeedChangeCause,
): void {
  control.paused = spec.state === 'paused';
  if (cause === 'cycle' && spec.state !== 'paused') control.speed = spec.tickMultiplier;
}

/**
 * The buildings the menu lists: a content set's own building types, labelled via the viking catalog and
 * localized to `lang` (defaults to the UI default). The English catalog label is the fallback when a
 * language has no authored name (see `catalog/building-i18n.ts`).
 */
export function menuEntriesFromContent(
  content: { buildings: readonly { typeId: number; id: string; kind: string }[] },
  lang: string = DEFAULT_UI_LANG,
): MenuBuildingEntry[] {
  return content.buildings.map((b) => {
    const catalog = vikingBuildingByTypeId(b.typeId);
    const english = catalog?.label ?? b.id;
    return {
      typeId: b.typeId,
      label: localizedBuildingName(catalog?.id ?? b.id, english, lang),
      kind: b.kind,
    };
  });
}

/** The goods the drop palette lists: a content set's own goods (its English `name`, else the id), minus the
 *  `none` sentinel (not a droppable ware). Ordered by the content's own good order. */
export function menuGoodsFromContent(content: {
  goods: readonly { typeId: number; id: string; name?: string | undefined }[];
}): MenuGoodEntry[] {
  return content.goods
    .filter((g) => g.id !== 'none')
    .map((g) => ({ goodType: g.typeId, id: g.id, label: g.name ?? g.id }));
}

/** Mount the game tool panel for one entry, returning its controller + the client→tile map + claim. */
export async function mountGameToolPanel(deps: GameToolPanelDeps): Promise<GameToolPanelHandle> {
  const { uiscale } = deps;

  const clientToTile = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const { sx, sy, rect } = screenScale(deps.canvas, deps.app.renderer.resolution);
    const w = screenToWorld(deps.camera(), (clientX - rect.left) * sx, (clientY - rect.top) * sy);
    const t = worldToTile(w.x, w.y, deps.elevation);
    // worldToTile yields half-cell NODES — bound against the node grid.
    const bounds = nodeBounds(deps.mapSize);
    if (t.col < 0 || t.col >= bounds.width || t.row < 0 || t.row >= bounds.height) return null;
    return { col: t.col, row: t.row };
  };

  const controller = await mountToolPanel({
    app: deps.app,
    canvas: deps.canvas,
    uiscale,
    buildings: deps.buildings,
    goods: deps.goods,
    lang: deps.lang ?? DEFAULT_UI_LANG,
    tribe: deps.tribe,
    owner: deps.owner,
    enqueue: deps.enqueue,
    screenToTile: clientToTile,
    canPlaceAt: deps.canPlaceAt,
    onSpeedChange: deps.onSpeed,
    screenScale: (c) => screenScale(c, deps.app.renderer.resolution),
  });

  return {
    controller,
    claimPointer: (x, y) => controller.claimsPointer(x, y),
    claimsWheel: (x, y) => controller.claimsWheel(x, y),
    clientToTile,
  };
}
