import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_RUN_WINDOW_STATE,
  parseWindowState,
  placeWindow,
  readWindowState,
  WINDOW_STATE_VERSION,
  type WindowState,
  writeWindowState,
} from '../src/window-state.js';

const PRIMARY = { x: 0, y: 25, width: 3840, height: 2110 };
const SIDE = { x: 3840, y: 0, width: 3440, height: 1415 };

describe('parseWindowState', () => {
  it('opens a fresh profile fullscreen', () => {
    expect(parseWindowState(undefined)).toBe(FIRST_RUN_WINDOW_STATE);
    expect(FIRST_RUN_WINDOW_STATE.fullscreen).toBe(true);
  });

  it('starts over from another version or a damaged shape', () => {
    const windowed = { version: WINDOW_STATE_VERSION, fullscreen: false, maximized: false, bounds: null };
    expect(parseWindowState({ ...windowed, version: WINDOW_STATE_VERSION + 1 })).toBe(FIRST_RUN_WINDOW_STATE);
    expect(parseWindowState({ ...windowed, bounds: { x: 0, y: 0, width: -5, height: 10 } })).toBe(
      FIRST_RUN_WINDOW_STATE,
    );
    expect(parseWindowState(windowed)).toEqual(windowed);
  });
});

describe('readWindowState and writeWindowState', () => {
  it('reopens the window as it closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'window-state-'));
    try {
      const path = join(dir, 'window-state.json');
      expect(readWindowState(path)).toBe(FIRST_RUN_WINDOW_STATE);
      const closed: WindowState = {
        version: WINDOW_STATE_VERSION,
        fullscreen: false,
        maximized: true,
        bounds: { x: 4000, y: 100, width: 1600, height: 900 },
      };
      writeWindowState(path, closed);
      expect(readWindowState(path)).toEqual(closed);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('placeWindow', () => {
  it('centres a first window on the primary work area', () => {
    expect(placeWindow(null, [PRIMARY, SIDE], PRIMARY)).toEqual({
      x: 384,
      y: 236,
      width: 3072,
      height: 1688,
    });
  });

  it('keeps remembered bounds on the display that still shows them', () => {
    const onSide = { x: 4000, y: 100, width: 1600, height: 900 };
    expect(placeWindow(onSide, [PRIMARY, SIDE], PRIMARY)).toEqual(onSide);
  });

  it('reopens a window straddling two displays on the one holding most of it', () => {
    const straddling = { x: 3600, y: 100, width: 1600, height: 900 };
    expect(placeWindow(straddling, [PRIMARY, SIDE], PRIMARY)).toEqual({ ...straddling, x: SIDE.x });
  });

  it('falls back to the primary display once the remembered one is gone', () => {
    const onSide = { x: 4000, y: 100, width: 1600, height: 900 };
    expect(placeWindow(onSide, [PRIMARY], PRIMARY)).toEqual(placeWindow(null, [PRIMARY], PRIMARY));
  });

  it('pulls remembered bounds that overhang their display inside it', () => {
    const huge = { x: 3900, y: 0, width: 5000, height: 3000 };
    expect(placeWindow(huge, [PRIMARY, SIDE], PRIMARY)).toEqual({ x: 3840, y: 0, width: 3440, height: 1415 });
  });
});
