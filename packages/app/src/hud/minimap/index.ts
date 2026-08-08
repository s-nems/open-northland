import {
  type Camera,
  cameraViewport,
  cellColourResolver,
  flatTileColour,
  rasterizeTerrain,
  type SceneTerrain,
  terrainWorldBounds,
} from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { type Application, BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { forEachMinimapDot, type MinimapDotSink } from './dots.js';
import { createFogMaskLayer } from './fog-mask.js';
import { loadMinimapFrame } from './frame.js';
import {
  type MinimapLayout,
  minimapLayout,
  minimapToWorld,
  pointOverMinimap,
  pointOverMinimapHole,
  stampDot,
  viewportRectOnMinimap,
} from './model.js';
import { createDotReplotGate } from './replot-gate.js';

/**
 * The bottom-left minimap in the original's braided overview frame: the static ground raster, the
 * player-coloured unit dots, the fog mask over both, and the camera's view rectangle. Left-click or drag
 * in the map hole jumps the camera to the pointed world spot; the whole framed window claims its clicks
 * so they never fall through to unit selection or world orders.
 */

/** Ground-raster px per device px: 2 pins the GPU's linear downscale at full averaging, so the per-cell
 *  mosaic's diamond edges resolve smooth at any DPR. */
const RASTER_OVERSAMPLE = 2;
/** How far (native frame px) the black hole backdrop underlaps the braid's top/right inner edge, since
 *  'full' keying opens the braid's near-black crevices. Must stay under the braid's 16 px top strip. */
const HOLE_UNDERLAP_NATIVE_PX = 8;
/** The camera view rectangle's stroke. */
const VIEW_RECT_COLOUR = 0xffffff;
const VIEW_RECT_ALPHA = 0.9;
/** The letterbox bars + hole backdrop (matches the frame art's near-black window). */
const HOLE_COLOUR = 0x000000;
/** The flat fallback frame (bare checkout - no GUI art): parchment-dark border strokes. */
const FALLBACK_FRAME_COLOUR = 0x2c241a;
/** The HUD overlay plane, shared with the tool-panel root and the action ring. Equal zIndex keeps mount
 *  order, so the framed window draws over the earlier-mounted strip and under the later-mounted ring. */
const MINIMAP_Z = 1000;

export interface MinimapOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The whole map's cell grid (the same `SceneTerrain` the renderer meshed). */
  readonly terrain: SceneTerrain;
  /** Per-cell ground colours from the map's baked ground lanes; unresolved entries and an absent table
   *  fall back to the typeId palette. */
  readonly cellColours?: Uint32Array | undefined;
  /** typeId → ground colour; misses fall back to the render flat tints. */
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** Owner slot → team-colour slot for the unit/building dots; absent means identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** The resolved HUD scale; the layout floors it at `MIN_UI_SCALE`. */
  readonly uiscale: number;
  /** The live camera (for the view rectangle). */
  readonly camera: () => Camera;
  /** Centre the camera on a world point (projected px, pre-camera). */
  readonly onJump: (worldX: number, worldY: number) => void;
  /** Client (CSS px) → screen px. */
  readonly toScreenPx: (clientX: number, clientY: number) => { x: number; y: number };
}

export interface MinimapHandle {
  /** True when the client point is over the framed window. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** The framed window's screen-px box, which the tool panel's pop-up lists must stay clear of, or null
   *  while the window is not shown. Resolved against the live screen, since the panel refreshes first. */
  panelRect(): Rect | null;
  /** Per-frame refresh; `fog` is the viewer's fog view, or null when fog is off. */
  update(snapshot: WorldSnapshot, fog?: FogView | null): void;
  dispose(): void;
}

/** Mount the minimap onto `app.stage` (screen-space, above the world layer). */
export async function mountMinimap(opts: MinimapOptions): Promise<MinimapHandle> {
  const { app, canvas, terrain } = opts;
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  // The framed window's size is fixed; only its bottom-left anchor tracks the live screen height, so
  // every rect is constant in panel-local coords and children draw local.
  let layout: MinimapLayout = minimapLayout(bounds, app.screen.height, opts.uiscale);

  const container = new Container();
  container.visible = false;
  container.zIndex = MINIMAP_Z;
  app.stage.addChild(container);

  /** The renderer resolution the ground raster and frame were baked at; a DPR change re-bakes both.
   *  Captured before the await, so a change landing mid-load still differs and triggers the re-bake. */
  let bakedResolution = app.renderer.resolution;
  let frame = await loadMinimapFrame(app.renderer, layout.artScale, bakedResolution);

  const local = (r: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): {
    x: number;
    y: number;
    w: number;
    h: number;
  } => ({
    x: r.x - layout.panel.x,
    y: r.y - layout.panel.y,
    w: r.w,
    h: r.h,
  });

  // The window hole backdrop: uniform near-black, so the letterbox bars around a non-square map read as
  // one clean window. Left and bottom run flush to the screen corner.
  const holeBg = new Graphics();
  const innerL = local(layout.inner);
  const underlap = frame !== null ? HOLE_UNDERLAP_NATIVE_PX * layout.artScale : 0;
  holeBg.rect(innerL.x, innerL.y - underlap, innerL.w + underlap, innerL.h + underlap).fill(HOLE_COLOUR);
  container.addChild(holeBg);

  // The braid draws over the backdrop and covers its underlap; the frame's hole and outer margins are
  // already keyed transparent.
  if (frame !== null) {
    frame.display.position.set(0, 0);
    container.addChild(frame.display);
  } else {
    const fallbackFrame = new Graphics();
    fallbackFrame
      .rect(innerL.x - 1, innerL.y - 1, innerL.w + 2, innerL.h + 2)
      .stroke({ width: 2, color: FALLBACK_FRAME_COLOUR });
    container.addChild(fallbackFrame);
  }

  // One whole-map RGBA raster, aspect-fitted into the hole. Colour precedence per cell: baked
  // ground-lane colour → the caller's per-typeId ground colour → flat tint.
  const colourOfType = (typeId: number): number => opts.colourOf?.(typeId) ?? flatTileColour(typeId);
  const colourOfCell = cellColourResolver(opts.cellColours, colourOfType);
  const makeGroundTexture = (): Texture => {
    const pxW = Math.max(1, Math.round(layout.map.w * RASTER_OVERSAMPLE * app.renderer.resolution));
    const pxH = Math.max(1, Math.round(layout.map.h * RASTER_OVERSAMPLE * app.renderer.resolution));
    const rgba = rasterizeTerrain(terrain, colourOfCell, pxW, pxH);
    return new Texture({
      source: new BufferImageSource({ resource: rgba, width: pxW, height: pxH, scaleMode: 'linear' }),
    });
  };
  let groundTex = makeGroundTexture();
  const ground = new Sprite(groundTex);
  const mapL = local(layout.map);
  ground.position.set(mapL.x, mapL.y);
  ground.width = mapL.w;
  ground.height = mapL.h;
  container.addChild(ground);

  const fogMask = createFogMaskLayer(container, mapL);

  // The dots are a retained raster: one buffer and texture for the session, rewritten and re-uploaded
  // in place per tick, 1:1 with minimap logical px and nearest-scaled so a dot stays a blocky square.
  const dotsPxW = Math.max(1, Math.round(mapL.w));
  const dotsPxH = Math.max(1, Math.round(mapL.h));
  const dotsBuffer = new Uint8Array(dotsPxW * dotsPxH * 4);
  const dotsTexture = new Texture({
    source: new BufferImageSource({
      resource: dotsBuffer,
      width: dotsPxW,
      height: dotsPxH,
      scaleMode: 'nearest',
    }),
  });
  const dots = new Sprite(dotsTexture);
  dots.position.set(mapL.x, mapL.y);
  dots.width = mapL.w;
  dots.height = mapL.h;
  const viewRect = new Graphics();
  container.addChild(dots, viewRect);

  let dragging = false;
  const jumpToScreenPoint = (sx: number, sy: number): void => {
    // Clamp into the map picture so a drag that wanders off keeps scrolling along the map edge.
    const cx = Math.min(layout.map.x + layout.map.w - 1, Math.max(layout.map.x, sx));
    const cy = Math.min(layout.map.y + layout.map.h - 1, Math.max(layout.map.y, sy));
    const w = minimapToWorld(layout, bounds, cx, cy);
    opts.onJump(w.x, w.y);
  };
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || !container.visible) return;
    const p = opts.toScreenPx(e.clientX, e.clientY);
    // Only the map hole jumps; the braid still claims the click so it never orders units.
    if (!pointOverMinimapHole(layout, p.x, p.y)) return;
    dragging = true;
    jumpToScreenPoint(p.x, p.y);
    e.preventDefault();
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const p = opts.toScreenPx(e.clientX, e.clientY);
    jumpToScreenPoint(p.x, p.y);
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) dragging = false;
  };
  // Losing focus mid-drag drops the mouseup.
  const onBlur = (): void => {
    dragging = false;
  };
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);

  const claimDotReplot = createDotReplotGate(() => performance.now());
  let lastHeight = -1;
  let disposed = false;
  /** Monotonic guard: only the newest in-flight frame re-bake may swap the braid in. */
  let frameEpoch = 0;
  const rebuildDensity = (): void => {
    bakedResolution = app.renderer.resolution;
    const nextTex = makeGroundTexture();
    ground.texture = nextTex;
    groundTex.destroy(true);
    groundTex = nextTex;
    // A texture swap re-derives the sprite scale from the new texel size, so re-pin the on-screen size.
    ground.width = mapL.w;
    ground.height = mapL.h;
    if (frame === null) return;
    const epoch = ++frameEpoch;
    void loadMinimapFrame(app.renderer, layout.artScale, bakedResolution).then((next) => {
      if (next === null) return;
      if (disposed || epoch !== frameEpoch || frame === null) {
        next.dispose();
        return;
      }
      const at = container.getChildIndex(frame.display);
      frame.dispose();
      frame = next;
      next.display.position.set(0, 0);
      container.addChildAt(next.display, at);
    });
  };
  // The view rect the Graphics currently shows (`[x, y, w, h]`; NaN = cleared). Redrawn only on change,
  // since a per-frame clear and stroke re-tessellates and forces the stage's instruction rebuild.
  let lastViewRect: [number, number, number, number] = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
  const stampDotInto: MinimapDotSink = (bx, by, half, colour) =>
    stampDot(dotsBuffer, dotsPxW, dotsPxH, bx, by, half, colour);
  const drawDots = (snapshot: WorldSnapshot, fog: FogView | null): void => {
    dotsBuffer.fill(0);
    forEachMinimapDot(snapshot, fog, bounds, layout.scale, opts.playerColourOf, stampDotInto);
    dotsTexture.source.update();
  };

  return {
    claimsPointer: (clientX, clientY) => {
      if (!container.visible) return false;
      const p = opts.toScreenPx(clientX, clientY);
      return pointOverMinimap(layout, p.x, p.y);
    },
    panelRect: () =>
      container.visible ? minimapLayout(bounds, app.screen.height, opts.uiscale).panel : null,
    update: (snapshot, fog = null) => {
      const h = app.screen.height;
      layout = minimapLayout(bounds, h, opts.uiscale);
      if (!container.visible) {
        // Show only once the screen height repeats, so a still-resizing canvas never places the panel
        // against a transient height and visibly jumps it to the corner.
        const settled = h > 0 && h === lastHeight;
        lastHeight = h;
        if (!settled) return;
        container.visible = true;
      }
      container.position.set(layout.panel.x, layout.panel.y);
      if (app.renderer.resolution !== bakedResolution) rebuildDensity();
      fogMask.draw(fog);
      if (claimDotReplot(snapshot)) drawDots(snapshot, fog);
      const vp = viewportRectOnMinimap(
        layout,
        bounds,
        cameraViewport(opts.camera(), app.screen.width, app.screen.height),
      );
      const vpl = vp === null ? null : local(vp);
      const [lx, ly, lw, lh] = lastViewRect;
      const unchanged =
        vpl === null ? Number.isNaN(lx) : vpl.x === lx && vpl.y === ly && vpl.w === lw && vpl.h === lh;
      if (!unchanged) {
        viewRect.clear();
        if (vpl === null) {
          lastViewRect = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
        } else {
          viewRect
            .rect(vpl.x, vpl.y, vpl.w, vpl.h)
            .stroke({ width: 1, color: VIEW_RECT_COLOUR, alpha: VIEW_RECT_ALPHA });
          lastViewRect = [vpl.x, vpl.y, vpl.w, vpl.h];
        }
      }
    },
    dispose: () => {
      disposed = true;
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      container.destroy({ children: true });
      frame?.dispose();
      groundTex.destroy(true);
      dotsTexture.destroy(true);
      fogMask.dispose();
    },
  };
}
