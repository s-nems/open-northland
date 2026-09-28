import type { MapViewTarget } from '@open-northland/render';
import type { ClientRect } from '../portrait-hole.js';
import type { ViewSlot } from './markup.js';

/** One world view the open book shows: its box and the part of it inside the page, in client px. */
export interface BookView {
  /** The view's slot in the page's flow (`data-view`). */
  readonly slot: number;
  readonly box: ClientRect;
  readonly clip: ClientRect;
  /** The box's width in design px, which sets the world's scale in it. */
  readonly designW: number;
  readonly target: MapViewTarget;
  /** Where the target lands, design px from the box's top-left. */
  readonly focusX: number;
  readonly focusY: number;
  readonly zoom: number;
  readonly soloFill?: number;
  /** A canvas the renderer copies the drawn view into this frame. */
  readonly still?: HTMLCanvasElement;
}

function intersect(a: ClientRect, b: ClientRect): ClientRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/**
 * The world views on the shown spread, read off the laid-out page with their visible part. A view
 * outside its page window (another spread's column) is left out. Reads the layout: it runs on a
 * layout change, never per frame.
 */
export function measureViews(
  spread: HTMLElement,
  slots: readonly ViewSlot[],
  k: number,
): readonly BookView[] {
  const views: BookView[] = [];
  for (const lens of spread.querySelectorAll<HTMLElement>('.on-book__lens')) {
    const index = Number(lens.parentElement?.dataset.view);
    const slot = slots[index];
    const win = lens.closest<HTMLElement>('.on-book__window');
    const target = slot?.icon.target ?? null;
    if (slot === undefined || target === null || win === null) continue;
    const outer = lens.getBoundingClientRect();
    const box: ClientRect = {
      left: outer.left + lens.clientLeft * k,
      top: outer.top + lens.clientTop * k,
      width: lens.clientWidth * k,
      height: lens.clientHeight * k,
    };
    const clip = intersect(box, win.getBoundingClientRect());
    if (clip === null) continue;
    const { icon, zoom } = slot;
    const designW = lens.clientWidth;
    const designH = lens.clientHeight;
    views.push({
      slot: index,
      box,
      clip,
      designW,
      target,
      // A map view centres its target; a card keeps the figure's feet where the original's did.
      focusX: icon.soloFill === undefined ? designW / 2 : icon.focusX * zoom,
      focusY: icon.soloFill === undefined ? designH / 2 + (icon.focusY - icon.h / 2) : icon.focusY * zoom,
      zoom,
      ...(icon.soloFill !== undefined ? { soloFill: icon.soloFill } : {}),
    });
  }
  return views;
}

/**
 * Cut `clips` (client px) out of `layer`, so the canvas the renderer paints under them shows through
 * it: every hole is one mask layer, excluded from a whole layer under them all (foundation.css).
 */
export function maskHoles(layer: HTMLElement, clips: readonly ClientRect[]): void {
  if (clips.length === 0) {
    layer.style.removeProperty('mask-image');
    layer.style.removeProperty('mask-size');
    layer.style.removeProperty('mask-position');
    return;
  }
  const origin = layer.getBoundingClientRect();
  // Client px per px of the layer's own box: the plane's scale, times the book's inside it.
  const k = layer.offsetWidth === 0 ? 1 : origin.width / layer.offsetWidth;
  const whole = 'linear-gradient(#000 0 0)';
  layer.style.setProperty('mask-image', [...clips.map(() => whole), whole].join(', '));
  layer.style.setProperty(
    'mask-size',
    [...clips.map((c) => `${c.width / k}px ${c.height / k}px`), '100% 100%'].join(', '),
  );
  layer.style.setProperty(
    'mask-position',
    [...clips.map((c) => `${(c.left - origin.left) / k}px ${(c.top - origin.top) / k}px`), '0 0'].join(', '),
  );
}
