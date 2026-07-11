import {
  type Camera,
  ONE,
  type SceneTerrain,
  type TextureSource,
  cameraViewport,
  flatTileColour,
  tileToScreen,
} from '@vinland/render';
import type { WorldSnapshot } from '@vinland/sim';
import { type Application, BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { isBuilding, isSettler, ownerPlayerOf, positionOf } from '../../game/snapshot.js';
import {
  type MinimapLayout,
  minimapLayout,
  minimapToWorld,
  pointOverMinimap,
  rasterizeTerrain,
  terrainWorldBounds,
  viewportRectOnMinimap,
} from './model.js';

/**
 * The bottom-left RTS minimap: the whole map's terrain (built once — terrain is static), the owned
 * units/buildings as player-coloured dots (refreshed per sim tick) and the camera's view rectangle
 * (refreshed per frame). No fog of war yet — the sim has none, so the full map shows; when visibility
 * lands, this is the one surface to mask. Left-click (or drag) jumps the camera to the pointed world
 * spot; the click is claimed so it never falls through to unit selection or world orders.
 *
 * The mount half (this file) owns Pixi + DOM; the projection/layout/raster math is the pure
 * `model.ts` twin. Per the hud contract, view glue (client→screen px) is injected via options.
 */

/** Extra raster resolution over the on-screen size, so the ground stays crisp on a HiDPI display. */
const RASTER_OVERSAMPLE = 2;
/** Dot half-extents in minimap px: a settler is a 2×2 dot, a building a 3×3 block. */
const SETTLER_DOT_PX = 2;
const BUILDING_DOT_PX = 3;
/** The camera view rectangle's stroke. */
const VIEW_RECT_COLOUR = 0xffffff;
const VIEW_RECT_ALPHA = 0.9;
/** The 1px frame around the panel. */
const FRAME_COLOUR = 0x2c241a;

export interface MinimapOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The whole map's cell grid (the same `SceneTerrain` the renderer meshed). */
  readonly terrain: SceneTerrain;
  /** typeId → ground colour (the real terrain's debug colours); misses fall back to the flat tints. */
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /**
   * The ORIGINAL game's shipped minimap picture for this map (the pipeline's decoded `minimap.pcx`),
   * stretched over the panel when present. Preferred over the typeId raster: a decoded map's water/
   * land look lives in its baked ground-pattern lanes, NOT its landscape typeIds (~97% of a real map
   * shares one typeId), so only the original picture depicts it. NAMED APPROXIMATION: the picture is
   * assumed to map linearly onto the map's cell rectangle (the crop is the original's own whole-map
   * rendering), so dots/clicks — which use this minimap's own aspect-true projection — line up with
   * its features to within a pixel or two.
   */
  readonly groundImage?: TextureSource | undefined;
  /** The live camera (for the view rectangle). */
  readonly camera: () => Camera;
  /** Centre the camera on a WORLD point (projected px, pre-camera) — the click-to-jump action. */
  readonly onJump: (worldX: number, worldY: number) => void;
  /** Client (CSS px) → screen px, injected view glue (see `view/camera.ts` `screenScale`). */
  readonly toScreenPx: (clientX: number, clientY: number) => { x: number; y: number };
}

export interface MinimapHandle {
  /** True when the client point is over the minimap — for the HUD pointer-claim chain. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Per-frame refresh: re-place from the live screen size, redraw the view rect + (per tick) dots. */
  update(snapshot: WorldSnapshot): void;
  dispose(): void;
}

/** Mount the minimap onto `app.stage` (screen-space, above the world layer). */
export function mountMinimap(opts: MinimapOptions): MinimapHandle {
  const { app, canvas, terrain } = opts;
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  // The panel's size depends only on the map's aspect (the box + margin are constants), so the raster
  // and frame are built once; only the bottom-left anchor tracks the live screen size per frame.
  let layout: MinimapLayout = minimapLayout(bounds, app.screen.height);

  const container = new Container();
  app.stage.addChild(container);

  // The static ground: the original's shipped minimap picture when the entry provides one, else a
  // whole-map RGBA raster from the cell typeIds — either way built once (terrain is static).
  let groundTex: Texture;
  if (opts.groundImage !== undefined) {
    groundTex = new Texture({ source: opts.groundImage });
  } else {
    const pxW = Math.max(1, Math.round(layout.rect.w * RASTER_OVERSAMPLE));
    const pxH = Math.max(1, Math.round(layout.rect.h * RASTER_OVERSAMPLE));
    const rgba = rasterizeTerrain(terrain, opts.colourOf ?? (() => undefined), flatTileColour, pxW, pxH);
    groundTex = new Texture({
      source: new BufferImageSource({ resource: rgba, width: pxW, height: pxH, scaleMode: 'linear' }),
    });
  }
  const ground = new Sprite(groundTex);
  ground.width = layout.rect.w;
  ground.height = layout.rect.h;
  container.addChild(ground);

  // Dots above ground, view rectangle on top, then the static frame.
  const dots = new Graphics();
  const viewRect = new Graphics();
  const frame = new Graphics();
  frame.rect(-1, -1, layout.rect.w + 2, layout.rect.h + 2).stroke({ width: 2, color: FRAME_COLOUR });
  container.addChild(dots, viewRect, frame);

  // ── Input: left-click / drag jumps the camera to the pointed world spot ──────────────────────────
  let dragging = false;
  const jumpToScreenPoint = (sx: number, sy: number): void => {
    // Clamp into the panel so a drag that wanders off keeps scrolling along the map edge.
    const cx = Math.min(layout.rect.x + layout.rect.w - 1, Math.max(layout.rect.x, sx));
    const cy = Math.min(layout.rect.y + layout.rect.h - 1, Math.max(layout.rect.y, sy));
    const w = minimapToWorld(layout, bounds, cx, cy);
    opts.onJump(w.x, w.y);
  };
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const p = opts.toScreenPx(e.clientX, e.clientY);
    if (!pointOverMinimap(layout, p.x, p.y)) return;
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
  // Losing focus mid-drag drops the mouseup — reset, like the camera controller.
  const onBlur = (): void => {
    dragging = false;
  };
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);

  // ── Per-frame refresh ─────────────────────────────────────────────────────────────────────────────
  let lastDotsTick = -1;
  const drawDots = (snapshot: WorldSnapshot): void => {
    dots.clear();
    for (const e of snapshot.entities) {
      const player = ownerPlayerOf(e);
      if (player === undefined) continue; // neutral (piles, projectiles…) — the minimap shows forces
      const settler = isSettler(e);
      if (!settler && !isBuilding(e)) continue;
      const pos = positionOf(e);
      if (pos === undefined) continue;
      const s = tileToScreen(pos.x / ONE, pos.y / ONE);
      const mx = (s.x - bounds.minX) * layout.scale;
      const my = (s.y - bounds.minY) * layout.scale;
      const half = settler ? SETTLER_DOT_PX / 2 : BUILDING_DOT_PX / 2;
      const colour = PLAYER_SWATCH_COLORS[player % PLAYER_SWATCH_COLORS.length] ?? VIEW_RECT_COLOUR;
      dots.rect(mx - half, my - half, half * 2, half * 2).fill(colour);
    }
  };

  return {
    claimsPointer: (clientX, clientY) => {
      const p = opts.toScreenPx(clientX, clientY);
      return pointOverMinimap(layout, p.x, p.y);
    },
    update: (snapshot) => {
      layout = minimapLayout(bounds, app.screen.height);
      container.position.set(layout.rect.x, layout.rect.y);
      if (snapshot.tick !== lastDotsTick) {
        lastDotsTick = snapshot.tick;
        drawDots(snapshot);
      }
      viewRect.clear();
      const vp = viewportRectOnMinimap(
        layout,
        bounds,
        cameraViewport(opts.camera(), app.screen.width, app.screen.height),
      );
      if (vp !== null) {
        viewRect
          .rect(vp.x, vp.y, vp.w, vp.h)
          .stroke({ width: 1, color: VIEW_RECT_COLOUR, alpha: VIEW_RECT_ALPHA });
      }
    },
    dispose: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      container.destroy({ children: true });
      groundTex.destroy(true);
    },
  };
}
