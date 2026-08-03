import { clientToCanvas } from '../../hud/geometry.js';

/**
 * CSS-px to Pixi-screen-px scale, with the `rect` so a caller can subtract the canvas origin in CSS px
 * before scaling. `resolution` is the renderer's device-px per screen-px; a zero-size canvas scales 1:1.
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

export function clientToScreen(
  canvas: HTMLCanvasElement,
  resolution: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return clientToCanvas(screenScale(canvas, resolution), clientX, clientY);
}
