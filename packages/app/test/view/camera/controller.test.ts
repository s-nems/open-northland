import type { Camera } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diag } from '../../../src/diag/log.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '../../../src/hud/keybindings.js';
import { DRAG_SCROLL_CLASS, DRAG_SCROLL_FREE_CLASS } from '../../../src/view/camera/drag-capture.js';
import { JUMP_FLOOR_PX } from '../../../src/view/camera/drag-jump-filter.js';
import {
  type CameraController,
  type CameraInputSettings,
  createCameraController,
  DEBUG_MIN_ZOOM,
  EDGE_SCROLL_MARGIN,
  HUD_EDGE_SCROLL_REACH,
  MAP_EDGE_MARGIN,
  MAP_TOP_MARGIN,
  MIN_ZOOM,
} from '../../../src/view/camera/index.js';

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
  integerScaling: false,
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

const classList = () => {
  const names = new Set<string>();
  return {
    add: (name: string): void => {
      names.add(name);
    },
    remove: (...removed: string[]): void => {
      for (const name of removed) names.delete(name);
    },
    toggle: (name: string, force?: boolean): boolean => {
      const next = force ?? !names.has(name);
      if (next) names.add(name);
      else names.delete(name);
      return next;
    },
    contains: (name: string): boolean => names.has(name),
  };
};

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0';

const install = (
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
  inputSettings: CameraInputSettings = DEFAULT_INPUT_SETTINGS,
  userAgent = CHROME_USER_AGENT,
  resolution: () => number = () => 1,
) => {
  // A window smaller than its display unless a test fills the screen, as fullscreen does.
  const win = Object.assign(eventTarget(), {
    innerWidth: CANVAS_W,
    innerHeight: CANVAS_H,
    screen: { width: CANVAS_W * 2, height: CANVAS_H * 2 },
  });
  const canvasEvents = eventTarget();
  const bodyClasses = classList();
  const docEvents = eventTarget();
  // A browser that refuses the pointer lock unless a test grants it; the drag then reads client deltas.
  const lock = { grantLock: false, element: null as unknown };
  const doc = {
    hasFocus: () => true,
    body: { classList: bodyClasses },
    get pointerLockElement(): unknown {
      return lock.element;
    },
    exitPointerLock: (): void => {
      lock.element = null;
      docEvents.emit('pointerlockchange');
    },
    addEventListener: docEvents.addEventListener,
    removeEventListener: docEvents.removeEventListener,
  };
  const canvas = {
    width: CANVAS_W,
    height: CANVAS_H,
    getBoundingClientRect: () => ({ width: CANVAS_W, height: CANVAS_H, left: 0, top: 0 }) as DOMRect,
    addEventListener: canvasEvents.addEventListener,
    removeEventListener: canvasEvents.removeEventListener,
    requestPointerLock: (): Promise<void> => {
      if (!lock.grantLock) return Promise.reject(new Error('refused'));
      lock.element = canvas;
      docEvents.emit('pointerlockchange');
      return Promise.resolve();
    },
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { userAgent });
  // The typing-target guard probes these DOM classes, which the node test environment lacks.
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('HTMLElement', class {});
  const start: Camera = { offsetX: 0, offsetY: 0 };
  const ctl = createCameraController(canvas, start, resolution, bindings, inputSettings);
  return {
    ctl,
    win,
    fillScreen: (): void => {
      win.screen = { width: CANVAS_W, height: CANVAS_H };
    },
    canvasEvents,
    lock,
    locked: (): boolean => lock.element === canvas,
    /** The browser dropping the lock on its own, as Escape does. */
    loseLock: (): void => {
      lock.element = null;
      docEvents.emit('pointerlockchange');
    },
    cursorHidden: (): boolean => bodyClasses.contains(DRAG_SCROLL_CLASS),
    cursorGrabs: (): boolean => bodyClasses.contains(DRAG_SCROLL_FREE_CLASS),
    /** Fire a `mousemove` whose hit target is the canvas unless `over` names another element. */
    move: (x: number, y: number, over: unknown = canvas): void => {
      win.emit('mousemove', { clientX: x, clientY: y, target: over });
    },
    /** A locked mouse: the cursor stays at the press, only the movement changes. */
    moveLocked: (movementX: number, movementY: number, x = 0, y = 0): void => {
      win.emit('mousemove', { clientX: x, clientY: y, movementX, movementY, target: canvas });
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

/** Enough wheel-out notches and glide frames to reach any zoom-out floor from scale 1. */
const WHEEL_OUT_NOTCHES = 60;
const GLIDE_FRAMES = 200;
const FRAME_MS = 16;

const wheelOutFully = (
  ctl: CameraController,
  canvasEvents: ReturnType<typeof install>['canvasEvents'],
): number => {
  for (let i = 0; i < WHEEL_OUT_NOTCHES; i++) {
    canvasEvents.emit('wheel', {
      clientX: 100,
      clientY: 100,
      deltaY: 1,
      preventDefault: (): void => undefined,
    });
  }
  for (let i = 0; i < GLIDE_FRAMES; i++) ctl.update(FRAME_MS);
  return ctl.camera().scale ?? 1;
};

describe('createCameraController edge-scroll arming', () => {
  it('leaves middle dragging on a claimed minimap point to the HUD', () => {
    const { ctl, startMiddleDrag, move, cursorHidden } = install();
    ctl.setPointerGuard((x) => x < 300);
    startMiddleDrag(100, 400);
    move(140, 410);
    expect(ctl.camera()).toEqual({ offsetX: 0, offsetY: 0 });
    expect(cursorHidden()).toBe(false);
    startMiddleDrag(400, 400);
    move(440, 410);
    expect(ctl.camera()).toEqual({ offsetX: 40, offsetY: 10 });
    ctl.dispose();
  });

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

  it('narrows the band over HUD chrome without slowing the pan at the screen edge', () => {
    const { ctl, move } = install();
    const edgeX = HUD_EDGE_SCROLL_REACH / 2;
    move(edgeX, CENTRE_Y);
    const overMap = panStep(ctl);
    ctl.setPointerGuard(() => true);
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBe(0);
    move(edgeX, CENTRE_Y);
    expect(panStep(ctl)).toBeCloseTo(overMap);
    ctl.dispose();
  });

  it('holds while an edge hold claims the camera', () => {
    const { ctl, move } = install();
    let held = true;
    ctl.setEdgeHold(() => held);
    move(LEFT_BAND_X, CENTRE_Y);
    expect(panStep(ctl)).toBe(0);
    held = false;
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('ignores a pointer outside the canvas rectangle', () => {
    const { ctl, move } = install();
    move(-LEFT_BAND_X, CENTRE_Y, { pageMargin: true });
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('hit-tests the HUD only for a pointer inside the edge band', () => {
    const { ctl, move } = install();
    const guard = vi.fn(() => true);
    ctl.setPointerGuard(guard);
    move(CANVAS_W / 2, CENTRE_Y);
    panStep(ctl);
    expect(guard).not.toHaveBeenCalled();
    move(LEFT_BAND_X, CENTRE_Y);
    panStep(ctl);
    expect(guard).toHaveBeenCalled();
    ctl.dispose();
  });

  it('keeps scrolling at full speed toward the edge the cursor left a fullscreen window through', () => {
    const { ctl, win, move, fillScreen } = install();
    fillScreen();
    move(0, CENTRE_Y);
    const atEdge = panStep(ctl);
    // A flick leaves from deeper than the band; the scroll still pins to the nearest edge.
    move(EDGE_SCROLL_MARGIN * 2, CENTRE_Y);
    win.emit('mouseout', { relatedTarget: null, clientX: EDGE_SCROLL_MARGIN * 2, clientY: CENTRE_Y });
    expect(panStep(ctl)).toBeCloseTo(atEdge);
    expect(panStep(ctl)).toBeCloseTo(atEdge);
    move(CANVAS_W / 2, CENTRE_Y);
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('disarms when the cursor leaves a window smaller than its display', () => {
    const { ctl, win, move } = install();
    move(LEFT_BAND_X, CENTRE_Y);
    win.emit('mouseout', { relatedTarget: null, clientX: -1, clientY: CENTRE_Y });
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('pins a held-button move from beyond a fullscreen window to the edge it crossed', () => {
    const { ctl, move, fillScreen } = install();
    fillScreen();
    move(-EDGE_SCROLL_MARGIN * 4, CENTRE_Y);
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('stops the out-of-window scroll on blur', () => {
    const { ctl, win, move, fillScreen } = install();
    fillScreen();
    move(CANVAS_W / 2, CENTRE_Y);
    win.emit('mouseout', { relatedTarget: null, clientX: -1, clientY: CENTRE_Y });
    expect(panStep(ctl)).toBeGreaterThan(0);
    win.emit('blur');
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('keeps the probe where it was when the cursor crosses onto HUD chrome', () => {
    const { ctl, win, move } = install();
    move(CANVAS_W / 2, CENTRE_Y);
    win.emit('mouseout', { relatedTarget: { hudBeam: true }, clientX: CANVAS_W / 2, clientY: CENTRE_Y });
    expect(panStep(ctl)).toBe(0);
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

  it('scrolls on the numpad beside the bindings, its corners diagonally', () => {
    const { ctl, press, release } = install();
    const step = (): { x: number; y: number } => {
      const before = ctl.camera();
      ctl.update(16);
      return { x: ctl.camera().offsetX - before.offsetX, y: ctl.camera().offsetY - before.offsetY };
    };
    press('Numpad4');
    expect(step().x).toBeGreaterThan(0);
    release('Numpad4');
    press('Numpad3');
    const corner = step();
    expect(corner.x).toBeLessThan(0);
    expect(corner.y).toBeLessThan(0);
    release('Numpad3');
    expect(step()).toEqual({ x: 0, y: 0 });
    press('Numpad4', { ctrlKey: true });
    expect(step().x).toBe(0);
    ctl.dispose();
  });

  it('leaves a numpad key the player bound to another action to that action', () => {
    const { ctl, press } = install({ ...DEFAULT_KEY_BINDINGS, selectHeroes: 'Numpad4' });
    press('Numpad4');
    expect(panStep(ctl)).toBe(0);
    ctl.dispose();
  });

  it('leaves an arrow a focused control already took', () => {
    const { ctl, press } = install();
    press('ArrowLeft', { defaultPrevented: true });
    expect(panStep(ctl)).toBe(0);
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

describe('createCameraController gestures a modal hands on', () => {
  it('pans, drags and zooms where the HUD guard claims the point, and takes only pan keys', () => {
    const { ctl, win, release } = install();
    ctl.setPointerGuard(() => true);
    const key = (code: string): KeyboardEvent =>
      ({ code, target: null, preventDefault: (): void => undefined }) as unknown as KeyboardEvent;
    expect(ctl.gestures.key(key('KeyQ'))).toBe(false);
    expect(ctl.gestures.key(key('ArrowLeft'))).toBe(true);
    expect(panStep(ctl)).toBeGreaterThan(0);
    release('ArrowLeft');

    const before = ctl.camera();
    ctl.gestures.press({
      button: 1,
      clientX: 400,
      clientY: 400,
      preventDefault: () => undefined,
    } as MouseEvent);
    win.emit('mousemove', { clientX: 440, clientY: 410, target: null });
    win.emit('mouseup', { button: 1 });
    expect(ctl.camera()).toEqual({ offsetX: before.offsetX + 40, offsetY: before.offsetY + 10 });

    ctl.gestures.wheel({
      clientX: 400,
      clientY: 300,
      deltaY: -1,
      preventDefault: () => undefined,
    } as WheelEvent);
    for (let i = 0; i < GLIDE_FRAMES; i++) ctl.update(FRAME_MS);
    expect(ctl.camera().scale ?? 1).toBeGreaterThan(1);
    ctl.dispose();
  });
});

describe('createCameraController input settings', () => {
  it('hides the cursor only while middle-button dragging', () => {
    const { ctl, cursorHidden, move, startMiddleDrag, win } = install();
    expect(cursorHidden()).toBe(false);

    startMiddleDrag(100, 100);
    expect(cursorHidden()).toBe(true);

    move(120, 100);
    expect(cursorHidden()).toBe(true);

    win.emit('mouseup', { button: 1 });
    expect(cursorHidden()).toBe(false);
    ctl.dispose();
  });

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

  it('holds the cursor with a pointer lock and pans by the locked movement', () => {
    const { ctl, cursorHidden, lock, locked, moveLocked, startMiddleDrag, win } = install();
    lock.grantLock = true;
    startMiddleDrag(100, 100);
    expect(locked()).toBe(true);

    // The locked cursor's client point stays put, so only the movement can pan. The first locked move is
    // dropped: Chromium can report a jump there.
    moveLocked(500, 400, 100, 100);
    moveLocked(30, -10, 100, 100);
    moveLocked(30, 0, 100, 100);
    expect(ctl.camera()).toEqual({ offsetX: 60, offsetY: -10 });

    win.emit('mouseup', { button: 1 });
    expect(locked()).toBe(false);
    expect(cursorHidden()).toBe(false);
    ctl.dispose();
  });

  it('never asks Firefox for the lock, so its pointer notice stays away, and pans by client deltas', () => {
    const { ctl, cursorGrabs, lock, locked, move, startMiddleDrag, win } = install(
      DEFAULT_KEY_BINDINGS,
      DEFAULT_INPUT_SETTINGS,
      FIREFOX_USER_AGENT,
    );
    lock.grantLock = true;
    startMiddleDrag(100, 100);
    expect(locked()).toBe(false);
    expect(cursorGrabs()).toBe(true);

    move(130, 90);
    expect(ctl.camera()).toEqual({ offsetX: 30, offsetY: -10 });

    win.emit('mouseup', { button: 1 });
    expect(cursorGrabs()).toBe(false);
    ctl.dispose();
  });

  it('drops a reported cursor warp and its return from a locked drag, and logs it', () => {
    const { ctl, lock, moveLocked, startMiddleDrag, win } = install();
    lock.grantLock = true;
    startMiddleDrag(100, 100);
    moveLocked(0, 0, 100, 100);
    moveLocked(30, 0, 100, 100);
    const warpPx = JUMP_FLOOR_PX * 2;
    // A browser that warps its hidden cursor back toward the window centre, and reports both legs.
    moveLocked(0, warpPx, 100, 100);
    moveLocked(0, -warpPx, 100, 100);
    moveLocked(30, 0, 100, 100);
    expect(ctl.camera()).toEqual({ offsetX: 60, offsetY: 0 });
    const logged = diag.entries().filter((entry) => entry.channel === 'camera' && entry.level === 'warn');
    expect(logged.at(-1)?.message).toContain('reversal');

    // A fast throw is not a warp: its second step confirms the first and both land.
    moveLocked(warpPx, 0, 100, 100);
    expect(ctl.camera().offsetX).toBe(60);
    moveLocked(warpPx, 0, 100, 100);
    expect(ctl.camera().offsetX).toBe(60 + warpPx * 2);
    win.emit('mouseup', { button: 1 });
    ctl.dispose();
  });

  it('ends the drag when the browser drops the lock, as Escape does', () => {
    const { ctl, cursorHidden, lock, loseLock, moveLocked, startMiddleDrag } = install();
    lock.grantLock = true;
    startMiddleDrag(100, 100);
    loseLock();
    expect(cursorHidden()).toBe(false);
    moveLocked(30, 0);
    expect(ctl.camera()).toEqual({ offsetX: 0, offsetY: 0 });
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
    const { ctl, cursorHidden, move, press, startMiddleDrag } = install();
    startMiddleDrag(400, 300);
    press('ArrowLeft');
    expect(cursorHidden()).toBe(true);
    ctl.setSuspended(true);
    const before = ctl.camera();
    expect(cursorHidden()).toBe(false);

    move(500, 300);
    ctl.update(16);
    expect(ctl.camera()).toEqual(before);

    ctl.setSuspended(false);
    ctl.update(16);
    expect(ctl.camera()).toEqual(before);
    ctl.dispose();
  });
});

describe('createCameraController map bounds', () => {
  /** A map a screen's worth larger than the 800x600 view on each axis, even at the widest zoom. */
  const BOUNDS = { minX: -100, minY: -100, width: 4000, height: 3000 };
  const LEFT_LIMIT = BOUNDS.minX - MAP_EDGE_MARGIN;
  const RIGHT_LIMIT = BOUNDS.minX + BOUNDS.width + MAP_EDGE_MARGIN;
  const TOP_LIMIT = BOUNDS.minY - MAP_TOP_MARGIN;
  const BOTTOM_LIMIT = BOUNDS.minY + BOUNDS.height + MAP_EDGE_MARGIN;
  /** The world box the camera shows. */
  const viewOf = (cam: Camera): { left: number; top: number; right: number; bottom: number } => {
    const scale = cam.scale ?? 1;
    const left = -cam.offsetX / scale;
    const top = -cam.offsetY / scale;
    return { left, top, right: left + CANVAS_W / scale, bottom: top + CANVAS_H / scale };
  };
  /** Deriving the box back out of a stored offset rounds at a non-unit scale. */
  const VIEW_EPSILON_PX = 1e-6;
  const insideLimits = (cam: Camera): boolean => {
    const { left, top, right, bottom } = viewOf(cam);
    return (
      left >= LEFT_LIMIT - VIEW_EPSILON_PX &&
      top >= TOP_LIMIT - VIEW_EPSILON_PX &&
      right <= RIGHT_LIMIT + VIEW_EPSILON_PX &&
      bottom <= BOTTOM_LIMIT + VIEW_EPSILON_PX
    );
  };

  it('clamps a jump that lands outside the map', () => {
    const { ctl } = install();
    ctl.setMapBounds(BOUNDS);
    ctl.jumpTo({ offsetX: -50000, offsetY: -40000 });
    expect(viewOf(ctl.camera())).toMatchObject({ right: RIGHT_LIMIT, bottom: BOTTOM_LIMIT });
    ctl.dispose();
  });

  it('clamps a camera already outside when the bounds arrive', () => {
    const { ctl } = install();
    ctl.jumpTo({ offsetX: -50000, offsetY: -40000 });
    ctl.setMapBounds(BOUNDS);
    expect(insideLimits(ctl.camera())).toBe(true);
    ctl.dispose();
  });

  it('stops edge scrolling at the map edge instead of panning past it', () => {
    const { ctl, move } = install();
    ctl.setMapBounds(BOUNDS);
    move(LEFT_BAND_X, CENTRE_Y);
    for (let i = 0; i < 120; i++) ctl.update(16);
    const pinned = ctl.camera();
    expect(viewOf(pinned).left).toBe(LEFT_LIMIT);
    for (let i = 0; i < 10; i++) ctl.update(16);
    expect(ctl.camera()).toEqual(pinned);
    ctl.dispose();
  });

  it('stops a middle drag at the map edge', () => {
    const { ctl, move, startMiddleDrag, win } = install();
    ctl.setMapBounds(BOUNDS);
    startMiddleDrag(400, 300);
    // Steps under the drag jump filter's floor, like a hand drag; the total overshoots the map.
    for (let i = 1; i <= 12; i++) move(400 + i * 200, 300);
    win.emit('mouseup', { button: 1 });
    expect(viewOf(ctl.camera()).left).toBe(LEFT_LIMIT);
    ctl.dispose();
  });

  it('keeps the view inside a wheel zoom-out about a screen corner', () => {
    const { ctl, canvasEvents } = install();
    ctl.setMapBounds(BOUNDS);
    for (let i = 0; i < WHEEL_OUT_NOTCHES; i++) {
      canvasEvents.emit('wheel', {
        clientX: 0,
        clientY: 0,
        deltaY: 1,
        preventDefault: (): void => undefined,
      });
    }
    for (let i = 0; i < GLIDE_FRAMES; i++) ctl.update(FRAME_MS);
    expect(insideLimits(ctl.camera())).toBe(true);
    ctl.dispose();
  });

  it('pans freely again once the bounds are removed', () => {
    const { ctl, move } = install();
    ctl.setMapBounds(BOUNDS);
    move(LEFT_BAND_X, CENTRE_Y);
    for (let i = 0; i < 120; i++) ctl.update(16);
    ctl.setMapBounds(null);
    expect(panStep(ctl)).toBeGreaterThan(0);
    ctl.dispose();
  });
});

describe('createCameraController zoom-out unlock', () => {
  it('lets the wheel pass MIN_ZOOM only while unlocked, down to DEBUG_MIN_ZOOM', () => {
    const { ctl, canvasEvents } = install();
    expect(wheelOutFully(ctl, canvasEvents)).toBe(MIN_ZOOM);
    ctl.setZoomOutUnlocked(true);
    expect(wheelOutFully(ctl, canvasEvents)).toBe(DEBUG_MIN_ZOOM);
    ctl.dispose();
  });

  it('relocking snaps a wider view back to MIN_ZOOM, keeping the screen centre on the same world point', () => {
    const { ctl, canvasEvents } = install();
    ctl.setZoomOutUnlocked(true);
    wheelOutFully(ctl, canvasEvents);
    const worldAtCentre = (): { x: number; y: number } => {
      const cam = ctl.camera();
      const scale = cam.scale ?? 1;
      return { x: (CANVAS_W / 2 - cam.offsetX) / scale, y: (CANVAS_H / 2 - cam.offsetY) / scale };
    };
    const before = worldAtCentre();
    ctl.setZoomOutUnlocked(false);
    expect(ctl.camera().scale).toBe(MIN_ZOOM);
    expect(worldAtCentre().x).toBeCloseTo(before.x);
    expect(worldAtCentre().y).toBeCloseTo(before.y);
    // The pending glide target was clamped too, so the next frames stay at the floor.
    expect(wheelOutFully(ctl, canvasEvents)).toBe(MIN_ZOOM);
    ctl.dispose();
  });
});

describe('createCameraController integer scaling', () => {
  const INTEGER_SCALING: CameraInputSettings = { ...DEFAULT_INPUT_SETTINGS, integerScaling: true };
  const wheelIn = (
    canvasEvents: ReturnType<typeof install>['canvasEvents'],
    timeStamp: number,
    clientX = 100,
  ): void => {
    canvasEvents.emit('wheel', {
      clientX,
      clientY: 100,
      deltaY: -1,
      timeStamp,
      preventDefault: () => undefined,
    });
  };

  it('jumps one level per wheel step about the cursor, and a burst inside the cooldown is one step', () => {
    const { ctl, canvasEvents } = install(DEFAULT_KEY_BINDINGS, INTEGER_SCALING);
    wheelIn(canvasEvents, 1000);
    expect(ctl.camera()).toEqual({ offsetX: -100, offsetY: -100, scale: 2 });
    wheelIn(canvasEvents, 1010);
    expect(ctl.camera().scale).toBe(2);
    wheelIn(canvasEvents, 2000);
    ctl.update(FRAME_MS);
    expect(ctl.camera().scale).toBe(3);
    ctl.dispose();
  });

  it('snaps a fractional zoom when the option turns on, and a jump lands on a level', () => {
    const { ctl, canvasEvents } = install();
    wheelIn(canvasEvents, 1000);
    for (let i = 0; i < GLIDE_FRAMES; i++) ctl.update(FRAME_MS);
    expect(ctl.camera().scale).toBeCloseTo(1.1);
    ctl.setInputSettings(INTEGER_SCALING);
    expect(ctl.camera().scale).toBe(1);
    ctl.jumpTo({ offsetX: 0, offsetY: 0, scale: 1.7 });
    ctl.update(FRAME_MS);
    expect(ctl.camera().scale).toBe(2);
    ctl.dispose();
  });

  it('moves to a level of the new resolution when the display changes', () => {
    let resolution = 1;
    const { ctl } = install(DEFAULT_KEY_BINDINGS, INTEGER_SCALING, CHROME_USER_AGENT, () => resolution);
    resolution = 1.25;
    ctl.update(FRAME_MS);
    expect(ctl.camera().scale).toBeCloseTo(0.8);
    ctl.dispose();
  });
});
