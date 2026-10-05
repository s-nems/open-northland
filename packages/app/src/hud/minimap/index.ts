import {
  type Camera,
  cameraViewport,
  type MinimapFeature,
  type SceneTerrain,
  terrainWorldBounds,
} from '@open-northland/render';
import type { DiplomacyState, FogView, HalfCellNode, WorldSnapshot } from '@open-northland/sim';
import { type Application, BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { setMinimapReserve } from '../dom/minimap-reserve.js';
import type { Rect } from '../geometry.js';
import type { MapOverlayControls } from '../map-overlays.js';
import { createAlarmLayer } from './alarms.js';
import { createWorkerMinimapBaker } from './bake.js';
import { createMinimapChrome } from './chrome.js';
import { forEachMinimapDot, type MinimapDotContext, type MinimapDotSink } from './dots.js';
import {
  DEFAULT_MINIMAP_FILTERS,
  type MinimapFilters,
  toggleMinimapLayer,
  withAllMinimapLayers,
} from './filters.js';
import { createFogMaskLayer } from './fog-mask.js';
import type { MinimapFrame } from './frames.js';
import { createGoalMarks, type GoalNode } from './goal-marks.js';
import { createMinimapInput } from './input.js';
import {
  type MinimapSize,
  minimapLayout,
  pointOverMinimap,
  viewportRectOnMinimap,
  visibleMinimapRect,
  zoomMinimapLayout,
} from './model.js';
import { createDotReplotGate } from './replot-gate.js';
import { createRoadLayer } from './road-layer.js';
import { MARKER_SIZE_SCALES, stampMark } from './stamps.js';
import { createMinimapSurface } from './surface.js';

const NO_GOALS: readonly GoalNode[] = [];

/** Under the map while the DOM backing loads: the dark wood of the frames' backing. */
const BACKDROP_COLOUR = 0x2a2018;

export interface MinimapOptions {
  readonly overlays?: MapOverlayControls;
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly plane: HTMLElement;
  readonly terrain: SceneTerrain;
  readonly cellColours?: Uint32Array | undefined;
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** The feature a standing node of each sim good type draws as on the ground. */
  readonly featureOfGoodType: ReadonlyMap<number, MinimapFeature>;
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** The stored layer, owner, marker and ground choices; they persist through `onFiltersChange`. */
  readonly filters?: MinimapFilters | undefined;
  readonly onFiltersChange?: ((filters: MinimapFilters) => void) | undefined;
  readonly isFighterJob: (jobType: number) => boolean;
  /** The seat the view shows, null on a whole-map view. */
  readonly viewer: () => number | null;
  /** The viewer seat's stance toward `owner`. */
  readonly stanceToward: (owner: number) => DiplomacyState;
  readonly uiscale: number;
  readonly frame: MinimapFrame;
  readonly camera: () => Camera;
  readonly onJump: (worldX: number, worldY: number) => void;
  readonly onOrder?: (worldX: number, worldY: number, event: MouseEvent) => boolean;
  readonly toScreenPx: (clientX: number, clientY: number) => { x: number; y: number };
}

export interface MinimapHandle {
  claimsPointer(clientX: number, clientY: number): boolean;
  dragging(): boolean;
  panelRect(): Rect | null;
  /** `lostGoals` are the selected lost settlers' refused goals, marked over the dots. */
  update(snapshot: WorldSnapshot, fog?: FogView | null, lostGoals?: readonly GoalNode[]): void;
  /** Ring an attack at half-cell node `at`. */
  ping(at: HalfCellNode): void;
  setHidden(hidden: boolean): void;
  setUiScale(uiscale: number): Promise<void>;
  setFrame(frame: MinimapFrame): void;
  dispose(): void;
}

/** The retained whole-map layers share one transform and one clip, including the fog. */
export async function mountMinimap(opts: MinimapOptions): Promise<MinimapHandle> {
  const { app, terrain, plane } = opts;
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  let uiScale = opts.uiscale;
  let size: MinimapSize = 'm';
  let zoom = 1;
  let center = { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };
  let zoomFocus = center;
  let filters: MinimapFilters = opts.filters ?? DEFAULT_MINIMAP_FILTERS;
  let hidden = false;
  let hasSeat = opts.viewer() !== null;
  let dirtyDots = true;
  let base = minimapLayout(bounds, app.screen.height, uiScale, size, app.screen.width);
  let layout = zoomMinimapLayout(base, bounds, zoom, center);

  const container = new Container();
  container.zIndex = 1000;
  const backdrop = new Graphics();
  const world = new Container();
  const clip = new Graphics();
  const view = new Graphics();
  const goalGraphics = new Graphics();
  container.addChild(backdrop, world, clip, view, goalGraphics);
  const goalMarks = createGoalMarks(goalGraphics);
  world.mask = clip;
  app.stage.addChild(container);
  // Fixed raster space avoids terrain uploads during resize, zoom and pan.
  const rasterScale = 660 / Math.max(bounds.width, bounds.height);
  const raster: Rect = {
    x: 0,
    y: 0,
    w: bounds.width * rasterScale,
    h: bounds.height * rasterScale,
  };
  const surface = createMinimapSurface({
    container: world,
    terrain,
    cellColours: opts.cellColours,
    colourOf: opts.colourOf,
    featureOfGoodType: opts.featureOfGoodType,
    map: raster,
    resolution: () => app.renderer.resolution,
    shownWidth: () => layout.map.w,
    baker: createWorkerMinimapBaker,
    groundMode: () => filters.ground,
    now: () => performance.now(),
  });
  const fogMask = createFogMaskLayer(world, raster);
  // The half-cell lattice is two nodes per cell across.
  const roads = createRoadLayer(world, raster, { bounds, scale: rasterScale, nodeWidth: 2 * terrain.width });
  const dotsW = Math.max(1, Math.round(raster.w));
  const dotsH = Math.max(1, Math.round(raster.h));
  const pixels = new Uint8Array(dotsW * dotsH * 4);
  const texture = new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: dotsW,
      height: dotsH,
      scaleMode: 'nearest',
    }),
  });
  const dots = new Sprite(texture);
  dots.width = raster.w;
  dots.height = raster.h;
  world.addChild(dots);
  const alarms = createAlarmLayer(world, bounds, rasterScale);

  const zoomAt = (delta: number, anchor?: { x: number; y: number }): void => {
    const next = Math.max(1, Math.min(4, zoom * 2 ** (delta / 2)));
    if (next === zoom) return;
    if (anchor !== undefined) {
      center = {
        x: anchor.x + ((center.x - anchor.x) * zoom) / next,
        y: anchor.y + ((center.y - anchor.y) * zoom) / next,
      };
    } else {
      if (zoom === 1) {
        const vp = cameraViewport(opts.camera(), app.screen.width, app.screen.height);
        zoomFocus = { x: (vp.minX + vp.maxX) / 2, y: (vp.minY + vp.maxY) / 2 };
      }
      center = zoomFocus;
    }
    // Remember the requested focus even when a low zoom must clamp it away from a map edge.
    zoomFocus = center;
    zoom = next;
    dirtyDots = true;
    refreshLayout();
  };
  const chrome = createMinimapChrome(
    plane,
    {
      onZoom: (delta) => zoomAt(delta),
      onReset: () => {
        zoom = 1;
        dirtyDots = true;
        refreshLayout();
      },
      onSize: () => {
        size = size === 's' ? 'm' : size === 'm' ? 'l' : size === 'l' ? 'xl' : 's';
        dirtyDots = true;
        refreshLayout();
      },
      onLayer: (layer) => setFilters(toggleMinimapLayer(filters, layer)),
      onAllLayers: (shown) => setFilters(withAllMinimapLayers(filters, shown)),
      onScope: (scope) => setFilters({ ...filters, scope }),
      onGround: (ground) => setFilters({ ...filters, ground }),
      onMarkerSize: (markerSize) => setFilters({ ...filters, markerSize }),
      onColours: (colours) => setFilters({ ...filters, colours }),
    },
    opts.frame,
    opts.overlays,
  );
  function setFilters(next: MinimapFilters): void {
    filters = next;
    dirtyDots = true;
    chrome.setState({ size, zoom, filters, hasSeat });
    opts.onFiltersChange?.(next);
  }
  let lastPanel = '';
  let lastView = '';
  let screenKey = '';
  function refreshLayout(): void {
    screenKey = `${app.screen.width},${app.screen.height}`;
    base = minimapLayout(bounds, app.screen.height, uiScale, size, app.screen.width);
    layout = zoomMinimapLayout(base, bounds, zoom, center);
    // Keep the effective clamped center: reversing a drag at the boundary moves immediately.
    if (layout.scaleX > 0 && layout.scaleY > 0)
      center = {
        x: bounds.minX + (base.map.x + base.map.w / 2 - layout.map.x) / layout.scaleX,
        y: bounds.minY + (base.map.y + base.map.h / 2 - layout.map.y) / layout.scaleY,
      };
    const key = `${base.panel.x},${base.panel.y},${base.panel.w},${base.panel.h},${uiScale}`;
    if (key !== lastPanel) {
      lastPanel = key;
      const { inner } = base;
      backdrop.clear().rect(inner.x, inner.y, inner.w, inner.h).fill(BACKDROP_COLOUR);
      clip.clear().rect(inner.x, inner.y, inner.w, inner.h).fill(0xffffff);
      setMinimapReserve(plane, hidden ? null : base.panel, uiScale);
      dirtyDots = true;
    }
    chrome.setLayout(base.panel, visibleMinimapRect(layout), uiScale);
    world.position.set(layout.map.x, layout.map.y);
    world.scale.set(layout.map.w / raster.w, layout.map.h / raster.h);
    const visible = !hidden && layout.scaleX > 0 && layout.scaleY > 0;
    container.visible = visible;
    chrome.setHidden(!visible);
    chrome.setState({ zoom, size, filters, hasSeat });
  }
  refreshLayout();
  const input = createMinimapInput({
    canvas: opts.canvas,
    bounds,
    layout: () => layout,
    enabled: () => !hidden && layout.scaleX > 0 && layout.scaleY > 0,
    toScreenPx: opts.toScreenPx,
    onJump: opts.onJump,
    ...(opts.onOrder === undefined ? {} : { onOrder: opts.onOrder }),
    onZoom: zoomAt,
    onPan: (dx, dy) => {
      center = { x: center.x + dx, y: center.y + dy };
      refreshLayout();
      zoomFocus = center;
    },
  });
  const claimDotReplot = createDotReplotGate(() => performance.now());
  const dotRaster = { rgba: pixels, width: dotsW, height: dotsH };
  const stampScale = (): number => uiScale / world.scale.x;
  const stamp: MinimapDotSink = (x, y, mark, colour, part) =>
    stampMark(dotRaster, x, y, mark, colour, stampScale(), MARKER_SIZE_SCALES[filters.markerSize], part);

  return {
    claimsPointer: (x, y) => {
      if (hidden) return false;
      const point = opts.toScreenPx(x, y);
      return pointOverMinimap(layout, point.x, point.y);
    },
    dragging: input.dragging,
    panelRect: () =>
      hidden ? null : minimapLayout(bounds, app.screen.height, uiScale, size, app.screen.width).panel,
    update: (snapshot, fog = null, lostGoals = NO_GOALS) => {
      if (hidden) return;
      if (screenKey !== `${app.screen.width},${app.screen.height}`) refreshLayout();
      if (layout.scaleX <= 0 || layout.scaleY <= 0) {
        view.clear();
        lastView = '';
        goalMarks.clear();
        return;
      }
      surface.sync(snapshot, fog);
      fogMask.draw(fog);
      const viewer = opts.viewer();
      // A spectator can switch between watching a seat and the whole map.
      if ((viewer !== null) !== hasSeat) {
        hasSeat = viewer !== null;
        chrome.setState({ zoom, size, filters, hasSeat });
      }
      if (claimDotReplot(snapshot, fog?.player ?? viewer) || dirtyDots) {
        roads.draw(snapshot, fog, filters.layers.roads, stampScale());
        pixels.fill(0);
        const context: MinimapDotContext = {
          fog,
          bounds,
          scale: rasterScale,
          filters,
          isFighterJob: opts.isFighterJob,
          viewer,
          stanceToward: opts.stanceToward,
          playerColourOf: opts.playerColourOf,
        };
        forEachMinimapDot(snapshot, context, stamp);
        texture.source.update();
        dirtyDots = false;
      }
      alarms.draw(performance.now(), stampScale());
      const rect = viewportRectOnMinimap(
        layout,
        bounds,
        cameraViewport(opts.camera(), app.screen.width, app.screen.height),
      );
      const key = rect === null ? '' : `${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (key !== lastView) {
        lastView = key;
        view.clear();
        if (rect !== null)
          view.rect(rect.x, rect.y, rect.w, rect.h).stroke({ width: 1.25, color: 0xfff5d6, alpha: 0.95 });
      }
      goalMarks.draw(layout, bounds, lostGoals, uiScale);
    },
    ping: (at) => alarms.add(at, performance.now()),
    setHidden: (next) => {
      hidden = next;
      container.visible = !next && layout.scaleX > 0 && layout.scaleY > 0;
      chrome.setHidden(!container.visible);
      input.cancel();
      setMinimapReserve(plane, next ? null : base.panel, uiScale);
    },
    setUiScale: async (next) => {
      uiScale = next;
      refreshLayout();
    },
    setFrame: (frame) => chrome.setFrame(frame),
    dispose: () => {
      input.dispose();
      chrome.dispose();
      setMinimapReserve(plane, null, uiScale);
      surface.dispose();
      fogMask.dispose();
      roads.dispose();
      container.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
