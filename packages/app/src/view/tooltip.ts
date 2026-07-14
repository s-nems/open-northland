/**
 * A cursor-following text tooltip — a small dark chip that names what's under the pointer (a ground pile's
 * good + count, a warehouse row's good). It is DOM, not Pixi: the chip must float above the WebGL canvas and
 * a per-hover text element has no place in the retained sprite batcher. One instance per hover surface (the
 * world, the warehouse panel); they are mutually exclusive by cursor position, so each surface owning its
 * own element needs no cross-surface coordination.
 */

/** How far below-right of the cursor the chip sits, so it never hides the pixel being pointed at. */
const CURSOR_OFFSET = 14;

export interface Tooltip {
  /** Show `text` anchored just below-right of the client (CSS) point; a no-op reposition when already shown. */
  show(clientX: number, clientY: number, text: string): void;
  hide(): void;
  destroy(): void;
}

/** Create a tooltip chip attached to `document.body` (hidden until first {@link Tooltip.show}). */
export function createTooltip(): Tooltip {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'z-index:2000',
    'pointer-events:none', // never eat a click meant for the canvas / HUD
    'display:none',
    'padding:2px 8px',
    'border-radius:3px',
    'background:rgba(20,16,10,0.92)',
    'color:#f0e0c0',
    'font:13px/1.4 system-ui,-apple-system,sans-serif',
    'white-space:nowrap',
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
      el.style.left = `${clientX + CURSOR_OFFSET}px`;
      el.style.top = `${clientY + CURSOR_OFFSET}px`;
      if (!visible) {
        el.style.display = 'block';
        visible = true;
      }
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
