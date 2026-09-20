import { describe, expect, it } from 'vitest';
import { panelBottomInset, panelRect } from '../src/hud/details-panel/layout/shared.js';
import { minimapDesignBox, minimapPanelWidth } from '../src/hud/minimap/model.js';
import { NAV_BEAM_H, NAV_BEAM_W, navBeamRect } from '../src/hud/nav-beam.js';
import {
  bottomReserveFor,
  centralRegion,
  centralWindowBox,
  centralWindowFloor,
  centralWindowOrigin,
  liftedTop,
  WINDOW_REGION_TOP,
} from '../src/hud/regions.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { MIN_UI_SCALE } from '../src/hud/ui-scale.js';

/** The reference viewport at 100%: 1280 × 720 design px. */
const SCREEN = { width: 1280, height: 720 };

describe('navigation beam', () => {
  it('is the seven-action beam of the foundation, centred on the bottom edge', () => {
    expect(NAV_BEAM_W).toBe(420);
    expect(NAV_BEAM_H).toBe(72);
    expect(navBeamRect(SCREEN, 1)).toEqual({ x: 430, y: 648, w: 420, h: 72 });
    expect(navBeamRect(SCREEN, 2)).toEqual({ x: 220, y: 576, w: 840, h: 144 });
  });
});

describe('central window region', () => {
  it('spans the screen width from under the top bar to the beam', () => {
    const region = centralRegion(SCREEN, 1);
    expect(region.x).toBe(0);
    expect(region.w).toBe(SCREEN.width);
    expect(region.y).toBe(WINDOW_REGION_TOP);
    expect(region.y + region.h).toBe(navBeamRect(SCREEN, 1).y - 8);
  });

  it('centres a window on the screen, on the axis the beam sits on', () => {
    expect(centralWindowOrigin(SCREEN, 1, 400)).toEqual({ x: 440, y: WINDOW_REGION_TOP });
    const beam = navBeamRect(SCREEN, 1);
    expect(centralWindowOrigin(SCREEN, 1, beam.w).x).toBe(beam.x);
    const narrow = { width: 900, height: 600 };
    expect(centralWindowOrigin(narrow, 1, 500)).toEqual({ x: 200, y: WINDOW_REGION_TOP });
    expect(centralWindowOrigin(narrow, 1, 1000).x).toBe(0);
  });

  it('floors a window at the beam and lifts one that would cross it, never above the top bar', () => {
    const floor = centralWindowFloor(SCREEN, 1);
    expect(floor).toBe(navBeamRect(SCREEN, 1).y - 8);
    expect(liftedTop(WINDOW_REGION_TOP, 200, floor, 0)).toBe(WINDOW_REGION_TOP);
    expect(liftedTop(WINDOW_REGION_TOP, 600, floor, 0)).toBe(floor - 600);
    expect(liftedTop(WINDOW_REGION_TOP, 5000, floor, 40)).toBe(40);
  });

  it('slides a central window clear of the minimap instead of covering its presses', () => {
    // The DOM plane takes every press inside a window, so a window over the corner kills the minimap.
    const box = (screen: { width: number; height: number }, width: number) =>
      centralWindowBox(screen, 1, width, minimapDesignBox(screen.height));
    const minimapRight = Math.ceil(minimapDesignBox(SCREEN.height).w);

    // Wide enough to reach the corner when centred: it starts at the minimap's right edge instead.
    expect(box(SCREEN, 900).x).toBe(minimapRight);
    // The reachable narrow planes: 1280x720 at the slider's 1.5 maximum, and 1280x1024 by default.
    expect(box({ width: 910, height: 512 }, 640).x).toBe(minimapRight);
    expect(box({ width: 1024, height: 819 }, 640).x).toBe(minimapRight);
    // A window the centre already clears stays centred.
    expect(box(SCREEN, 640)).toEqual(centralWindowBox(SCREEN, 1, 640, null));
    expect(box(SCREEN, 640).x).toBe(320);
    // One too wide for the free space keeps its right edge on screen rather than clearing the corner.
    expect(box(SCREEN, 1100).x).toBe(SCREEN.width - 1100);
    expect(box({ width: 400, height: 720 }, 640).x).toBe(0);
    // A minimap that sits wholly below the region's floor never moves a window.
    const belowFloor = { x: 0, y: centralWindowFloor(SCREEN, 1) + 1, w: 400, h: 10 };
    expect(centralWindowBox(SCREEN, 1, 1100, belowFloor).x).toBe(centralWindowOrigin(SCREEN, 1, 1100).x);
  });

  it('gives a central window the region height to grow into', () => {
    const box = centralWindowBox(SCREEN, 1, 640, null);
    expect(box.y).toBe(WINDOW_REGION_TOP);
    expect(box.y + box.maxHeight).toBe(centralWindowFloor(SCREEN, 1));
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
    // Narrower than the 1076 px where the beam's right edge reaches the panel's column.
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
