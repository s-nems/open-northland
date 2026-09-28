import type { WorldSnapshot } from '@open-northland/sim';
import { setCanvasCursor } from '../cursors/element.js';

export interface SelectionCursorOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: () => { readonly offsetX: number; readonly offsetY: number; readonly scale?: number };
  readonly viewerVersion: () => number;
  readonly blocked: (clientX: number, clientY: number) => boolean;
  readonly toWorld: (clientX: number, clientY: number) => { readonly x: number; readonly y: number };
  readonly selectionAt: (wx: number, wy: number) => number | null;
}

/** Reuse click selection, including door badges and work flags, only when its inputs change. */
export function createSelectionCursor(opts: SelectionCursorOptions): {
  update(snapshot: WorldSnapshot): void;
  dispose(): void;
} {
  const scope = new AbortController();
  let inside = false;
  let clientX = 0;
  let clientY = 0;
  let dirty = true;
  let lastSnapshot: WorldSnapshot | null = null;
  let cameraX = 0;
  let cameraY = 0;
  let cameraScale = 1;
  let viewerVersion = -1;
  const clear = (): void => {
    lastSnapshot = null;
    setCanvasCursor(opts.canvas, 'hover', null);
  };
  const update = (snapshot: WorldSnapshot): void => {
    if (!inside) return;
    if (opts.blocked(clientX, clientY)) {
      clear();
      return;
    }
    const camera = opts.camera();
    const version = opts.viewerVersion();
    if (
      !dirty &&
      lastSnapshot === snapshot &&
      cameraX === camera.offsetX &&
      cameraY === camera.offsetY &&
      cameraScale === (camera.scale ?? 1) &&
      viewerVersion === version
    )
      return;
    dirty = false;
    lastSnapshot = snapshot;
    cameraX = camera.offsetX;
    cameraY = camera.offsetY;
    cameraScale = camera.scale ?? 1;
    viewerVersion = version;
    const point = opts.toWorld(clientX, clientY);
    setCanvasCursor(opts.canvas, 'hover', opts.selectionAt(point.x, point.y) === null ? null : 'select');
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    dirty ||= !inside || clientX !== event.clientX || clientY !== event.clientY;
    inside = true;
    clientX = event.clientX;
    clientY = event.clientY;
  };
  const leave = (): void => {
    inside = false;
    clear();
  };
  opts.canvas.addEventListener('pointermove', move, { signal: scope.signal });
  opts.canvas.addEventListener('pointerenter', move, { signal: scope.signal });
  opts.canvas.addEventListener('pointerleave', leave, { signal: scope.signal });
  window.addEventListener('blur', leave, { signal: scope.signal });
  return {
    update,
    dispose: () => {
      scope.abort();
      leave();
    },
  };
}
