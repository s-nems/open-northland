import { describe, expect, it } from 'vitest';
import {
  clampUiScaleFactor,
  displayScaleFor,
  MIN_UI_SCALE,
  REFERENCE_DISPLAY_HEIGHT,
  SMALL_DISPLAY_UI_SCALE,
  startWorldZoomFor,
  UI_SCALE_AT_REFERENCE_DISPLAY,
  UI_SCALE_FACTOR_MAX,
  UI_SCALE_FACTOR_MIN,
  uiScaleFor,
} from '../src/hud/ui-scale.js';

const UHD_HEIGHT = 2160;
const QHD_HEIGHT = 1440;
/** A display's height minus a title bar: what a maximized window's viewport gets. */
const maximized = (displayHeight: number) => ({
  displayHeight,
  viewportWidth: Math.round((displayHeight * 16) / 9),
  viewportHeight: displayHeight - 40,
});

describe('uiScaleFor', () => {
  it('grows with the display from the 1080-line reference', () => {
    const fullHd = {
      displayHeight: REFERENCE_DISPLAY_HEIGHT,
      viewportWidth: 1920,
      viewportHeight: REFERENCE_DISPLAY_HEIGHT,
    };
    expect(uiScaleFor(fullHd)).toBe(UI_SCALE_AT_REFERENCE_DISPLAY);
    expect(uiScaleFor(maximized(QHD_HEIGHT))).toBeCloseTo(1.6667, 4);
    expect(uiScaleFor(maximized(UHD_HEIGHT))).toBe(2.5);
  });

  it('keeps its size when a window on the same display grows', () => {
    const tallWindow = { displayHeight: UHD_HEIGHT, viewportWidth: 3840, viewportHeight: 1960 };
    expect(uiScaleFor(tallWindow)).toBe(uiScaleFor(maximized(UHD_HEIGHT)));
  });

  it('shrinks to fit a window too short for the chrome at the display size', () => {
    expect(uiScaleFor({ displayHeight: UHD_HEIGHT, viewportWidth: 1440, viewportHeight: 860 })).toBeCloseTo(
      860 / 768,
    );
  });

  it('shrinks to fit a window too narrow for the chrome, as on a portrait display', () => {
    const narrow = { displayHeight: UHD_HEIGHT, viewportWidth: 1000, viewportHeight: 2100 };
    expect(uiScaleFor(narrow)).toBeCloseTo(1000 / 1024);
  });

  it('applies the relative settings factor on the base', () => {
    expect(uiScaleFor(maximized(UHD_HEIGHT), 1.2)).toBeCloseTo(3);
  });

  it('keeps the original chrome size on a small display that holds it', () => {
    const laptop = { displayHeight: 768, viewportWidth: 1366, viewportHeight: 768 };
    expect(uiScaleFor(laptop)).toBe(SMALL_DISPLAY_UI_SCALE);
    expect(startWorldZoomFor(laptop)).toBe(1);
  });

  it('floors at the legibility minimum', () => {
    expect(uiScaleFor({ displayHeight: 500, viewportWidth: 800, viewportHeight: 500 })).toBe(MIN_UI_SCALE);
    expect(
      uiScaleFor({ displayHeight: REFERENCE_DISPLAY_HEIGHT, viewportWidth: 1920, viewportHeight: 1000 }, 0.5),
    ).toBe(MIN_UI_SCALE);
  });

  it('takes a display reported shorter than its window as the window', () => {
    expect(displayScaleFor({ displayHeight: 600, viewportWidth: 3000, viewportHeight: 1200 })).toBe(
      displayScaleFor({ displayHeight: 1200, viewportWidth: 3000, viewportHeight: 1200 }),
    );
  });
});

describe('startWorldZoomFor', () => {
  it('magnifies the world as much as the HUD base above the reference display', () => {
    expect(startWorldZoomFor(maximized(UHD_HEIGHT))).toBe(2);
    expect(startWorldZoomFor(maximized(UHD_HEIGHT)) * UI_SCALE_AT_REFERENCE_DISPLAY).toBe(
      uiScaleFor(maximized(UHD_HEIGHT)),
    );
  });

  it('never opens below 1:1 on a small display', () => {
    expect(startWorldZoomFor({ displayHeight: 900, viewportWidth: 1440, viewportHeight: 860 })).toBe(1);
  });
});

describe('clampUiScaleFactor', () => {
  it('bounds a wild factor to the player-facing range', () => {
    expect(clampUiScaleFactor(9)).toBe(UI_SCALE_FACTOR_MAX);
    expect(clampUiScaleFactor(0.1)).toBe(UI_SCALE_FACTOR_MIN);
    expect(clampUiScaleFactor(1.25)).toBe(1.25);
  });
});
