import type { MapViewTarget } from '@open-northland/render';
import type { ClientRect } from '../portrait-hole.js';
import type { ViewSlot } from './markup.js';

/** One world view the open book shows: its box and the part of it inside the page, in client px. */
export interface BookView {
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
}

/** A hole in the painted cover, design px from its border box. */
interface Hole {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function intersect(a: ClientRect, b: ClientRect): ClientRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/**
 * The world views on the shown spread, read off the laid-out page, and one hole cut into `cover` per
 * view, so the canvas the renderer paints them on shows through the book. A view outside its page
 * window (another spread's column) gets neither. Reads the layout: it runs on a layout change, never
 * per frame.
 */
export function cutViewHoles(
  cover: HTMLElement,
  spread: HTMLElement,
  slots: readonly ViewSlot[],
): readonly BookView[] {
  const views: BookView[] = [];
  const holes: Hole[] = [];
  const coverBox = cover.getBoundingClientRect();
  // Client px per design px of the book: the plane's scale times the book's own.
  const k = cover.offsetWidth === 0 ? 1 : coverBox.width / cover.offsetWidth;
  for (const lens of spread.querySelectorAll<HTMLElement>('.on-book__lens')) {
    const slot = slots[Number(lens.parentElement?.dataset.view)];
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
    holes.push({
      x: (clip.left - coverBox.left) / k,
      y: (clip.top - coverBox.top) / k,
      w: clip.width / k,
      h: clip.height / k,
    });
  }
  maskHoles(cover, holes);
  return views;
}

/** Every hole is one mask layer, excluded from a whole layer under them all (foundation.css). */
export function maskHoles(cover: HTMLElement, holes: readonly Hole[]): void {
  if (holes.length === 0) {
    cover.style.removeProperty('mask-image');
    cover.style.removeProperty('mask-size');
    cover.style.removeProperty('mask-position');
    return;
  }
  const whole = 'linear-gradient(#000 0 0)';
  cover.style.setProperty('mask-image', [...holes.map(() => whole), whole].join(', '));
  cover.style.setProperty('mask-size', [...holes.map((h) => `${h.w}px ${h.h}px`), '100% 100%'].join(', '));
  cover.style.setProperty('mask-position', [...holes.map((h) => `${h.x}px ${h.y}px`), '0 0'].join(', '));
}
