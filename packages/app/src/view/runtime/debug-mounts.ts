import type { ElevationField, WorldRenderer } from '@open-northland/render';
import type { Command, Simulation } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { ANIMAL_PALETTE_BY_TRIBE } from '../../catalog/animal-roster.js';
import { hasDebugFlag, setDebugFlag } from '../../diag/index.js';
import { createAdminEntityPicker } from '../admin-debug/entity-picker.js';
import { mountAdminDebug } from '../admin-debug/index.js';
import type { CameraController } from '../camera/index.js';
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
}

export function mountDebugOverlays(opts: DebugMountsOptions): GeometryDebugOverlay {
  const { app, canvas, params, sim, renderer } = opts;

  const geometryDebug = createGeometryDebugOverlay({
    enabled: hasDebugFlag(params, GEOMETRY_DEBUG_FLAG),
    buildingsByType: opts.buildingsByType,
    setItems: (items) => renderer.setGeometryDebug(items),
  });

  if (opts.allowWorldEdits === false) return geometryDebug;
  mountAdminDebug({
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
    // Read through the sim's sanctioned accessor, never the live component stores.
    needsEnabled: () => sim.needsEnabled(),
    fogMode: () => sim.fogMode(),
    geometryEnabled: geometryDebug.enabled,
    // Writing the URL back keeps a reload reproducing what is on screen.
    setGeometryEnabled: (enabled) => {
      geometryDebug.setEnabled(enabled);
      // `?debug=` holds a set: a plain `params.set` would clobber an active `profile,trace`.
      setDebugFlag(params, GEOMETRY_DEBUG_FLAG, enabled);
      const search = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${search === '' ? '' : `?${search}`}`,
      );
    },
  });

  return geometryDebug;
}
