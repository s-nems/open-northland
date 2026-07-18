/**
 * The CSS-px → Pixi-screen-px coordinate mapping the camera controller, picking, tool panel, unit
 * controls, settler ring and map view all ride on. Kept in one place so the `app.renderer.resolution`
 * threading and canvas-origin anchor math can't drift between drag, zoom, pick and placement. Pure
 * DOM geometry — no Pixi, no sim.
 */

/**
 * The CSS-px → Pixi-screen-px scale for a canvas (+ its client `rect`). Client (CSS-px) mouse coords
 * must land in the screen px the camera + picking + HUD layouts work in — the backing store divided by
 * `resolution`, the renderer's device-px-per-screen-px (`app.renderer.resolution`: devicePixelRatio for
 * the HiDPI window canvas, 1 for the deterministic `?shot` canvas — every caller passes its app's live
 * value). The live entries keep CSS and screen px 1:1 (`createWindowPixiApp` + `autoDensity` CSS-size
 * the canvas to the logical size), so this is normally identity — but it stays exact for any embedding
 * where they diverge (a fixed-size canvas, a resize not yet flushed), else a drag pans faster than the
 * cursor, a wheel zoom anchors off the cursor, and a click picks the wrong tile. The `rect` is returned
 * so a handler can subtract the canvas origin in CSS px *before* scaling. Guards a zero-size
 * (unlaid-out) canvas. Shared by the camera controller and the selection controller
 * (`view/unit-controls/`).
 */
export function screenScale(
  canvas: HTMLCanvasElement,
  resolution: number,
): { sx: number; sy: number; rect: DOMRect } {
  const rect = canvas.getBoundingClientRect();
  return {
    sx: rect.width === 0 ? 1 : canvas.width / resolution / rect.width,
    sy: rect.height === 0 ? 1 : canvas.height / resolution / rect.height,
    rect,
  };
}

/** Apply a {@link screenScale} result to a client (CSS) point → canvas (screen) px: subtract the canvas
 *  origin in CSS px, then scale. The building block behind {@link clientToScreen}; `hud/` handlers can't
 *  import `view/`, so they apply this same mapping inline over their injected scale. */
function clientToCanvas(
  scale: { sx: number; sy: number; rect: DOMRect },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: (clientX - scale.rect.left) * scale.sx, y: (clientY - scale.rect.top) * scale.sy };
}

/** Client (CSS) point → canvas (screen) px in one call ({@link screenScale} then {@link clientToCanvas}) —
 *  the one composition the camera, tool panel, unit controls, settler ring and map view share, so the
 *  `app.renderer.resolution` threading and anchor math can't drift between drag, zoom, pick and placement. */
export function clientToScreen(
  canvas: HTMLCanvasElement,
  resolution: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return clientToCanvas(screenScale(canvas, resolution), clientX, clientY);
}
