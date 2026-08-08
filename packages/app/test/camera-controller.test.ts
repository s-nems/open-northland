import type { Camera } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CameraController,
  createCameraController,
  EDGE_SCROLL_MARGIN,
} from '../src/view/camera/index.js';

/** Which DOM events arm and disarm the camera controller's RTS edge-scroll probe. */

const CANVAS_W = 800;
const CANVAS_H = 600;
/** A pointer x inside the left edge band, so an armed probe pans on the next `update`. */
const LEFT_BAND_X = EDGE_SCROLL_MARGIN / 2;
const CENTRE_Y = CANVAS_H / 2;

type Listener = (event: unknown) => void;

/** A minimal `addEventListener` target the test can fire events at. */
const eventTarget = () => {
  const byType = new Map<string, Set<Listener>>();
  return {
    addEventListener: (type: string, fn: Listener): void => {
      const registered = byType.get(type);
      if (registered) registered.add(fn);
      else byType.set(type, new Set([fn]));
    },
    removeEventListener: (type: string, fn: Listener): void => {
      byType.get(type)?.delete(fn);
    },
    emit: (type: string, event: unknown = {}): void => {
      for (const fn of [...(byType.get(type) ?? [])]) fn(event);
    },
  };
};

const install = () => {
  const win = eventTarget();
  const canvasEvents = eventTarget();
  const canvas = {
    width: CANVAS_W,
    height: CANVAS_H,
    getBoundingClientRect: () => ({ width: CANVAS_W, height: CANVAS_H, left: 0, top: 0 }) as DOMRect,
    addEventListener: canvasEvents.addEventListener,
    removeEventListener: canvasEvents.removeEventListener,
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { hasFocus: () => true });
  const start: Camera = { offsetX: 0, offsetY: 0 };
  const ctl = createCameraController(canvas, start, () => 1);
  return {
    ctl,
    win,
    canvasEvents,
    /** Fire a `mousemove` whose hit target is the canvas unless `over` names another element. */
    move: (x: number, y: number, over: unknown = canvas): void => {
      win.emit('mousemove', { clientX: x, clientY: y, target: over });
    },
  };
};

/** One frame of held-input pan, reported as the offset it moved (0 = the probe is disarmed). */
const panStep = (ctl: CameraController): number => {
  const before = ctl.camera().offsetX;
  ctl.update(16);
  return ctl.camera().offsetX - before;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCameraController edge-scroll arming', () => {
  it('arms on a mousemove over the canvas, with no boundary crossing first', () => {
    const { ctl, move } = install();
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('resumes after a blur while the cursor rests over the canvas', () => {
    const { ctl, win, move } = install();
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    // Alt-tab away: blur must stop the pan.
    win.emit('blur');
    expect(panStep(ctl)).toBe(0);
    // Alt-tab back and move: no `mouseenter` fires, because the cursor never left the canvas.
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('disarms on a mousemove over a DOM element stacked above the canvas', () => {
    const { ctl, move } = install();
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    move(LEFT_BAND_X, CENTRE_Y, { modalBackdrop: true });
    expect(panStep(ctl)).toBe(0);
    // Closing the window puts the cursor back on the canvas: the next move re-arms.
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('disarms on mouseleave, the crossing that carries the cursor out of the window', () => {
    const { ctl, canvasEvents, move } = install();
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    canvasEvents.emit('mouseleave');
    expect(panStep(ctl)).toBe(0);
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('does not pan before any pointer sample lands', () => {
    const { ctl } = install();
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });
});
