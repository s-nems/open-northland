import { describe, expect, it } from 'vitest';
import { panelDrawGeometry } from '../src/hud/details-panel/bake.js';
import type { Rect } from '../src/hud/geometry.js';

/** A panel anchored bottom-right, as `layoutBuilding` places it - the origin is never (0, 0). */
const PANEL: Rect = { x: 731, y: 402, w: 293, h: 366 };
/** `panel.ts` bakes at the display scale when it is an integer, else at `PANEL_MAX_SUPERSAMPLE`. */
const BAKE: readonly { readonly scale: number; readonly ss: number }[] = [
  { scale: 1, ss: 1 },
  { scale: 2, ss: 2 },
  { scale: 4, ss: 4 },
  { scale: 1.4, ss: 4 },
  { scale: 5, ss: 4 },
];

describe('details-panel draw geometry', () => {
  it('puts the panel at the texture origin, covered exactly', () => {
    for (const { scale, ss } of BAKE) {
      const { toDraw, texW, texH } = panelDrawGeometry(PANEL, scale, ss);
      const drawn = toDraw(PANEL);
      const at = `×${scale}/ss${ss}`;
      expect(drawn.x, at).toBe(0);
      expect(drawn.y, at).toBe(0);
      expect(texW, at).toBe(Math.round(drawn.w));
      expect(texH, at).toBe(Math.round(drawn.h));
      // The texture is displayed back down by `scale / ss` (`bakePanel`), which must land on the panel's
      // on-screen size, give or take the half texture pixel `texW`/`texH` round away. Only this ties the
      // two uses of the ratio together: every assertion above holds just as well with `k` inverted.
      const halfTexel = 0.5 * (scale / ss);
      expect(Math.abs(texW * (scale / ss) - PANEL.w), at).toBeLessThanOrEqual(halfTexel);
      expect(Math.abs(texH * (scale / ss) - PANEL.h), at).toBeLessThanOrEqual(halfTexel);
    }
  });

  it('keeps a child rect at the same fraction of the panel it started at', () => {
    // The property the hit layout and the draw layout must share: a button one third down the panel is
    // drawn one third down the texture. Drift here is what desynchronizes clicking from drawing.
    const button: Rect = { x: PANEL.x + 40, y: PANEL.y + PANEL.h / 3, w: 96, h: 18 };
    for (const { scale, ss } of BAKE) {
      const { toDraw } = panelDrawGeometry(PANEL, scale, ss);
      const drawn = toDraw(button);
      const panelDrawn = toDraw(PANEL);
      const at = `×${scale}/ss${ss}`;
      expect(drawn.x / panelDrawn.w, at).toBeCloseTo((button.x - PANEL.x) / PANEL.w, 12);
      expect(drawn.y / panelDrawn.h, at).toBeCloseTo((button.y - PANEL.y) / PANEL.h, 12);
      expect(drawn.w / panelDrawn.w, at).toBeCloseTo(button.w / PANEL.w, 12);
    }
  });

  it('leaves the geometry untouched when the display scale needs no oversample', () => {
    const { toDraw, texW, texH } = panelDrawGeometry(PANEL, 2, 2);
    expect(toDraw({ x: PANEL.x + 7, y: PANEL.y + 9, w: 11, h: 13 })).toEqual({ x: 7, y: 9, w: 11, h: 13 });
    expect([texW, texH]).toEqual([PANEL.w, PANEL.h]);
  });

  it('never returns a degenerate texture for a panel that rounds to nothing', () => {
    const { texW, texH } = panelDrawGeometry({ x: 0, y: 0, w: 0.2, h: 0.2 }, 8, 4);
    expect([texW, texH]).toEqual([1, 1]);
  });
});
