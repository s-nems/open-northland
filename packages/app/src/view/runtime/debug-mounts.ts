import type { ElevationField, WorldRenderer } from '@open-northland/render';
import type { Command, Simulation } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { ANIMAL_PALETTE_BY_TRIBE } from '../../catalog/animal-roster.js';
import { hasDebugFlag, setDebugFlag } from '../../diag/index.js';
import { vehicleLabel } from '../../game/technology.js';
import { createAdminEntityPicker } from '../admin-debug/entity-picker.js';
import { type AdminDebugHandle, mountAdminDebug } from '../admin-debug/index.js';
import type { CameraController } from '../camera/index.js';
import type { PerfOverlayHandle } from '../perf-overlay.js';
import {
  createGeometryDebugOverlay,
  type GeometryBuildingInfo,
  type GeometryDebugOverlay,
} from '../projections/index.js';

/** The `?debug=` value that turns on the building-geometry diagram. */
export const GEOMETRY_DEBUG_FLAG = 'geometry';

export interface DebugMountsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  readonly sim: Simulation;
  readonly renderer: WorldRenderer;
  readonly cameraCtl: CameraController;
  readonly perf: PerfOverlayHandle;
  readonly initialToolsEnabled: boolean;
  /** The admin chip's top edge in client px, under the HUD's top-right bar. */
  readonly paletteTop: number;
  readonly elevation?: ElevationField;
  readonly buildingsByType: ReadonlyMap<number, GeometryBuildingInfo>;
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The trusted admin channel: every debug poke is a world edit, not a seat's order. */
  readonly enqueue: (command: Command) => void;
  readonly allowWorldEdits?: boolean;
  /** The composed HUD claim an admin spawn click must defer to. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** The localized good name by sim goodType. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** Owner slot to its roster tribe, so a spawned settler can work the buildings that slot raises. */
  readonly seatTribeOf: (player: number) => number;
  /** Hand the HUD's wall line tool a standing-wall line for `owner`; false when it cannot take one. */
  readonly enterStandingWall?: (owner: number, tribe: number) => boolean;
}

export interface DebugMounts {
  readonly geometryDebug: GeometryDebugOverlay;
  /** Shows or hides the stats readout, the admin palette and its geometry grid together, as the one
   *  settings toggle. */
  setToolsEnabled(enabled: boolean): void;
  /** Hide the readout and the palette with the rest of the HUD, leaving the tools switched on. */
  setHudHidden(hidden: boolean): void;
  placePalette(top: number): void;
  /** Tear the palette's listeners and DOM down with the world that mounted it. */
  dispose(): void;
}

export function mountDebugOverlays(opts: DebugMountsOptions): DebugMounts {
  const { params, renderer } = opts;

  const geometryDebug = createGeometryDebugOverlay({
    enabled: hasDebugFlag(params, GEOMETRY_DEBUG_FLAG),
    buildingsByType: opts.buildingsByType,
    setItems: (items) => renderer.setGeometryDebug(items),
  });
  // Writing the URL back keeps a reload reproducing what is on screen.
  const setGeometryEnabled = (enabled: boolean): void => {
    geometryDebug.setEnabled(enabled);
    // `?debug=` holds a set: a plain `params.set` would clobber an active `profile,trace`.
    setDebugFlag(params, GEOMETRY_DEBUG_FLAG, enabled);
    const search = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${search === '' ? '' : `?${search}`}`);
  };

  // Built on the first enable, so a player who never turns the tools on pays nothing for it.
  let admin: AdminDebugHandle | null = null;
  let toolsEnabled = false;
  let hudHidden = false;
  let paletteTop = opts.paletteTop;
  const setToolsEnabled = (enabled: boolean): void => {
    toolsEnabled = enabled;
    opts.perf.setVisible(enabled && !hudHidden);
    if (!enabled) {
      admin?.setVisible(false);
      // The grid's only switch is on the palette, so it must not outlive it.
      if (admin !== null && geometryDebug.enabled()) setGeometryEnabled(false);
      return;
    }
    if (opts.allowWorldEdits === false) return;
    admin ??= mountAdminPalette(opts, geometryDebug, setGeometryEnabled, paletteTop);
    admin.setVisible(!hudHidden);
  };
  setToolsEnabled(opts.initialToolsEnabled);

  return {
    geometryDebug,
    setToolsEnabled,
    setHudHidden: (hidden) => {
      hudHidden = hidden;
      opts.perf.setVisible(toolsEnabled && !hidden);
      admin?.setVisible(toolsEnabled && !hidden);
    },
    placePalette: (top) => {
      paletteTop = top;
      admin?.place(top);
    },
    dispose: () => {
      admin?.dispose();
      admin = null;
    },
  };
}

function mountAdminPalette(
  opts: DebugMountsOptions,
  geometryDebug: GeometryDebugOverlay,
  setGeometryEnabled: (enabled: boolean) => void,
  top: number,
): AdminDebugHandle {
  const { app, canvas, sim, renderer } = opts;
  return mountAdminDebug({
    canvas,
    enqueue: opts.enqueue,
    clientToTile: (x, y) => opts.clientToTile(x, y),
    // A viewport-bounded pass over every owner, rebuilt per click rather than cached like the
    // per-frame hover set.
    pickEntity: createAdminEntityPicker({
      app,
      sim,
      renderer,
      camera: opts.cameraCtl,
      toScreen: opts.clientToScreen,
      ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    }),
    claimPointer: (x, y) => opts.claimPointer(x, y),
    goodLabel: (typeId) => opts.goodLabel(typeId),
    seatTribeOf: (player) => opts.seatTribeOf(player),
    ...(opts.enterStandingWall !== undefined ? { enterStandingWall: opts.enterStandingWall } : {}),
    goods: sim.content.goods.map((g) => ({ good: g.typeId, id: g.id })),
    // Skips decorative swarms (hitpoints 0) and species with no body in the render roster; first-wins
    // dedup matches the sim's `animalRecord` read, so a listed entry is the record a spawn consumes.
    animals: sim.content.animals
      .filter(
        (a, i) =>
          a.hitpointsAdult > 0 &&
          ANIMAL_PALETTE_BY_TRIBE.has(a.tribeType) &&
          sim.content.animals.findIndex((b) => b.tribeType === a.tribeType) === i,
      )
      .map((a) => ({
        tribe: a.tribeType,
        id: sim.content.tribes.find((t) => t.typeId === a.tribeType)?.id ?? a.id,
      }))
      .sort((a, b) => a.tribe - b.tribe),
    // The content's own row order, which keeps the carts together ahead of the ships.
    vehicles: sim.content.vehicles.map((v) => ({
      vehicleType: v.typeId,
      label: vehicleLabel(sim.content, v.typeId) ?? v.id,
    })),
    // Read through the sim's sanctioned accessor, never the live component stores.
    needsEnabled: () => sim.needsEnabled(),
    fogMode: () => sim.fogMode(),
    geometryEnabled: geometryDebug.enabled,
    setGeometryEnabled,
    top,
  });
}
