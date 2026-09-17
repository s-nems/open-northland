import { describe, expect, it } from 'vitest';
import { panelBottomInset, panelRect, panelSpanFromRight } from '../src/hud/details-panel/layout/shared.js';
import { minimapPanelWidth } from '../src/hud/minimap/model.js';
import { NAV_BEAM_H, NAV_BEAM_W, navBeamRect } from '../src/hud/nav-beam.js';
import {
  bottomReserveFor,
  centralRegion,
  centralWindowFloor,
  centralWindowOrigin,
  liftedTop,
  NOTICE_COLUMN,
  WINDOW_REGION_TOP,
} from '../src/hud/regions.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { MIN_UI_SCALE } from '../src/hud/ui-scale.js';

/** The reference viewport at 100%: 1280 × 720 design px. */
const SCREEN = { width: 1280, height: 720 };

describe('navigation beam', () => {
  it('is the seven-action beam of the foundation, centred on the bottom edge', () => {
    expect(NAV_BEAM_W).toBe(392);
    expect(NAV_BEAM_H).toBe(68);
    expect(navBeamRect(SCREEN, 1)).toEqual({ x: 444, y: 652, w: 392, h: 68 });
    expect(navBeamRect(SCREEN, 2)).toEqual({ x: 248, y: 584, w: 784, h: 136 });
  });
});

describe('central window region', () => {
  it('runs from the wider of the notice column and the minimap to the selection panel, top bar to beam', () => {
    const region = centralRegion(SCREEN, 1);
    expect(region.x).toBe(minimapPanelWidth(1) + 8); // the minimap (223.5) outreaches the column (208)
    expect(region.y).toBe(WINDOW_REGION_TOP);
    expect(region.x + region.w).toBe(SCREEN.width - panelSpanFromRight(1) - 8);
    expect(region.y + region.h).toBe(navBeamRect(SCREEN, 1).y - 8);
    expect(NOTICE_COLUMN.left + NOTICE_COLUMN.width).toBeLessThan(minimapPanelWidth(1));
  });

  it('centres a window in the region, or on the screen when the window is wider than the region', () => {
    const region = centralRegion(SCREEN, 1);
    const fits = centralWindowOrigin(SCREEN, 1, 400);
    expect(fits).toEqual({ x: Math.round(region.x + (region.w - 400) / 2), y: WINDOW_REGION_TOP });
    const narrow = { width: 900, height: 600 };
    const wide = centralWindowOrigin(narrow, 1, 500);
    expect(centralRegion(narrow, 1).w).toBeLessThan(500);
    expect(wide).toEqual({ x: 200, y: WINDOW_REGION_TOP });
  });

  it('floors a window at the beam and lifts one that would cross it, never above the top bar', () => {
    const floor = centralWindowFloor(SCREEN, 1);
    expect(floor).toBe(navBeamRect(SCREEN, 1).y - 8);
    expect(liftedTop(WINDOW_REGION_TOP, 200, floor, 0)).toBe(WINDOW_REGION_TOP);
    expect(liftedTop(WINDOW_REGION_TOP, 600, floor, 0)).toBe(floor - 600);
    expect(liftedTop(WINDOW_REGION_TOP, 5000, floor, 40)).toBe(40);
  });

  it('names the reserve a window must keep clear of: the beam, the minimap, or the taller of both', () => {
    const beam = navBeamRect(SCREEN, 1);
    const minimap = { x: 0, y: 520, w: minimapPanelWidth(1), h: 200 };
    expect(bottomReserveFor(SCREEN, 1, { x: 500, w: 300 }, minimap)).toEqual(beam);
    expect(bottomReserveFor(SCREEN, 1, { x: 10, w: 100 }, minimap)).toEqual(minimap);
    expect(bottomReserveFor(SCREEN, 1, { x: 10, w: 900 }, minimap)).toEqual(minimap);
    expect(bottomReserveFor(SCREEN, 1, { x: 10, w: 100 }, null)).toBeNull();
    expect(bottomReserveFor(SCREEN, 1, { x: 1000, w: 100 }, minimap)).toBeNull();
  });
});

describe('selection panel and the beam', () => {
  it('stands on the beam only where the beam reaches under its column', () => {
    expect(panelBottomInset(SCREEN, 1)).toBe(0);
    // Narrower than the 1048 px where the beam's right edge reaches the panel's column.
    const narrow = { width: 960, height: 540 };
    expect(panelBottomInset(narrow, 1)).toBe(NAV_BEAM_H);
    expect(panelRect(100, narrow, 1).y).toBe(540 - NAV_BEAM_H - 100 - 6);
    expect(panelRect(100, SCREEN, 1).y).toBe(720 - 100 - 6);
  });
});

describe('tool panel layout', () => {
  it('keeps a fractional uiscale and floors a too-small one at the legibility minimum', () => {
    expect(buildToolPanelLayout(1.2).scale).toBe(1.2);
    expect(buildToolPanelLayout(0).scale).toBe(MIN_UI_SCALE);
    expect(buildToolPanelLayout(-3).scale).toBe(MIN_UI_SCALE);
  });

  it('resolves the region against the live screen at its own scale', () => {
    const layout = buildToolPanelLayout(2);
    expect(layout.windowOrigin(SCREEN, 300)).toEqual(centralWindowOrigin(SCREEN, 2, 300));
    expect(layout.windowFloor(SCREEN)).toBe(centralWindowFloor(SCREEN, 2));
    expect(layout.sheetArea(SCREEN)).toEqual({ width: SCREEN.width, height: centralWindowFloor(SCREEN, 2) });
  });
});
