import { describe, expect, it } from 'vitest';
import {
  clampScroll,
  hitTestMissionWindow,
  layoutMissionWindow,
  scrollThumb,
} from '../src/hud/tool-panel/mission/index.js';
import { MISSION_SHEET_H, MISSION_SHEET_W } from '../src/hud/tool-panel/mission/model.js';

/** The mission sheet's geometry: centred clear of the strip, shrunk uniformly to fit a small screen,
 *  with the close box and OK plate both dismissing and the scroll model clamped to the overflow. */

const STRIP_W = 50;

describe('layoutMissionWindow', () => {
  it('draws the sheet at native size centred in the space right of the strip on a big screen', () => {
    const layout = layoutMissionWindow({
      scale: 1,
      screen: { width: 1024, height: 768 },
      stripWidth: STRIP_W,
    });
    expect(layout.window.w).toBe(MISSION_SHEET_W);
    expect(layout.window.h).toBe(MISSION_SHEET_H);
    expect(layout.sheetScale).toBe(1);
    expect(layout.window.x).toBeGreaterThan(STRIP_W);
    expect(layout.window.x + layout.window.w / 2).toBeCloseTo(STRIP_W + (1024 - STRIP_W) / 2, 0);
    expect(layout.viewport.y).toBeGreaterThan(layout.window.y);
    expect(layout.okRect.y + layout.okRect.h).toBeLessThan(layout.window.y + layout.window.h);
    expect(layout.viewport.y + layout.viewport.h).toBeLessThan(layout.okRect.y);
  });

  it('shrinks the sheet uniformly when the screen is smaller than the art', () => {
    const layout = layoutMissionWindow({
      scale: 1,
      screen: { width: 640, height: 480 },
      stripWidth: STRIP_W,
    });
    expect(layout.sheetScale).toBeLessThan(1);
    expect(layout.window.w / layout.window.h).toBeCloseTo(MISSION_SHEET_W / MISSION_SHEET_H, 1);
    expect(layout.window.x).toBeGreaterThanOrEqual(STRIP_W);
    expect(layout.window.y + layout.window.h).toBeLessThanOrEqual(480);
  });

  it('never scales the sheet past the UI scale', () => {
    const layout = layoutMissionWindow({ scale: 1.5, screen: { width: 2560, height: 1440 }, stripWidth: 75 });
    expect(layout.sheetScale).toBe(1.5);
    expect(layout.wrapWidth).toBe(Math.floor(layout.viewport.w / 1.5));
  });
});

describe('hitTestMissionWindow', () => {
  const layout = layoutMissionWindow({ scale: 1, screen: { width: 1024, height: 768 }, stripWidth: STRIP_W });

  it('dismisses on the close box and the OK plate, consumes the sheet, ignores the outside', () => {
    const { closeRect, okRect, window } = layout;
    expect(hitTestMissionWindow(layout, closeRect.x + 1, closeRect.y + 1)).toEqual({ kind: 'close' });
    expect(hitTestMissionWindow(layout, okRect.x + 1, okRect.y + 1)).toEqual({ kind: 'close' });
    expect(hitTestMissionWindow(layout, window.x + 5, window.y + 5)).toEqual({ kind: 'window' });
    expect(hitTestMissionWindow(layout, window.x - 1, window.y)).toBeNull();
  });
});

describe('scroll model', () => {
  it('clamps the offset to the overflow and hides the thumb when the content fits', () => {
    expect(clampScroll(-5, 300, 100)).toBe(0);
    expect(clampScroll(250, 300, 100)).toBe(200);
    expect(clampScroll(50, 80, 100)).toBe(0);
    const track = { x: 0, y: 0, w: 8, h: 100 };
    expect(scrollThumb(track, 0, 80, 100, 1)).toBeNull();
    const top = scrollThumb(track, 0, 200, 100, 1);
    const bottom = scrollThumb(track, 100, 200, 100, 1);
    expect(top).toEqual({ x: 0, y: 0, w: 8, h: 50 });
    expect(bottom).toEqual({ x: 0, y: 50, w: 8, h: 50 });
  });
});
