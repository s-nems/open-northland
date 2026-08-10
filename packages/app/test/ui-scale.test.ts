import { describe, expect, it } from 'vitest';
import {
  clampUiScaleFactor,
  MAX_UI_SCALE_BASE,
  MIN_UI_SCALE,
  REFERENCE_VIEWPORT_HEIGHT,
  UI_SCALE_FACTOR_MAX,
  UI_SCALE_FACTOR_MIN,
  uiScaleFor,
} from '../src/hud/ui-scale.js';

describe('uiScaleFor', () => {
  it('scales linearly with viewport height from the 768-line reference', () => {
    expect(uiScaleFor(REFERENCE_VIEWPORT_HEIGHT)).toBe(1);
    expect(uiScaleFor(900)).toBeCloseTo(1.171875);
  });

  it('stops widening the chrome once a tall viewport is only buying more view', () => {
    expect(uiScaleFor(1080)).toBe(MAX_UI_SCALE_BASE);
    expect(uiScaleFor(1440)).toBe(MAX_UI_SCALE_BASE);
    expect(uiScaleFor(2160)).toBe(MAX_UI_SCALE_BASE);
  });

  it('applies the relative settings factor on the capped base, so a player can still go bigger', () => {
    expect(uiScaleFor(900, 1.2)).toBeCloseTo(1.40625);
    expect(uiScaleFor(1080, 1.5)).toBeCloseTo(1.875);
  });

  it('tracks short viewports proportionally, then floors at the legibility minimum', () => {
    expect(uiScaleFor(600)).toBeCloseTo(0.78125);
    expect(uiScaleFor(500)).toBe(MIN_UI_SCALE);
    expect(uiScaleFor(1080, 0.5)).toBe(MIN_UI_SCALE);
  });
});

describe('clampUiScaleFactor', () => {
  it('bounds a wild factor to the player-facing range', () => {
    expect(clampUiScaleFactor(9)).toBe(UI_SCALE_FACTOR_MAX);
    expect(clampUiScaleFactor(0.1)).toBe(UI_SCALE_FACTOR_MIN);
    expect(clampUiScaleFactor(1.25)).toBe(1.25);
  });
});
