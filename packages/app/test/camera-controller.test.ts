import type { Camera } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '../src/hud/keybindings.js';
import {
  type CameraController,
  type CameraInputSettings,
  createCameraController,
  EDGE_SCROLL_MARGIN,
} from '../src/view/camera/index.js';

/** Which DOM events arm and disarm the camera controller's RTS edge-scroll probe, and which key
 *  bindings drive the held-key pan. */

const CANVAS_W = 800;
const CANVAS_H = 600;
/** A pointer x inside the left edge band, so an armed probe pans on the next `update`. */
const LEFT_BAND_X = EDGE_SCROLL_MARGIN / 2;
const CENTRE_Y = CANVAS_H / 2;
const DEFAULT_INPUT_SETTINGS: CameraInputSettings = {
  keyboardScrollSpeed: 1,
  edgeScrollSpeed: 1,
  dragScrollSpeed: 1,
  edgeScrollEnabled: true,
  invertDragScroll: false,
};

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

const install = (
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
  inputSettings: CameraInputSettings = DEFAULT_INPUT_SETTINGS,
) => {
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
  // The typing-target guard probes these DOM classes, which the node test environment lacks.
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('HTMLElement', class {});
  const start: Camera = { offsetX: 0, offsetY: 0 };
  const ctl = createCameraController(canvas, start, () => 1, bindings, inputSettings);
  return {
    ctl,
    win,
    canvasEvents,
    /** Fire a `mousemove` whose hit target is the canvas unless `over` names another element. */
    move: (x: number, y: number, over: unknown = canvas): void => {
      win.emit('mousemove', { clientX: x, clientY: y, target: over });
    },
    press: (code: string, modifiers: Partial<KeyboardEvent> = {}): void => {
      win.emit('keydown', {
        code,
        target: null,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: (): void => undefined,
        ...modifiers,
      });
    },
    release: (code: string): void => {
      win.emit('keyup', { code });
    },
    startMiddleDrag: (x: number, y: number): void => {
      canvasEvents.emit('mousedown', {
        button: 1,
        clientX: x,
        clientY: y,
        preventDefault: (): void => undefined,
      });
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

describe('createCameraController pan bindings', () => {
  it('pans while the bound key is held and stops on keyup', () => {
    const { ctl, press, release } = install();
    press('ArrowLeft');
    expect(panStep(ctl)).toBeGreaterThan(0);
    release('ArrowLeft');
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('follows a rebound pan key and ignores the freed default arrow', () => {
    const { ctl, press, release } = install({ ...DEFAULT_KEY_BINDINGS, panLeft: 'KeyJ' });
    press('ArrowLeft');
    expect(panStep(ctl)).toBe(0);
    press('KeyJ');
    expect(panStep(ctl)).toBeGreaterThan(0);
    release('KeyJ');
    ctl.dispose();
  });

  it('reads a changed pan binding without remounting the controller', () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS } as Record<keyof typeof DEFAULT_KEY_BINDINGS, string | null>;
    const { ctl, press, release } = install(bindings);

    bindings.panLeft = 'Alt+KeyJ';
    ctl.setBindings(bindings);
    press('ArrowLeft');
    expect(panStep(ctl)).toBe(0);
    press('KeyJ', { altKey: true });
    expect(panStep(ctl)).toBeGreaterThan(0);
    release('KeyJ');
    ctl.dispose();
  });

  it('never pans on an unbound action', () => {
    const { ctl, press } = install({ ...DEFAULT_KEY_BINDINGS, panLeft: null });
    press('ArrowLeft');
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('stops a modifier chord when its modifier is released first', () => {
    const { ctl, press, release } = install({ ...DEFAULT_KEY_BINDINGS, panLeft: 'Meta+KeyJ' });
    press('KeyJ', { metaKey: true });
    expect(panStep(ctl)).toBeGreaterThan(0);
    release('MetaLeft');
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });
});

describe('createCameraController input settings', () => {
  it('scales middle-button dragging and can invert its direction live', () => {
    const { ctl, move, startMiddleDrag } = install();
    startMiddleDrag(100, 100);
    move(120, 100);
    expect(ctl.camera().offsetX).toBe(20);

    ctl.setInputSettings({ ...DEFAULT_INPUT_SETTINGS, dragScrollSpeed: 2, invertDragScroll: true });
    startMiddleDrag(120, 100);
    move(130, 100);
    expect(ctl.camera().offsetX).toBe(0);
    ctl.dispose();
  });

  it('scales, disables, and re-enables edge scrolling live', () => {
    const { ctl, move } = install();
    move(LEFT_BAND_X, CENTRE_Y);
    ctl.setInputSettings({ ...DEFAULT_INPUT_SETTINGS, edgeScrollSpeed: 1 });
    const baseStep = panStep(ctl);
    ctl.setInputSettings({ ...DEFAULT_INPUT_SETTINGS, edgeScrollSpeed: 2 });
    expect(panStep(ctl)).toBeCloseTo(baseStep * 2);

    ctl.setInputSettings({ ...DEFAULT_INPUT_SETTINGS, edgeScrollEnabled: false });
    expect(panStep(ctl)).toBe(0);
    ctl.setInputSettings({ ...DEFAULT_INPUT_SETTINGS, edgeScrollSpeed: 3 });
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('scales keyboard scrolling independently from drag and edge speeds', () => {
    const { ctl, press, release } = install();
    press('ArrowLeft');
    const baseStep = panStep(ctl);
    ctl.setInputSettings({ ...DEFAULT_INPUT_SETTINGS, keyboardScrollSpeed: 2 });
    expect(panStep(ctl)).toBeCloseTo(baseStep * 2);
    release('ArrowLeft');
    ctl.dispose();
  });
});

describe('createCameraController suspension', () => {
  it('cancels a middle drag and held key until fresh input arrives', () => {
    const { ctl, move, press, startMiddleDrag } = install();
    startMiddleDrag(400, 300);
    press('ArrowLeft');
    ctl.setSuspended(true);
    const before = ctl.camera();

    move(500, 300);
    ctl.update(16);
    expect(ctl.camera()).toEqual(before);

    ctl.setSuspended(false);
    ctl.update(16);
    expect(ctl.camera()).toEqual(before);
    ctl.dispose();
  });
});
