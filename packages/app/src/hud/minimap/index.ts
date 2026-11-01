import {
  type Camera,
  cameraViewport,
  type MinimapFeature,
  type RememberedMarkers,
  type SceneTerrain,
  type SeenRoadNetwork,
  terrainWorldBounds,
  type WorldBounds,
} from '@open-northland/render';
import type { DiplomacyState, FogView, HalfCellNode, WorldSnapshot } from '@open-northland/sim';
import { type Application, BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { setMinimapReserve } from '../dom/minimap-reserve.js';
import type { Rect } from '../geometry.js';
import type { MapOverlayControls } from '../map-overlays.js';
import { createAlarmLayer } from './alarms.js';
import { createWorkerMinimapBaker } from './bake.js';
import { createMinimapChrome } from './chrome.js';
import { MinimapDotPlot, type MinimapDotSink } from './dots.js';
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
  type MinimapLayout,
  type MinimapSize,
  minimapLayout,
  nextMinimapSize,
  overviewLayout,
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
/** How far the overview dims the world around its frame. */
const OVERVIEW_SCRIM_ALPHA = 0.55;
/** Wall-clock ms a frame may spend walking a dot plot. A late map's plot costs several ms on a fast
 *  machine and several times that on a weak one, so it spreads over frames into a back raster and shows
 *  whole when done, instead of stalling the frame that starts it. */
const DOT_PLOT_MS_PER_FRAME = 1;

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
  readonly isHeroJob: (jobType: number) => boolean;
  /** The world view's remembered buildings and vehicles on explored ground. */
  readonly fogMemory?: RememberedMarkers | undefined;
  /** The road network as the world view draws it. */
  readonly roads: SeenRoadNetwork;
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
  /** The button over the frame was pressed. */
  readonly onOverviewButton: () => void;
}

/** Where the map stands on the screen, for what is drawn over it; a new `layout` object means it moved. */
export interface MinimapPlacement {
  readonly layout: MinimapLayout;
  readonly bounds: WorldBounds;
}

export interface MinimapHandle {
  claimsPointer(clientX: number, clientY: number): boolean;
  dragging(): boolean;
  /** `lostGoals` are the selected lost settlers' refused goals, marked over the dots. */
  update(snapshot: WorldSnapshot, fog?: FogView | null, lostGoals?: readonly GoalNode[]): void;
  /** Ring an attack at half-cell node `at`. */
  ping(at: HalfCellNode): void;
  setHidden(hidden: boolean): void;
  /** Spread the map over the screen, or fold it back into its corner. Each place keeps its own zoom and
   *  pan, and while spread the map answers every press on the screen. */
  setOverview(open: boolean): void;
  placement(): MinimapPlacement;
  /** Hand the keyboard to the button that opens the overview. */
  focusOverviewButton(): void;
  /** The element a view drawn over the framed map mounts in. */
  readonly overviewHost: HTMLElement;
  setUiScale(uiscale: number): Promise<void>;
  setFrame(frame: MinimapFrame): void;
  dispose(): void;
}

/** The zoom and pan one of the map's two places keeps. */
interface MinimapView {
  zoom: number;
  center: { x: number; y: number };
  /** The requested focus, which a low zoom may have clamped `center` away from. */
  zoomFocus: { x: number; y: number };
}

/** The retained whole-map layers share one transform and one clip, including the fog. */
export async function mountMinimap(opts: MinimapOptions): Promise<MinimapHandle> {
  const { app, terrain, plane } = opts;
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  let uiScale = opts.uiscale;
  let size: MinimapSize = 'm';
  const wholeMap = (): MinimapView => {
    const center = { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };
    return { zoom: 1, center, zoomFocus: center };
  };
  const cornerView = wholeMap();
  const overviewView = wholeMap();
  let overview = false;
  /** The view of the place the map stands in now. */
  let current = cornerView;
  let filters: MinimapFilters = opts.filters ?? DEFAULT_MINIMAP_FILTERS;
  let hidden = false;
  let hasSeat = opts.viewer() !== null;
  let dirtyDots = true;
  const placedLayout = (): MinimapLayout =>
    overview
      ? overviewLayout(bounds, app.screen.height, uiScale, app.screen.width)
      : minimapLayout(bounds, app.screen.height, uiScale, size, app.screen.width);
  let base = placedLayout();
  let layout = zoomMinimapLayout(base, bounds, current.zoom, current.center);
  /** The shown part of the dot raster, in raster px. */
  let visibleRaster: Rect = { x: 0, y: 0, w: 0, h: 0 };

  const container = new Container();
  container.zIndex = 1000;
  // Its own Pixi render group: the viewport rect redraws on every camera move and the alarms animate
  // every frame, and a redrawn Graphics rebuilds the instructions of the group it sits in.
  container.isRenderGroup = true;
  const scrim = new Graphics();
  scrim.visible = false;
  const backdrop = new Graphics();
  const world = new Container();
  const clip = new Graphics();
  const view = new Graphics();
  const goalGraphics = new Graphics();
  /** Shares the world's transform but not its clip: the alarm rings reach past the frame. */
  const unclippedWorld = new Container();
  container.addChild(scrim, backdrop, world, clip, view, goalGraphics, unclippedWorld);
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
  /** The raster a plot under way stamps into; it replaces the shown one when the plot completes. */
  const plotted = new Uint8Array(pixels.length);
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
  const alarms = createAlarmLayer(world, unclippedWorld, bounds, rasterScale);

  const zoomAt = (delta: number, anchor?: { x: number; y: number }): void => {
    const next = Math.max(1, Math.min(4, current.zoom * 2 ** (delta / 2)));
    if (next === current.zoom) return;
    if (anchor !== undefined) {
      current.center = {
        x: anchor.x + ((current.center.x - anchor.x) * current.zoom) / next,
        y: anchor.y + ((current.center.y - anchor.y) * current.zoom) / next,
      };
    } else {
      if (current.zoom === 1) {
        const vp = cameraViewport(opts.camera(), app.screen.width, app.screen.height);
        current.zoomFocus = { x: (vp.minX + vp.maxX) / 2, y: (vp.minY + vp.maxY) / 2 };
      }
      current.center = current.zoomFocus;
    }
    // Remember the requested focus even when a low zoom must clamp it away from a map edge.
    current.zoomFocus = current.center;
    current.zoom = next;
    dirtyDots = true;
    refreshLayout();
  };
  const chrome = createMinimapChrome(
    plane,
    {
      onZoom: (delta) => zoomAt(delta),
      onReset: () => {
        current.zoom = 1;
        dirtyDots = true;
        refreshLayout();
      },
      onSize: () => {
        size = nextMinimapSize(size, bounds, app.screen.height, uiScale, app.screen.width);
        dirtyDots = true;
        refreshLayout();
      },
      onLayer: (layer) => setFilters(toggleMinimapLayer(filters, layer)),
      onAllLayers: (shown) => setFilters(withAllMinimapLayers(filters, shown)),
      onScope: (scope) => setFilters({ ...filters, scope }),
      onGround: (ground) => setFilters({ ...filters, ground }),
      onMarkerSize: (markerSize) => setFilters({ ...filters, markerSize }),
      onColours: (colours) => setFilters({ ...filters, colours }),
      onOverview: opts.onOverviewButton,
    },
    opts.frame,
    opts.overlays,
  );
  function publishState(): void {
    chrome.setState({ zoom: current.zoom, size, filters, hasSeat });
  }
  function setFilters(next: MinimapFilters): void {
    filters = next;
    dirtyDots = true;
    publishState();
    opts.onFiltersChange?.(next);
  }
  let lastPanel = '';
  let lastView = '';
  let screenKey = '';
  function refreshLayout(): void {
    screenKey = `${app.screen.width},${app.screen.height}`;
    base = placedLayout();
    layout = zoomMinimapLayout(base, bounds, current.zoom, current.center);
    // Keep the effective clamped center: reversing a drag at the boundary moves immediately.
    if (layout.scaleX > 0 && layout.scaleY > 0)
      current.center = {
        x: bounds.minX + (base.map.x + base.map.w / 2 - layout.map.x) / layout.scaleX,
        y: bounds.minY + (base.map.y + base.map.h / 2 - layout.map.y) / layout.scaleY,
      };
    const key = `${base.panel.x},${base.panel.y},${base.panel.w},${base.panel.h},${uiScale}`;
    if (key !== lastPanel) {
      lastPanel = key;
      const { inner } = base;
      backdrop.clear().rect(inner.x, inner.y, inner.w, inner.h).fill(BACKDROP_COLOUR);
      clip.clear().rect(inner.x, inner.y, inner.w, inner.h).fill(0xffffff);
      scrim.clear().rect(0, 0, app.screen.width, app.screen.height).fill({
        color: 0,
        alpha: OVERVIEW_SCRIM_ALPHA,
      });
      reserveCorner();
      dirtyDots = true;
    }
    const shown = visibleMinimapRect(layout);
    chrome.setLayout(base.panel, shown, uiScale);
    world.position.set(layout.map.x, layout.map.y);
    world.scale.set(layout.map.w / raster.w, layout.map.h / raster.h);
    visibleRaster = {
      x: (shown.x - layout.map.x) / world.scale.x,
      y: (shown.y - layout.map.y) / world.scale.y,
      w: shown.w / world.scale.x,
      h: shown.h / world.scale.y,
    };
    unclippedWorld.position.copyFrom(world.position);
    unclippedWorld.scale.copyFrom(world.scale);
    const visible = !hidden && layout.scaleX > 0 && layout.scaleY > 0;
    container.visible = visible;
    chrome.setHidden(!visible);
    publishState();
  }
  /** The HUD regions keep clear of the map in its corner; the spread map hides them instead. */
  function reserveCorner(): void {
    setMinimapReserve(plane, hidden || overview ? null : base.panel, uiScale);
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
      current.center = { x: current.center.x + dx, y: current.center.y + dy };
      refreshLayout();
      current.zoomFocus = current.center;
    },
  });
  const claimDotReplot = createDotReplotGate(() => performance.now());
  const plot = new MinimapDotPlot();
  /** The seat the plot under way reads its fog and scope for. */
  let plotSeat: number | null = null;
  const dotRaster = { rgba: plotted, width: dotsW, height: dotsH };
  const stampScale = (): number => uiScale / world.scale.x;
  const stamp: MinimapDotSink = (x, y, mark, colour, part) =>
    stampMark(dotRaster, x, y, mark, colour, stampScale(), MARKER_SIZE_SCALES[filters.markerSize], part);

  return {
    claimsPointer: (x, y) => {
      if (hidden) return false;
      if (overview) return true;
      const point = opts.toScreenPx(x, y);
      return pointOverMinimap(layout, point.x, point.y);
    },
    dragging: input.dragging,
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
        publishState();
      }
      const seat = fog?.player ?? viewer;
      // A spectator's seat switch changes the scope, colours and fog a plot under way was started with.
      if (plot.pending() && seat !== plotSeat) dirtyDots = true;
      // A changed view starts over at once; otherwise a plot under way walks on before the gate is asked.
      if (dirtyDots || (!plot.pending() && claimDotReplot(snapshot, seat))) {
        plotSeat = seat;
        plotted.fill(0);
        plot.start({
          fog,
          memory: opts.fogMemory,
          bounds,
          scale: rasterScale,
          filters,
          isFighterJob: opts.isFighterJob,
          isHeroJob: opts.isHeroJob,
          viewer,
          stanceToward: opts.stanceToward,
          playerColourOf: opts.playerColourOf,
        });
        dirtyDots = false;
      }
      if (plot.pending() && plot.step(snapshot, stamp, performance.now() + DOT_PLOT_MS_PER_FRAME)) {
        roads.draw(opts.roads, fog, filters.layers.roads, stampScale());
        pixels.set(plotted);
        texture.source.update();
      }
      alarms.draw(performance.now(), stampScale(), visibleRaster);
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
      reserveCorner();
    },
    setOverview: (open) => {
      if (overview === open) return;
      overview = open;
      current = open ? overviewView : cornerView;
      scrim.visible = open;
      input.cancel();
      chrome.setOverview(open);
      dirtyDots = true;
      refreshLayout();
    },
    placement: () => ({ layout, bounds }),
    focusOverviewButton: chrome.focusOverviewButton,
    overviewHost: chrome.root,
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
