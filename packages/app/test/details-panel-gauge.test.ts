import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { drawGauge, GAUGE_LIP_ALPHA } from '../src/hud/details-panel/gauge.js';
import type { Rect } from '../src/hud/geometry.js';

/** A gauge track wide enough that a rounded fill can't reach the wall below 100%. */
const TRACK: Rect = { x: 10, y: 20, w: 120, h: 11 };
const LINE = 1;
const BEVEL = { dark: 0x2a1c10, light: 0xd8c39a };
const FILL = 0x4f9e3c;

interface Filled {
  readonly rect: Rect;
  readonly alpha: number;
}

/** Every rect one gauge draw fills, with the opacity it was filled at - read back off a real `Graphics`,
 *  so this is the paint that actually reaches the draw rather than a stand-in's record of the calls. */
function paint(pct: number): Filled[] {
  const g = new Graphics();
  drawGauge(g, TRACK, pct, LINE, FILL, BEVEL);
  return g.context.instructions.flatMap((i) => {
    if (i.action !== 'fill') return [];
    const box = i.data.path.instructions.find((p) => p.action === 'rect')?.data;
    if (!Array.isArray(box)) return [];
    const [x, y, w, h] = box;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') {
      return [];
    }
    return [{ rect: { x, y, w, h }, alpha: i.data.style.alpha }];
  });
}

/** The leading-edge lip - the only fill the gauge paints at {@link GAUGE_LIP_ALPHA}. */
const lipOf = (fills: readonly Filled[]): Rect | undefined =>
  fills.find((f) => f.alpha === GAUGE_LIP_ALPHA)?.rect;

/** How far right the fill reaches: the opaque gradient strips, which start one line inside the track. */
const fillRightOf = (fills: readonly Filled[]): number =>
  Math.max(
    ...fills.filter((f) => f.alpha === 1 && f.rect.x === TRACK.x + LINE).map((f) => f.rect.x + f.rect.w),
  );

describe('details panel gauge', () => {
  it('caps a partly-filled gauge with a leading-edge lip', () => {
    const fills = paint(60);
    // The fill's end is a moving surface, so it gets its darker cap - sitting on that end, inside the
    // track's right wall.
    expect(lipOf(fills)?.w).toBe(LINE);
    expect(lipOf(fills)?.x).toBe(fillRightOf(fills) - LINE);
    expect(fillRightOf(fills)).toBeLessThan(TRACK.x + TRACK.w - LINE);
  });

  it('drops the lip at full, so a 100% bar does not read a few points short', () => {
    const fills = paint(100);
    // A full fill meets the track wall and has no leading edge. Capping it there stacked a second dark
    // column on the outline, and the gauge read like it stopped short of full.
    expect(lipOf(fills)).toBeUndefined();
    expect(fillRightOf(fills)).toBe(TRACK.x + TRACK.w - LINE);
  });
});
