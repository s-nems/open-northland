import type { WorldBounds } from '@open-northland/render';
import { contains } from '../geometry.js';
import { type MinimapLayout, minimapToWorld, pointOverMinimapHole } from './model.js';

export interface MinimapInputOptions {
  readonly canvas: HTMLCanvasElement;
  readonly bounds: WorldBounds;
  readonly layout: () => MinimapLayout;
  readonly enabled: () => boolean;
  readonly toScreenPx: (x: number, y: number) => { x: number; y: number };
  readonly onJump: (x: number, y: number) => void;
  readonly onOrder?: (x: number, y: number, event: MouseEvent) => boolean;
  readonly onZoom: (delta: number, anchor: { x: number; y: number }) => void;
  readonly onPan: (dx: number, dy: number) => void;
}

/** Canvas listeners keep DOM frame controls out of world input. Middle drag pans the atlas alone. */
export function createMinimapInput(opts: MinimapInputOptions): {
  dragging(): boolean;
  cancel(): void;
  dispose(): void;
} {
  let drag: 'camera' | 'atlas' | null = null;
  let last = { x: 0, y: 0 };
  const spotAt = (x: number, y: number): { x: number; y: number } => {
    const layout = opts.layout();
    const left = Math.max(layout.map.x, layout.inner.x);
    const top = Math.max(layout.map.y, layout.inner.y);
    const right = Math.min(layout.map.x + layout.map.w, layout.inner.x + layout.inner.w);
    const bottom = Math.min(layout.map.y + layout.map.h, layout.inner.y + layout.inner.h);
    return minimapToWorld(
      layout,
      opts.bounds,
      Math.max(left, Math.min(right, x)),
      Math.max(top, Math.min(bottom, y)),
    );
  };
  const down = (event: MouseEvent): void => {
    if (!opts.enabled()) return;
    const point = opts.toScreenPx(event.clientX, event.clientY);
    const layout = opts.layout();
    if (!pointOverMinimapHole(layout, point.x, point.y) || !contains(layout.map, point.x, point.y)) return;
    if (event.button === 1) {
      drag = 'atlas';
      last = point;
    } else {
      const spot = spotAt(point.x, point.y);
      if (opts.onOrder?.(spot.x, spot.y, event) === true) {
        event.preventDefault();
        return;
      }
      if (event.button !== 0) return;
      drag = 'camera';
      opts.onJump(spot.x, spot.y);
    }
    event.preventDefault();
  };
  const move = (event: MouseEvent): void => {
    if (drag === null || !opts.enabled()) return;
    const point = opts.toScreenPx(event.clientX, event.clientY);
    if (drag === 'atlas') {
      const { scaleX, scaleY } = opts.layout();
      if (scaleX > 0 && scaleY > 0) opts.onPan((last.x - point.x) / scaleX, (last.y - point.y) / scaleY);
      last = point;
    } else {
      const spot = spotAt(point.x, point.y);
      opts.onJump(spot.x, spot.y);
    }
  };
  const up = (event: MouseEvent): void => {
    if ((drag === 'camera' && event.button === 0) || (drag === 'atlas' && event.button === 1)) drag = null;
  };
  const cancel = (): void => {
    drag = null;
  };
  const wheel = (event: WheelEvent): void => {
    if (!opts.enabled()) return;
    const point = opts.toScreenPx(event.clientX, event.clientY);
    if (!pointOverMinimapHole(opts.layout(), point.x, point.y)) return;
    event.preventDefault();
    if (event.deltaY !== 0) opts.onZoom(event.deltaY < 0 ? 1 : -1, spotAt(point.x, point.y));
  };
  opts.canvas.addEventListener('mousedown', down);
  opts.canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  window.addEventListener('blur', cancel);
  return {
    dragging: () => drag !== null,
    cancel,
    dispose: () => {
      opts.canvas.removeEventListener('mousedown', down);
      opts.canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', cancel);
    },
  };
}
