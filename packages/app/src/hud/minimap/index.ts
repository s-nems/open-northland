import { type Camera, cameraViewport, type SceneTerrain, terrainWorldBounds } from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { type Application, BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { diag } from '../../diag/index.js';
import type { Rect } from '../geometry.js';
import { createReplaceableMount } from '../replaceable-mount.js';
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
import { createMinimapSurface, type MinimapSurface } from './surface.js';

/**
 * The bottom-left minimap in the original's braided overview frame: the static ground raster, the
 * player-coloured unit dots, the fog mask over both, and the camera's view rectangle. A press in the
 * map hole is offered to `onOrder` first and otherwise jumps the camera to the pointed world spot,
 * which a left drag keeps doing; the whole framed window claims its clicks so they never fall through
 * to unit selection or world orders.
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
  /** Offer a press in the map hole to the order layer as an order at the spot it depicts, before the
   *  camera jumps there. True when the order took the press. Absent, the hole only scrolls the view. */
  readonly onOrder?: (worldX: number, worldY: number, event: MouseEvent) => boolean;
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
  setUiScale(uiscale: number): Promise<void>;
  dispose(): void;
}

/** Mount the minimap onto `app.stage` (screen-space, above the world layer). */
export async function mountMinimap(opts: MinimapOptions): Promise<MinimapHandle> {
  const mountAtScale = (uiscale: number) => mountMinimapAtScale({ ...opts, uiscale });
  const mounts = createReplaceableMount(await mountAtScale(opts.uiscale), mountAtScale, (next) =>
    next.activate(),
  );
  return {
    claimsPointer: (clientX, clientY) => mounts.current().claimsPointer(clientX, clientY),
    panelRect: () => mounts.current().panelRect(),
    update: (snapshot, fog) => mounts.current().update(snapshot, fog),
    setUiScale: (uiscale) => mounts.replace(uiscale),
    dispose: () => mounts.dispose(),
  };
}

interface MountedMinimap extends Omit<MinimapHandle, 'setUiScale'> {
  activate(): void;
}

async function mountMinimapAtScale(opts: MinimapOptions): Promise<MountedMinimap> {
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

  let surface: MinimapSurface;
  try {
    surface = await createMinimapSurface({
      container,
      terrain,
      cellColours: opts.cellColours,
      colourOf: opts.colourOf,
      hole: local(layout.inner),
      map: mapL,
      artScale: layout.artScale,
      resolution: () => app.renderer.resolution,
      loadFrame: (artScale, resolution) => loadMinimapFrame(app.renderer, artScale, resolution),
      onFrameError: (error) => diag.warn('ui', `Minimap frame rebuild failed: ${String(error)}`),
    });
  } catch (error: unknown) {
    container.destroy({ children: true });
    throw error;
  }

  let fogMask: ReturnType<typeof createFogMaskLayer> | null = null;
  let dotsTexture: Texture | null = null;
  let removeListeners = (): void => undefined;
  try {
    fogMask = createFogMaskLayer(container, mapL);
    const mountedFogMask = fogMask;

    // The dots are a retained raster: one buffer and texture for the session, rewritten and re-uploaded
    // in place per tick, 1:1 with minimap logical px and nearest-scaled so a dot stays a blocky square.
    const dotsPxW = Math.max(1, Math.round(mapL.w));
    const dotsPxH = Math.max(1, Math.round(mapL.h));
    const dotsBuffer = new Uint8Array(dotsPxW * dotsPxH * 4);
    dotsTexture = new Texture({
      source: new BufferImageSource({
        resource: dotsBuffer,
        width: dotsPxW,
        height: dotsPxH,
        scaleMode: 'nearest',
      }),
    });
    const mountedDotsTexture = dotsTexture;
    const dots = new Sprite(mountedDotsTexture);
    dots.position.set(mapL.x, mapL.y);
    dots.width = mapL.w;
    dots.height = mapL.h;
    const viewRect = new Graphics();
    container.addChild(dots, viewRect);

    let dragging = false;
    /** The world spot a screen point depicts, clamped into the map picture so a drag that wanders off
     *  keeps scrolling along the map edge. */
    const spotAt = (sx: number, sy: number): { x: number; y: number } => {
      const cx = Math.min(layout.map.x + layout.map.w - 1, Math.max(layout.map.x, sx));
      const cy = Math.min(layout.map.y + layout.map.h - 1, Math.max(layout.map.y, sy));
      return minimapToWorld(layout, bounds, cx, cy);
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (!container.visible) return;
      const p = opts.toScreenPx(e.clientX, e.clientY);
      // Only the map hole answers a press; the braid still claims it so it never orders units.
      if (!pointOverMinimapHole(layout, p.x, p.y)) return;
      const spot = spotAt(p.x, p.y);
      if (opts.onOrder?.(spot.x, spot.y, e) === true) {
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      dragging = true;
      opts.onJump(spot.x, spot.y);
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!dragging) return;
      const p = opts.toScreenPx(e.clientX, e.clientY);
      const spot = spotAt(p.x, p.y);
      opts.onJump(spot.x, spot.y);
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
    removeListeners = (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };

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
      mountedDotsTexture.source.update();
    };

    return {
      activate: (): void => {
        layout = minimapLayout(bounds, app.screen.height, opts.uiscale);
        container.position.set(layout.panel.x, layout.panel.y);
        container.visible = true;
        lastHeight = app.screen.height;
      },
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
        mountedFogMask.draw(fog);
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
        removeListeners();
        surface.dispose();
        container.destroy({ children: true });
        mountedDotsTexture.destroy(true);
        mountedFogMask.dispose();
      },
    };
  } catch (error: unknown) {
    removeListeners();
    surface.dispose();
    container.destroy({ children: true });
    dotsTexture?.destroy(true);
    fogMask?.dispose();
    throw error;
  }
}
