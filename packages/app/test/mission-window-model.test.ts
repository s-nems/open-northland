import { describe, expect, it } from 'vitest';
import {
  clampScroll,
  hitTestMissionWindow,
  layoutMissionWindow,
  linkedRunAt,
  missionWindowScale,
  type SheetFrame,
} from '../src/hud/tool-panel/mission/index.js';
import { MISSION_WINDOW_H, MISSION_WINDOW_W } from '../src/hud/tool-panel/mission/model.js';
import { MAX_UI_SCALE_BASE, uiScaleFor } from '../src/hud/ui-scale.js';

/** The mission window's geometry: a 500×420 window centred on the screen at the height-derived scale,
 *  its tabs in one row, the viewport over the Up/Down buttons, and the click routing over them. */

describe('missionWindowScale', () => {
  it('follows the height-derived HUD base, capped like the HUD, and never the player factor', () => {
    expect(missionWindowScale({ width: 1024, height: 768 })).toBe(1);
    expect(missionWindowScale({ width: 1920, height: 1080 })).toBe(uiScaleFor(1080));
    expect(missionWindowScale({ width: 3840, height: 2160 })).toBe(MAX_UI_SCALE_BASE);
  });

  it('shrinks below the base only when the window would not fit the screen', () => {
    const scale = missionWindowScale({ width: 400, height: 768 });
    expect(scale).toBeLessThan(1);
    expect(MISSION_WINDOW_W * scale).toBeLessThanOrEqual(400);
  });
});

describe('layoutMissionWindow', () => {
  const layout = layoutMissionWindow({ width: 1024, height: 768 }, null);

  it('centres the native-size window on the whole screen', () => {
    expect(layout.window).toEqual({
      x: (1024 - MISSION_WINDOW_W) / 2,
      y: (768 - MISSION_WINDOW_H) / 2,
      w: MISSION_WINDOW_W,
      h: MISSION_WINDOW_H,
    });
  });

  it('pins the element rects to the original window coordinates', () => {
    const { x, y } = layout.window;
    expect(layout.titleRect).toEqual({ x: x + 2, y: y + 2, w: 478, h: 14 });
    expect(layout.closeRect).toEqual({ x: x + 482, y: y + 2, w: 16, h: 14 });
    expect(layout.tabs.map((t) => t.tab)).toEqual(['task', 'goals', 'history']);
    expect(layout.tabs.map((t) => t.rect)).toEqual([
      { x: x + 4, y: y + 22, w: 164, h: 22 },
      { x: x + 170, y: y + 22, w: 164, h: 22 },
      { x: x + 336, y: y + 22, w: 164, h: 22 },
    ]);
    expect(layout.viewport).toEqual({ x: x + 9, y: y + 57, w: 482, h: 292 });
    expect(layout.wrapWidth).toBe(482);
    expect(layout.pageViewport).toEqual({ x: x + 4, y: y + 52, w: 492, h: 302 });
    expect(layout.pageWrapWidth).toBe(492);
    expect(layout.scrollUp).toEqual({ x: x + 212, y: y + 358, w: 42, h: 58 });
    expect(layout.scrollDown).toEqual({ x: x + 246, y: y + 358, w: 42, h: 58 });
  });

  it('claims the whole papyrus around the window when the sheet art is present', () => {
    const frame: SheetFrame = { width: 610, height: 549, offsetX: -48, offsetY: -69 };
    const withArt = layoutMissionWindow({ width: 1024, height: 768 }, frame);
    const { x, y } = withArt.window;
    expect(withArt.sheet).toEqual({ x: x - 48, y: y - 69, w: 610, h: 549 });
    expect(hitTestMissionWindow(withArt, x - 10, y + 100)).toEqual({ kind: 'window' });
    expect(hitTestMissionWindow(withArt, x - 49, y + 100)).toBeNull();
    // Without art the flat panel is the window rect, and so is the claim.
    expect(layout.sheet).toEqual(layout.window);
  });

  it('scales every rect with the window', () => {
    const big = layoutMissionWindow({ width: 2560, height: 1440 }, null);
    expect(big.scale).toBe(MAX_UI_SCALE_BASE);
    expect(big.window.w).toBe(Math.round(MISSION_WINDOW_W * MAX_UI_SCALE_BASE));
    expect(big.tabs[1]?.rect.w).toBe(Math.round(164 * MAX_UI_SCALE_BASE));
    expect(big.wrapWidth).toBe(482);
  });
});

describe('hitTestMissionWindow', () => {
  const layout = layoutMissionWindow({ width: 1024, height: 768 }, null);

  it('routes the closer, the tabs, the scroll buttons, the viewport and the window', () => {
    const { closeRect, viewport, scrollUp, scrollDown, window } = layout;
    expect(hitTestMissionWindow(layout, closeRect.x + 1, closeRect.y + 1)).toEqual({ kind: 'close' });
    const goals = layout.tabs[1]?.rect;
    expect(goals).toBeDefined();
    if (goals !== undefined) {
      expect(hitTestMissionWindow(layout, goals.x + 1, goals.y + 1)).toEqual({ kind: 'tab', tab: 'goals' });
    }
    expect(hitTestMissionWindow(layout, scrollUp.x + 1, scrollUp.y + 1)).toEqual({
      kind: 'scroll',
      direction: -1,
    });
    expect(hitTestMissionWindow(layout, scrollDown.x + 1, scrollDown.y + 1)).toEqual({
      kind: 'scroll',
      direction: 1,
    });
    expect(hitTestMissionWindow(layout, viewport.x + 3, viewport.y + 40)).toEqual({
      kind: 'text',
      x: 3,
      y: 40,
    });
    expect(hitTestMissionWindow(layout, window.x + 1, window.y + window.h - 1)).toEqual({ kind: 'window' });
    expect(hitTestMissionWindow(layout, window.x - 1, window.y)).toBeNull();
  });
});

describe('scroll model', () => {
  it('clamps the offset to the overflow and to zero when the content fits', () => {
    expect(clampScroll(50, 100, 300)).toBe(0);
    expect(clampScroll(-5, 500, 300)).toBe(0);
    expect(clampScroll(150, 500, 300)).toBe(150);
    expect(clampScroll(999, 500, 300)).toBe(200);
  });

  it('finds the link of the run under a content point, centred runs by their placed span', () => {
    const placed = [
      { x: 0, width: 400, placement: 'left' as const, y: 0, h: 20, link: null },
      { x: 0, width: 100, placement: 'center' as const, y: 26, h: 14, link: 'mythology_00' },
      { x: 5, width: 60, placement: 'left' as const, y: 46, h: 14, link: 'mythology_01' },
      { x: 0, width: 80, placement: 'right' as const, y: 66, h: 14, link: 'mythology_02' },
    ];
    const viewportW = 480;
    const linkAt = (x: number, y: number): string | null =>
      linkedRunAt(placed, viewportW, x, y)?.link ?? null;
    expect(linkAt(10, 10)).toBeNull(); // a run without a link
    expect(linkAt(240, 22)).toBeNull();
    expect(linkAt(240, 30)).toBe('mythology_00');
    expect(linkAt(10, 30)).toBeNull(); // left of the centred glyphs
    expect(linkAt(20, 59)).toBe('mythology_01');
    expect(linkAt(70, 59)).toBeNull(); // right of the left-aligned run
    expect(linkAt(20, 60)).toBeNull();
    expect(linkAt(410, 70)).toBe('mythology_02');
    expect(linkAt(390, 70)).toBeNull(); // left of the right-aligned run
  });
});
