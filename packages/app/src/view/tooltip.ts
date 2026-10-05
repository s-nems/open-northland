/**
 * A cursor-following text chip. It is DOM, not Pixi, so it floats above the WebGL canvas. One instance
 * per hover surface; surfaces are mutually exclusive by cursor position and need no coordination.
 */

/** How far below-right of the cursor the chip sits, so it never hides the pixel being pointed at. */
const CURSOR_OFFSET = 14;
/** The chip wraps at this width (CSS px) instead of running as one endless row. */
const MAX_WIDTH = 300;
/** Minimum gap kept between the chip and the viewport edges when clamping (CSS px). */
const EDGE_MARGIN = 6;

/** Where a chip of `width` × `height` goes for a cursor at (`clientX`, `clientY`): below-right of it,
 *  pulled in from the right edge, and above the cursor when the bottom edge is too near. */
export function chipPlacement(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { readonly left: number; readonly top: number } {
  const left = Math.min(clientX + CURSOR_OFFSET, viewportWidth - width - EDGE_MARGIN);
  const below = clientY + CURSOR_OFFSET;
  const top = below + height + EDGE_MARGIN > viewportHeight ? clientY - CURSOR_OFFSET - height : below;
  return { left: Math.max(EDGE_MARGIN, left), top: Math.max(EDGE_MARGIN, top) };
}

export interface Tooltip {
  /** Anchors `text` below-right of a client (CSS) point, above it when the bottom edge is near. */
  show(clientX: number, clientY: number, text: string): void;
  hide(): void;
  destroy(): void;
}

/** The chip is attached to `document.body` and stays hidden until the first `show`. */
export function createTooltip(opts: { readonly zIndex?: number } = {}): Tooltip {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    `z-index:${opts.zIndex ?? 2000}`,
    'pointer-events:none', // never eat a click meant for the canvas / HUD
    'display:none',
    'padding:2px 8px',
    'border-radius:3px',
    'background:rgba(20,16,10,0.92)',
    'color:#f0e0c0',
    'font:13px/1.4 system-ui,-apple-system,sans-serif',
    // `pre-line` keeps authored newlines while still wrapping an over-long single line.
    `max-width:${MAX_WIDTH}px`,
    'width:max-content',
    'white-space:pre-line',
    'border:1px solid rgba(200,170,110,0.5)',
    'box-shadow:0 1px 4px rgba(0,0,0,0.5)',
  ].join(';');
  document.body.appendChild(el);
  let shownText = '';
  let visible = false;
  return {
    show(clientX, clientY, text): void {
      if (text !== shownText) {
        el.textContent = text;
        shownText = text;
      }
      if (!visible) {
        el.style.display = 'block';
        visible = true;
      }
      // Clamped after the text is set and the chip shown, so the measured width is the final one.
      const { left, top } = chipPlacement(
        clientX,
        clientY,
        el.offsetWidth,
        el.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      );
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    hide(): void {
      if (visible) {
        el.style.display = 'none';
        visible = false;
      }
    },
    destroy(): void {
      el.remove();
    },
  };
}
