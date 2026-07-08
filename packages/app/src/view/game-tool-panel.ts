import type { Camera, ElevationField, HudPlacement } from '@vinland/render';
import type { Command } from '@vinland/sim';
import type { Application } from 'pixi.js';
import { vikingBuildingByTypeId } from '../catalog/buildings.js';
import type { MenuBuildingEntry } from '../hud/tool-panel/building-menu.js';
import type { GameSpeedStateSpec } from '../hud/tool-panel/game-speed.js';
import { type ToolPanelController, mountToolPanel } from '../hud/tool-panel/index.js';
import { buildToolPanelLayout } from '../hud/tool-panel/layout.js';
import { backingScale } from './camera.js';
import { screenToWorld, worldToTile } from './picking.js';

/**
 * The in-game LEFT tool panel is part of the standard game HUD, not a per-scene feature — so BOTH the live
 * sandbox (`entries/live.ts`) and every acceptance scene (`entries/scene.ts`) mount it through this one
 * helper. It wraps {@link mountToolPanel} with the wiring both entries share: the
 * client-point → tile mapping (camera + backing-store scale, null off the map so a stray click never
 * clamp-places), and the HUD right-shift that clears the strip. The entry supplies only what differs — the
 * app, canvas, the live camera/sim/enqueue closures, its content's buildings, and how a speed change lands
 * on its loop control.
 */

/** How far (px) to gap the always-on stocks HUD from the strip's right edge when shifting it clear. */
const HUD_GAP = 6;

export interface GameToolPanelDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Integer UI scale (the entry parses `?uiscale=` once and shares it with the unit controls). */
  readonly uiscale: number;
  /** The live camera (read each click to map a screen point to a world tile). */
  readonly camera: () => Camera;
  /** Submit a command into the CURRENT sim (a closure, so it follows a scene restart). */
  readonly enqueue: (command: Command) => void;
  /** The map bounds — a placement click outside them is rejected (no clamp-to-border). */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field, so a placement click on a lifted hill resolves to the tile drawn
   *  there (elevation-aware inverse). Optional: absent / flat → the plain unlifted inverse. */
  readonly elevation?: ElevationField;
  /** The buildings the menu lists (typeId + label + kind). */
  readonly buildings: readonly MenuBuildingEntry[];
  /** The tribe whose stats the statistics window shows. */
  readonly tribe: number;
  /** The player a placed building is owned by. */
  readonly owner: number;
  /** UI string language (`pol`/`eng`); defaults to Polish. */
  readonly lang?: string;
  /** Apply a game-speed change to the entry's loop control (drive the fixed-timestep multiplier / pause). */
  readonly onSpeed: (spec: GameSpeedStateSpec) => void;
}

export interface GameToolPanelHandle {
  readonly controller: ToolPanelController;
  /** px to shift the always-on stocks HUD right so it sits beside the strip instead of under it. */
  readonly hudShift: number;
  /** True when a client point is over the HUD (strip / open window / active placement) — the input router
   *  asks this BEFORE world picking so a HUD click never falls through to unit selection/orders. */
  claimPointer(clientX: number, clientY: number): boolean;
}

/** The mutable loop control both entries drive (a subset — `scene` also carries `stepOnce`). */
export interface LoopSpeedControl {
  paused: boolean;
  speed: number;
}

/**
 * Apply the panel's game-speed spec to an entry's loop control (pause + tick multiplier). Shared so `live`
 * and `scene` wire the panel's `onSpeed` identically: a `paused` spec pauses the loop; any running spec sets
 * the multiplier (and un-pauses).
 */
export function applyGameSpeed(control: LoopSpeedControl, spec: GameSpeedStateSpec): void {
  control.paused = spec.state === 'paused';
  if (spec.state !== 'paused') control.speed = spec.tickMultiplier;
}

/** The buildings the menu lists: a content set's own building types, labelled via the viking catalog. */
export function menuEntriesFromContent(content: {
  buildings: readonly { typeId: number; id: string; kind: string }[];
}): MenuBuildingEntry[] {
  return content.buildings.map((b) => ({
    typeId: b.typeId,
    label: vikingBuildingByTypeId(b.typeId)?.label ?? b.id,
    kind: b.kind,
  }));
}

/** Shift a HUD placement right by `dx` px (0 is a no-op) — used to clear the left tool-panel strip. */
export function shiftHud(p: HudPlacement, dx: number): HudPlacement {
  if (dx === 0) return p;
  return { ...p, panelX: p.panelX + dx, rows: p.rows.map((r) => ({ ...r, x: r.x + dx })) };
}

/** Mount the game tool panel for one entry, returning its controller + the derived HUD shift + start speed. */
export async function mountGameToolPanel(deps: GameToolPanelDeps): Promise<GameToolPanelHandle> {
  const { uiscale } = deps;
  const hudShift = buildToolPanelLayout(uiscale).width + HUD_GAP;

  const clientToTile = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const { sx, sy, rect } = backingScale(deps.canvas);
    const w = screenToWorld(deps.camera(), (clientX - rect.left) * sx, (clientY - rect.top) * sy);
    const t = worldToTile(w.x, w.y, deps.elevation);
    if (t.col < 0 || t.col >= deps.mapSize.width || t.row < 0 || t.row >= deps.mapSize.height) return null;
    return { col: t.col, row: t.row };
  };

  const controller = await mountToolPanel({
    app: deps.app,
    canvas: deps.canvas,
    uiscale,
    buildings: deps.buildings,
    lang: deps.lang ?? 'pol',
    tribe: deps.tribe,
    owner: deps.owner,
    enqueue: deps.enqueue,
    screenToTile: clientToTile,
    onSpeedChange: deps.onSpeed,
    backingScale,
  });

  return {
    controller,
    hudShift,
    claimPointer: (x, y) => controller.claimsPointer(x, y),
  };
}
