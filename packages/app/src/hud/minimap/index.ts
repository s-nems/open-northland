import {
  type Camera,
  ONE,
  type SceneTerrain,
  cameraViewport,
  flatTileColour,
  tileToScreen,
} from '@vinland/render';
import type { WorldSnapshot } from '@vinland/sim';
import { type Application, BufferImageSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { MINIMAP_CELL_UNRESOLVED } from '../../content/minimap-ground.js';
import { isBuilding, isSettler, ownerPlayerOf, positionOf } from '../../game/snapshot.js';
import { loadMinimapFrame } from './frame.js';
import {
  type MinimapLayout,
  minimapLayout,
  minimapToWorld,
  pointOverMinimap,
  pointOverMinimapHole,
  rasterizeTerrain,
  terrainWorldBounds,
  viewportRectOnMinimap,
} from './model.js';

/**
 * The bottom-left minimap in the original's braided overview frame: the whole map's ground (built
 * once — terrain is static), the units/buildings as player-coloured dots (refreshed per sim tick)
 * and the camera's view rectangle (refreshed per frame). No fog of war yet — the sim has none, so
 * the full map shows; when visibility lands, this is the one surface to mask. Left-click (or drag)
 * in the map hole jumps the camera to the pointed world spot; the whole framed window claims its
 * clicks so they never fall through to unit selection or world orders.
 *
 * The mount half (this file) owns Pixi + DOM; the geometry/projection/raster math is the pure
 * `model.ts` twin. Per the hud contract, view glue (client→screen px) is injected via options.
 */

/** Ground-raster px per DEVICE px: 2 pins the GPU's linear downscale tap at full averaging (the
 *  `supersample.ts` policy), so the per-cell mosaic's diamond edges resolve smooth on any DPR. */
const RASTER_OVERSAMPLE = 2;
/** How far (native frame px) the black hole backdrop underlaps the braid on its top/right inner edge:
 *  'full' keying opens the braid's near-black crevices, and without the underlap the world would show
 *  through a gap between braid and window. Must stay under the braid's thickness (16 px top strip). */
const HOLE_UNDERLAP_NATIVE_PX = 8;
/** Dot half-extents in minimap px: a settler is a 2×2 dot, a building a 3×3 block. */
const SETTLER_DOT_PX = 2;
const BUILDING_DOT_PX = 3;
/** The camera view rectangle's stroke. */
const VIEW_RECT_COLOUR = 0xffffff;
const VIEW_RECT_ALPHA = 0.9;
/** The letterbox bars + hole backdrop (matches the frame art's near-black window). */
const HOLE_COLOUR = 0x000000;
/** The flat fallback frame (bare checkout — no GUI art): parchment-dark border strokes. */
const FALLBACK_FRAME_COLOUR = 0x2c241a;

export interface MinimapOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The whole map's cell grid (the same `SceneTerrain` the renderer meshed). */
  readonly terrain: SceneTerrain;
  /** Per-cell ground colours from the map's baked ground lanes (`content/minimap-ground.ts`);
   *  {@link MINIMAP_CELL_UNRESOLVED} entries (and an absent table) fall back to the typeId palette. */
  readonly cellColours?: Uint32Array | undefined;
  /** typeId → ground colour (the real terrain set's per-type debug colours); misses fall back to the
   *  render flat tints. The last resort under {@link MinimapOptions.cellColours}. */
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** The HUD scale (`?uiscale=`, clamped ≥1) — sizes the framed window with the rest of the HUD. */
  readonly uiscale: number;
  /** The live camera (for the view rectangle). */
  readonly camera: () => Camera;
  /** Centre the camera on a WORLD point (projected px, pre-camera) — the click-to-jump action. */
  readonly onJump: (worldX: number, worldY: number) => void;
  /** Client (CSS px) → screen px, injected view glue (see `view/camera.ts` `screenScale`). */
  readonly toScreenPx: (clientX: number, clientY: number) => { x: number; y: number };
}

export interface MinimapHandle {
  /** True when the client point is over the framed window — for the HUD pointer-claim chain. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Per-frame refresh: re-place from the live screen size, redraw the view rect + (per tick) dots. */
  update(snapshot: WorldSnapshot): void;
  dispose(): void;
}

/** Mount the minimap onto `app.stage` (screen-space, above the world layer). */
export async function mountMinimap(opts: MinimapOptions): Promise<MinimapHandle> {
  const { app, canvas, terrain } = opts;
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  // The framed window's size is fixed (frame native × art scale); only its bottom-left anchor tracks
  // the live screen height, so every rect is constant in PANEL-LOCAL coords and children draw local.
  let layout: MinimapLayout = minimapLayout(bounds, app.screen.height, opts.uiscale);

  const container = new Container();
  // Hidden until the first update on a SETTLED screen (two consecutive frames with the same height):
  // the canvas can still be resizing to the window during the first frames of a fresh view, and a
  // panel placed against a transient height would visibly jump to its corner.
  container.visible = false;
  app.stage.addChild(container);

  const frame = await loadMinimapFrame(app.renderer, layout.artScale, app.renderer.resolution);

  const local = (r: { x: number; y: number; w: number; h: number }): {
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

  // The window hole backdrop (bottom of the stack): uniform near-black, so the letterbox bars around
  // a non-square map read as one clean window. Under the braided frame it UNDERLAPS the braid's
  // top/right inner edge (left/bottom run flush to the screen corner) — the keyed braid crevices then
  // show black window, never a see-through gap to the world.
  const holeBg = new Graphics();
  const innerL = local(layout.inner);
  const underlap = frame !== null ? HOLE_UNDERLAP_NATIVE_PX * layout.artScale : 0;
  holeBg
    .rect(innerL.x, innerL.y - underlap, innerL.w + underlap, innerL.h + underlap)
    .fill(HOLE_COLOUR);
  container.addChild(holeBg);

  // The original braided frame, drawn OVER the backdrop (its near-black hole + outer margins are keyed
  // transparent — see frame.ts — so the braid alone shows, covering the backdrop's underlap). Baked
  // supersampled to an ordinary top-anchored Sprite, so it rides the container like everything else.
  // Bare checkout: a flat Graphics frame at the same geometry.
  if (frame !== null) {
    frame.display.position.set(0, 0);
    container.addChild(frame.display);
  }
  let fallbackFrame: Graphics | null = null;
  if (frame === null) {
    fallbackFrame = new Graphics();
    fallbackFrame
      .rect(innerL.x - 1, innerL.y - 1, innerL.w + 2, innerL.h + 2)
      .stroke({ width: 2, color: FALLBACK_FRAME_COLOUR });
    container.addChild(fallbackFrame);
  }

  // The static ground image: one whole-map RGBA raster (built once — terrain is static), aspect-fitted
  // into the hole. Colour precedence per cell: baked ground-lane colour → typeId debug colour → flat tint.
  const colourOfType = (typeId: number): number => opts.colourOf?.(typeId) ?? flatTileColour(typeId);
  const cells = opts.cellColours;
  const colourOfCell =
    cells !== undefined
      ? (cell: number, typeId: number): number => {
          const v = cells[cell] ?? MINIMAP_CELL_UNRESOLVED;
          return v < MINIMAP_CELL_UNRESOLVED ? v : colourOfType(typeId);
        }
      : (_cell: number, typeId: number): number => colourOfType(typeId);
  const pxW = Math.max(1, Math.round(layout.map.w * RASTER_OVERSAMPLE * app.renderer.resolution));
  const pxH = Math.max(1, Math.round(layout.map.h * RASTER_OVERSAMPLE * app.renderer.resolution));
  const rgba = rasterizeTerrain(terrain, colourOfCell, pxW, pxH);
  const groundTex = new Texture({
    source: new BufferImageSource({ resource: rgba, width: pxW, height: pxH, scaleMode: 'linear' }),
  });
  const ground = new Sprite(groundTex);
  const mapL = local(layout.map);
  ground.position.set(mapL.x, mapL.y);
  ground.width = mapL.w;
  ground.height = mapL.h;
  container.addChild(ground);

  // Dots above ground, the view rectangle on top.
  const dots = new Graphics();
  const viewRect = new Graphics();
  container.addChild(dots, viewRect);

  // ── Input: left-click / drag in the map hole jumps the camera to the pointed world spot ──────────
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
    // Only the map hole jumps; the braid still claims (see claimsPointer) so it never orders units.
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
  let lastHeight = -1;
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
      const mx = layout.map.x - layout.panel.x + (s.x - bounds.minX) * layout.scale;
      const my = layout.map.y - layout.panel.y + (s.y - bounds.minY) * layout.scale;
      const half = settler ? SETTLER_DOT_PX / 2 : BUILDING_DOT_PX / 2;
      const colour = PLAYER_SWATCH_COLORS[player % PLAYER_SWATCH_COLORS.length] ?? VIEW_RECT_COLOUR;
      dots.rect(mx - half, my - half, half * 2, half * 2).fill(colour);
    }
  };

  return {
    claimsPointer: (clientX, clientY) => {
      if (!container.visible) return false;
      const p = opts.toScreenPx(clientX, clientY);
      return pointOverMinimap(layout, p.x, p.y);
    },
    update: (snapshot) => {
      const h = app.screen.height;
      layout = minimapLayout(bounds, h, opts.uiscale);
      if (!container.visible) {
        // Settle gate: show only once the screen height repeats — never a first-frame corner jump.
        const settled = h > 0 && h === lastHeight;
        lastHeight = h;
        if (!settled) return;
        container.visible = true;
      }
      container.position.set(layout.panel.x, layout.panel.y);
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
        const vpl = local(vp);
        viewRect
          .rect(vpl.x, vpl.y, vpl.w, vpl.h)
          .stroke({ width: 1, color: VIEW_RECT_COLOUR, alpha: VIEW_RECT_ALPHA });
      }
    },
    dispose: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      container.destroy({ children: true });
      frame?.dispose();
      groundTex.destroy(true);
    },
  };
}
