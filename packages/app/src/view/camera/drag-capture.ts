import { diag } from '../../diag/log.js';
import { createDragJumpFilter, type DragStep, type DroppedJump } from './drag-jump-filter.js';

/** Hides the cursor and makes every page element inert while a drag scroll runs. */
export const DRAG_SCROLL_CLASS = 'on-drag-scroll';

/**
 * Holds the cursor for a middle-button drag scroll, the RTS convention: the cursor stays where the press
 * landed, the mouse moves only the view, and release shows the cursor at the same spot. Pointer lock
 * gives that, including drags past the screen edge. When the browser refuses the lock (a relock right
 * after Escape, a browser without the API) the drag reads client deltas and the page class still keeps
 * HUD chrome from reacting to the hidden cursor.
 */
export interface DragCapture {
  /** Call from the press handler: a browser grants the lock only inside a user gesture. */
  begin(clientX: number, clientY: number): void;
  /** Mouse movement in client px to pan by for this move, with a reported jump the hand never made
   *  filtered out (see `drag-jump-filter.ts`). */
  step(event: MouseEvent): { readonly dx: number; readonly dy: number };
  end(): void;
  dispose(): void;
}

/** `onLost` fires when the browser drops a granted lock mid-drag, as Escape does. */
export function createDragCapture(target: HTMLElement, onLost: () => void): DragCapture {
  let active = false;
  let locked = false;
  // Chromium's first move after a grant can carry the distance to wherever it last saw the cursor.
  let skipFirstLockedMove = false;
  let lastX = 0;
  let lastY = 0;
  let lastMoveAtMs: number | undefined;
  const jumpFilter = createDragJumpFilter();
  const holdsLock = (): boolean => document.pointerLockElement === target;
  const release = (): void => {
    if (holdsLock()) document.exitPointerLock();
  };
  const onLockChange = (): void => {
    const nowLocked = holdsLock();
    // The grant can land after a quick release already ended the drag.
    if (nowLocked && !active) {
      release();
      return;
    }
    const lost = locked && !nowLocked && active;
    if (nowLocked && !locked) skipFirstLockedMove = true;
    locked = nowLocked;
    if (lost) onLost();
  };
  document.addEventListener('pointerlockchange', onLockChange);

  const logDropped = (dropped: DroppedJump | undefined): void => {
    if (dropped === undefined) return;
    diag.warn('camera', `drag scroll dropped a reported mouse jump (${dropped.reason})`, {
      locked,
      steps: dropped.steps,
    });
  };

  const end = (): void => {
    if (active) logDropped(jumpFilter.reset());
    active = false;
    locked = false;
    document.body?.classList.remove(DRAG_SCROLL_CLASS);
    release();
  };

  const rawStep = (event: MouseEvent): DragStep => {
    const dtMs =
      lastMoveAtMs !== undefined && Number.isFinite(event.timeStamp)
        ? event.timeStamp - lastMoveAtMs
        : undefined;
    lastMoveAtMs = Number.isFinite(event.timeStamp) ? event.timeStamp : undefined;
    if (locked) {
      if (!skipFirstLockedMove) return { dx: event.movementX, dy: event.movementY, dtMs };
      skipFirstLockedMove = false;
      return { dx: 0, dy: 0, dtMs };
    }
    const delta = { dx: event.clientX - lastX, dy: event.clientY - lastY, dtMs };
    lastX = event.clientX;
    lastY = event.clientY;
    return delta;
  };

  return {
    begin: (clientX, clientY) => {
      active = true;
      lastX = clientX;
      lastY = clientY;
      lastMoveAtMs = undefined;
      jumpFilter.reset();
      document.body?.classList.add(DRAG_SCROLL_CLASS);
      // Older engines return nothing and report a refusal through `pointerlockerror` instead.
      target.requestPointerLock?.()?.catch(() => undefined);
    },
    step: (event) => {
      const { dx, dy, dropped } = jumpFilter.step(rawStep(event));
      logDropped(dropped);
      return { dx, dy };
    },
    end,
    dispose: () => {
      end();
      document.removeEventListener('pointerlockchange', onLockChange);
    },
  };
}
