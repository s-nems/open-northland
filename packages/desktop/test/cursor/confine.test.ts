import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ConfinedWindow,
  type CursorHold,
  createCursorConfine,
  cursorConfineWanted,
  parseConfineMode,
  rectWithin,
} from '../../src/cursor/confine.js';

const INTERVAL_MS = 10;
const RECT = { x: 100, y: 50, width: 800, height: 600 };

function setup() {
  const state = { focused: true, fullscreen: false, buttonHeld: false };
  const win: ConfinedWindow = {
    isFocused: () => state.focused,
    isFullScreen: () => state.fullscreen,
    holdRect: () => RECT,
  };
  const hold = {
    intervalMs: INTERVAL_MS,
    hold: vi.fn(),
    release: vi.fn(),
    frameButtonHeld: () => state.buttonHeld,
  } satisfies CursorHold;
  return { state, hold, confine: createCursorConfine(win, hold) };
}

describe('createCursorConfine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves the cursor free until the page asks', () => {
    const { hold, confine } = setup();
    confine.sync();
    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(hold.hold).not.toHaveBeenCalled();
  });

  it('holds a windowed game only in the always mode', () => {
    const { hold, confine } = setup();
    confine.setMode('fullscreen');
    expect(hold.hold).not.toHaveBeenCalled();
    confine.setMode('always');
    expect(hold.hold).toHaveBeenLastCalledWith(RECT);
  });

  it('follows the window into and out of fullscreen', () => {
    const { state, hold, confine } = setup();
    confine.setMode('fullscreen');
    state.fullscreen = true;
    confine.sync();
    expect(hold.hold).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(hold.hold).toHaveBeenCalledTimes(2);
    state.fullscreen = false;
    confine.sync();
    expect(hold.release).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(hold.hold).toHaveBeenCalledTimes(2);
  });

  it('frees the cursor while another application has the focus', () => {
    const { state, hold, confine } = setup();
    confine.setMode('always');
    state.focused = false;
    confine.sync();
    expect(hold.release).toHaveBeenCalledTimes(1);
    state.focused = true;
    confine.sync();
    expect(hold.hold).toHaveBeenCalledTimes(2);
  });

  it('gives up for good when the native call fails', () => {
    const { hold, confine } = setup();
    hold.hold.mockImplementation(() => {
      throw new Error('no such function');
    });
    confine.setMode('always');
    vi.advanceTimersByTime(INTERVAL_MS * 3);
    confine.setMode('always');
    expect(hold.hold).toHaveBeenCalledTimes(1);
  });

  it('frees the cursor for a frame drag until the button lifts', () => {
    const { state, hold, confine } = setup();
    confine.setMode('always');
    state.buttonHeld = true;
    confine.frameDragStarted();
    expect(hold.release).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(hold.hold).toHaveBeenCalledTimes(1);
    state.buttonHeld = false;
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(hold.hold).toHaveBeenCalledTimes(2);
  });
});

describe('cursorConfineWanted', () => {
  it('is on in a packaged build and off in development unless the environment says otherwise', () => {
    expect(cursorConfineWanted(true, {})).toBe(true);
    expect(cursorConfineWanted(false, {})).toBe(false);
    expect(cursorConfineWanted(false, { ON_DESKTOP_CURSOR_CONFINE: '1' })).toBe(true);
    expect(cursorConfineWanted(true, { ON_DESKTOP_CURSOR_CONFINE: '0' })).toBe(false);
  });
});

describe('parseConfineMode', () => {
  it('refuses anything but a known mode', () => {
    expect(parseConfineMode('fullscreen')).toBe('fullscreen');
    expect(parseConfineMode('sometimes')).toBeNull();
    expect(parseConfineMode(true)).toBeNull();
  });
});

describe('rectWithin', () => {
  it("cuts a maximized window's off-screen frame back to its display", () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(rectWithin({ x: -8, y: -8, width: 1936, height: 1096 }, display)).toEqual(display);
  });
});
