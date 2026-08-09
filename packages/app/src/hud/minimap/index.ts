import { type Camera, cameraViewport, type SceneTerrain, terrainWorldBounds } from '@open-northland/render';
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
import { createMinimapSurface } from './surface.js';

/**
 * The bottom-left minimap in the original's braided overview frame: the static ground raster, the
 * player-coloured unit dots, the fog mask over both, and the camera's view rectangle. Left-click or drag
 * in the map hole jumps the camera to the pointed world spot; the whole framed window claims its clicks
 * so they never fall through to unit selection or world orders.
 */

/** The camera view rectangle's stroke. */
const VIEW_RECT_COLOUR = 0xffffff;
const VIEW_RECT_ALPHA = 0.9;
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

  const local = (r: Rect): Rect => ({
    x: r.x - layout.panel.x,
    y: r.y - layout.panel.y,
    w: r.w,
    h: r.h,
  });
  const mapL = local(layout.map);

  const surface = await createMinimapSurface({
    container,
    terrain,
    cellColours: opts.cellColours,
    colourOf: opts.colourOf,
    hole: local(layout.inner),
    map: mapL,
    artScale: layout.artScale,
    resolution: () => app.renderer.resolution,
    loadFrame: (artScale, resolution) => loadMinimapFrame(app.renderer, artScale, resolution),
  });

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
      surface.syncResolution();
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
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      surface.dispose();
      container.destroy({ children: true });
      dotsTexture.destroy(true);
      fogMask.dispose();
    },
  };
}
