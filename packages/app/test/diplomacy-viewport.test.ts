import { describe, expect, it } from 'vitest';
import { layoutDiplomacyWindow } from '../src/hud/tool-panel/diplomacy/model.js';
import { fitDiplomacyWindow } from '../src/hud/tool-panel/diplomacy/viewport.js';

const raw = () =>
  layoutDiplomacyWindow({
    originX: 83,
    originY: 226,
    scale: 1.5,
    players: [1],
    selected: 1,
    tributes: Array.from({ length: 12 }, (_, slot) => ({ slot, payable: true, descriptionH: 24, lines: 2 })),
  });

describe('diplomacy viewport', () => {
  it('keeps its chrome on screen and places beside the minimap when space permits', () => {
    const fitted = fitDiplomacyWindow(
      raw(),
      { width: 800, height: 600 },
      { x: 0, y: 302, w: 316, h: 298 },
      0,
    );
    expect(fitted.window.x).toBe(316);
    expect(fitted.window.x + fitted.window.w).toBeLessThanOrEqual(800);
    expect(fitted.window.y + fitted.window.h).toBeLessThanOrEqual(600);
    expect(fitted.maxScroll).toBeGreaterThan(0);
  });

  it('keeps the header fixed while scrolling the final tribute into the clipped body', () => {
    const top = fitDiplomacyWindow(raw(), { width: 800, height: 600 }, null, 0);
    const bottom = fitDiplomacyWindow(raw(), { width: 800, height: 600 }, null, Infinity);
    expect(bottom.closeRect).toEqual(top.closeRect);
    expect(bottom.tabs).toEqual(top.tabs);
    expect(bottom.scroll).toBe(bottom.maxScroll);
    const last = bottom.tributes.at(-1);
    expect(last).toBeDefined();
    expect((last?.card.y ?? 0) + (last?.card.h ?? 0)).toBe(bottom.viewport.y + bottom.viewport.h);
  });

  it('uses the space above the minimap when the window cannot fit beside it', () => {
    const reserve = { x: 0, y: 302, w: 316, h: 298 };
    const fitted = fitDiplomacyWindow(raw(), { width: 640, height: 600 }, reserve, 0);
    expect(fitted.window.y + fitted.window.h).toBeLessThan(reserve.y);
    expect(fitted.viewport.h).toBeGreaterThan(0);
    expect(fitted.maxScroll).toBeGreaterThan(0);
  });
});

it.each([
  { width: 640, height: 480 },
  { width: 800, height: 600 },
])('scrolls a large roster with the body when the reserved area leaves no room: %o', (screen) => {
  const raw = layoutDiplomacyWindow({
    originX: 83,
    originY: 226,
    scale: 1.5,
    players: Array.from({ length: 15 }, (_, i) => i + 1),
    selected: 1,
    tributes: [{ slot: 0, payable: true, descriptionH: 24, lines: 1 }],
  });
  const reserve = { x: 0, y: screen.height - 298, w: 334, h: 298 };
  const top = fitDiplomacyWindow(raw, screen, reserve, 0);
  const bottom = fitDiplomacyWindow(raw, screen, reserve, Infinity);
  expect(top.scrollTabs).toBe(true);
  expect(top.viewport.h).toBeGreaterThan(0);
  expect(bottom.closeRect).toEqual(top.closeRect);
  for (const tab of raw.tabs) {
    const revealed = fitDiplomacyWindow(raw, screen, reserve, tab.rect.y - raw.titleRect.y - raw.titleRect.h);
    const placed = revealed.tabs.find((t) => t.player === tab.player);
    expect(placed).toBeDefined();
    expect(placed?.rect.y).toBeGreaterThanOrEqual(revealed.viewport.y);
    expect((placed?.rect.y ?? 0) + (placed?.rect.h ?? 0)).toBeLessThanOrEqual(
      revealed.viewport.y + revealed.viewport.h,
    );
  }
  const last = bottom.tributes.at(-1);
  expect((last?.pay.y ?? 0) + (last?.pay.h ?? 0)).toBeLessThanOrEqual(bottom.viewport.y + bottom.viewport.h);
});
