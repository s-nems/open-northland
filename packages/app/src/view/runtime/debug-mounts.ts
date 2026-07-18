import type { ElevationField, WorldRenderer } from '@open-northland/render';
import type { Simulation } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { createAdminEntityPicker } from '../admin-debug/entity-picker.js';
import { mountAdminDebug } from '../admin-debug/index.js';
import type { CameraController } from '../camera/index.js';
import {
  createGeometryDebugOverlay,
  type GeometryBuildingInfo,
  type GeometryDebugOverlay,
} from '../projections/index.js';

/** The `?debug=` value that turns on the building-geometry diagram. */
const GEOMETRY_DEBUG_FLAG = 'geometry';

export interface DebugMountsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  readonly sim: Simulation;
  readonly renderer: WorldRenderer;
  readonly cameraCtl: CameraController;
  readonly elevation?: ElevationField;
  /** The shared building index (also drives the door badges). */
  readonly buildingsByType: ReadonlyMap<number, GeometryBuildingInfo>;
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The composed HUD claim an admin spawn click must defer to. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** The localized good name by sim goodType (the spawn palette's labels). */
  readonly goodLabel: (typeId: number) => string | undefined;
}

/**
 * Mount the two developer overlays and return the geometry handle the frame loop ticks: the
 * `?debug=geometry` building diagram, and the admin/debug spawn palette that can toggle it live.
 */
export function mountDebugOverlays(opts: DebugMountsOptions): GeometryDebugOverlay {
  const { app, canvas, params, sim, renderer } = opts;

  const geometryDebug = createGeometryDebugOverlay({
    enabled: params.get('debug') === GEOMETRY_DEBUG_FLAG,
    buildingsByType: opts.buildingsByType,
    setItems: (items) => renderer.setGeometryDebug(items),
  });

  // The admin/debug spawn palette (a hidden panel behind a top toggle button): click-to-spawn any unit
  // or resource for any player through the sim command seam, for hands-on combat/economy testing. Its
  // spawn clicks resolve tiles + defer to the same composed HUD claim the unit controls use (tool-panel
  // strip/windows plus the settler action ring), and it runs before the RTS controls (a window-capture
  // press) so arming never also selects a unit.
  mountAdminDebug({
    canvas,
    enqueue: (command) => sim.enqueue(command),
    clientToTile: (x, y) => opts.clientToTile(x, y),
    // Pick the top entity of a kind under a client point for the action tools (kill/needs/fill/finish).
    // A screen-bounded pass — buildSpriteScene is culled to the camera viewport (golden rule 6), pinned to
    // solid pixels for buildings like the RTS controls — but over all owners (an enemy is killable),
    // rebuilt per click (rare) rather than cached like the per-frame hover set.
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
    // The droppable-goods palette is the running content's own goods (sandbox on a bare checkout, the real
    // extracted goods on a scene/map) — the one source, so every listed good actually drops.
    goods: sim.content.goods.map((g) => ({ good: g.typeId, id: g.id })),
    // The needs-toggle button's live state (scenes boot it off, maps on) — read through the sim's
    // sanctioned read accessor (the placementProbe pattern), never the live component stores.
    needsEnabled: () => sim.needsEnabled(),
    fogMode: () => sim.fogMode(),
    geometryEnabled: geometryDebug.enabled,
    // The live toggle keeps the URL honest, so a reload reproduces what is on screen.
    setGeometryEnabled: (enabled) => {
      geometryDebug.setEnabled(enabled);
      if (enabled) params.set('debug', GEOMETRY_DEBUG_FLAG);
      else params.delete('debug');
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
