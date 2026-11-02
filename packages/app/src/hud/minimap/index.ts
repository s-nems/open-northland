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
  /** The button over the corner frame was pressed. */
  readonly onOverviewButton: () => void;
}

/** Where a map stands on the screen, for what is drawn over it; a new `layout` object means it moved. */
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
  setUiScale(uiscale: number): Promise<void>;
  setFrame(frame: MinimapFrame): void;
  /** Show or shut the overview, the second map that stands in the screen's centre as a window. */
  setOverview(open: boolean): void;
  /** Where the overview stands. */
  placement(): MinimapPlacement;
  /** Where a view drawn over the overview mounts, inside its frame's stacking order. */
  readonly overviewHost: HTMLElement;
  /** Hand the keyboard to the button that opens the overview. */
  focusOverviewButton(): void;
  dispose(): void;
}

/** One map on the screen, in its own place and with its own zoom and pan. */
interface MinimapView {
  claimsPointer(clientX: number, clientY: number): boolean;
  dragging(): boolean;
  update: MinimapHandle['update'];
  ping(at: HalfCellNode): void;
  setHidden(hidden: boolean): void;
  setUiScale(uiscale: number): void;
  setFrame(frame: MinimapFrame): void;
  /** Take a choice made on the other map. */
  setFilters(filters: MinimapFilters): void;
  panel(): Rect;
  placement(): MinimapPlacement;
  readonly host: HTMLElement;
  focusOverviewButton(): void;
  dispose(): void;
}

/** What the overview keeps clear of. */
interface OverviewPlace {
  /** The corner map's frame, which the overview slides clear of. */
  readonly clearOf: () => Rect;
}

/**
 * The corner map and the overview. The overview is a whole second map, so the corner keeps showing
 * beside it; it stands hidden from the start, its ground baked ahead on a worker, so that it opens at once.
 */
export async function mountMinimap(opts: MinimapOptions): Promise<MinimapHandle> {
  let overviewOpen = false;
  const chose = (next: MinimapFilters, peer: MinimapView): void => {
    peer.setFilters(next);
    opts.onFiltersChange?.(next);
  };
  const corner: MinimapView = mountMinimapView(
    opts,
    null,
    (next) => chose(next, overview),
    (x, y) => overviewOpen && overview.claimsPointer(x, y),
  );
  const overview: MinimapView = mountMinimapView(
    opts,
    { clearOf: corner.panel },
    (next) => chose(next, corner),
    () => false,
  );
  return {
    claimsPointer: (x, y) => corner.claimsPointer(x, y) || overview.claimsPointer(x, y),
    dragging: () => corner.dragging() || overview.dragging(),
    update: (snapshot, fog, lostGoals) => {
      corner.update(snapshot, fog, lostGoals);
      overview.update(snapshot, fog, lostGoals);
    },
    ping: (at) => {
      corner.ping(at);
      if (overviewOpen) overview.ping(at);
    },
    setHidden: corner.setHidden,
    setUiScale: async (next) => {
      corner.setUiScale(next);
      overview.setUiScale(next);
    },
    setFrame: (next) => {
      corner.setFrame(next);
      overview.setFrame(next);
    },
    setOverview: (open) => {
      overviewOpen = open;
      overview.setHidden(!open);
    },
    placement: overview.placement,
    overviewHost: overview.host,
    focusOverviewButton: corner.focusOverviewButton,
    dispose: () => {
      overview.dispose();
      corner.dispose();
    },
  };
}

/** The retained whole-map layers share one transform and one clip, including the fog. `overviewPlace`
 *  absent, this is the corner map. */
function mountMinimapView(
  opts: MinimapOptions,
  overviewPlace: OverviewPlace | null,
  onFilters: (filters: MinimapFilters) => void,
  yieldsTo: (clientX: number, clientY: number) => boolean,
): MinimapView {
  const { app, terrain, plane } = opts;
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  let uiScale = opts.uiscale;
  let size: MinimapSize = 'm';
  let zoom = 1;
  let center = { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };
  let zoomFocus = center;
  let filters: MinimapFilters = opts.filters ?? DEFAULT_MINIMAP_FILTERS;
  let hidden = overviewPlace !== null;
  /** Whether the hidden overview has asked for its ground. */
  let groundAsked = false;
  let hasSeat = opts.viewer() !== null;
  let dirtyDots = true;
  const placedLayout = (): MinimapLayout =>
    overviewPlace === null
      ? minimapLayout(bounds, app.screen.height, uiScale, size, app.screen.width)
      : overviewLayout(bounds, app.screen.height, uiScale, app.screen.width, overviewPlace.clearOf());
  let base = placedLayout();
  let layout = zoomMinimapLayout(base, bounds, zoom, center);
  /** The shown part of the dot raster, in raster px. */
  let visibleRaster: Rect = { x: 0, y: 0, w: 0, h: 0 };

  const container = new Container();
  container.zIndex = 1000;
  // Its own Pixi render group: the viewport rect redraws on every camera move and the alarms animate
  // every frame, and a redrawn Graphics rebuilds the instructions of the group it sits in.
  container.isRenderGroup = true;
  const backdrop = new Graphics();
  const world = new Container();
  const clip = new Graphics();
  const view = new Graphics();
  const goalGraphics = new Graphics();
  /** Shares the world's transform but not its clip: the alarm rings reach past the frame. */
  const unclippedWorld = new Container();
  container.addChild(backdrop, world, clip, view, goalGraphics, unclippedWorld);
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
      ...(overviewPlace === null ? { onOverview: opts.onOverviewButton } : {}),
    },
    opts.frame,
    overviewPlace === null ? 'corner' : 'overview',
    overviewPlace === null ? opts.overlays : undefined,
  );
  function applyFilters(next: MinimapFilters): void {
    filters = next;
    dirtyDots = true;
    chrome.setState({ size, zoom, filters, hasSeat });
  }
  function setFilters(next: MinimapFilters): void {
    applyFilters(next);
    onFilters(next);
  }
  let lastPanel = '';
  let lastView = '';
  let screenKey = '';
  /** What the place depends on outside this map: the screen and, for the overview, the corner's frame. */
  const placeKey = (): string => {
    const clear = overviewPlace?.clearOf();
    return `${app.screen.width},${app.screen.height},${clear?.x},${clear?.w},${clear?.y}`;
  };
  function refreshLayout(): void {
    screenKey = placeKey();
    base = placedLayout();
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
    chrome.setState({ zoom, size, filters, hasSeat });
  }
  /** The HUD regions keep clear of the corner map; the overview finds its own room among them. */
  function reserveCorner(): void {
    if (overviewPlace === null) setMinimapReserve(plane, hidden ? null : base.panel, uiScale);
  }
  refreshLayout();
  const input = createMinimapInput({
    canvas: opts.canvas,
    bounds,
    layout: () => layout,
    enabled: () => !hidden && layout.scaleX > 0 && layout.scaleY > 0,
    yieldsTo,
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
      const point = opts.toScreenPx(x, y);
      return pointOverMinimap(layout, point.x, point.y);
    },
    dragging: input.dragging,
    update: (snapshot, fog = null, lostGoals = NO_GOALS) => {
      if (hidden) {
        if (overviewPlace !== null && !groundAsked) {
          groundAsked = true;
          surface.sync(snapshot, fog);
        }
        return;
      }
      if (screenKey !== placeKey()) refreshLayout();
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
      // A hidden map plots nothing, so one shown again starts from the world as it stands.
      dirtyDots = true;
      container.visible = !next && layout.scaleX > 0 && layout.scaleY > 0;
      chrome.setHidden(!container.visible);
      input.cancel();
      reserveCorner();
    },
    setUiScale: (next) => {
      uiScale = next;
      refreshLayout();
    },
    setFrame: (frame) => chrome.setFrame(frame),
    setFilters: applyFilters,
    panel: () => base.panel,
    placement: () => ({ layout, bounds }),
    host: chrome.root,
    focusOverviewButton: chrome.focusOverviewButton,
    dispose: () => {
      input.dispose();
      chrome.dispose();
      if (overviewPlace === null) setMinimapReserve(plane, null, uiScale);
      surface.dispose();
      fogMask.dispose();
      roads.dispose();
      container.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
