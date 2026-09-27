import type { ResolvedLayer } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { feetLine, growFigureBounds, vehicleFit } from '../src/hud/tool-panel/messages/figures.js';

const HEIGHT = 50;
/** The usual gap under the feet (design px). */
const FEET_INSET = 6;
const ZOOM = 1;
const PIXEL_SCALE = 1;
/** A figure whose top sits 20 px above its feet. */
const FIGURE_TOP = -20;
const layers: readonly ResolvedLayer[] = [
  { frame: { offsetY: FIGURE_TOP } as ResolvedLayer['frame'], scale: 1 } as ResolvedLayer,
];

describe('notice figure feet line', () => {
  it('stands the feet 6 px above the bottom while the card is uncovered', () => {
    expect(feetLine(layers, HEIGHT, HEIGHT, ZOOM, PIXEL_SCALE)).toBe(HEIGHT - FEET_INSET);
  });

  it('lowers the figure on a covered card until its middle meets the middle of the visible strip', () => {
    const visible = 27;
    expect(feetLine(layers, HEIGHT, visible, ZOOM, PIXEL_SCALE)).toBe(HEIGHT - visible / 2 - FIGURE_TOP / 2);
    expect(feetLine(layers, HEIGHT, visible, ZOOM, PIXEL_SCALE)).toBeGreaterThan(HEIGHT - FEET_INSET);
  });

  it('never brings the feet closer than 2 px to the bottom edge', () => {
    expect(feetLine(layers, HEIGHT, 10, ZOOM, PIXEL_SCALE)).toBe(HEIGHT - 2);
  });
});

/** A layer whose frame spans `width` x `height` map px, offset from the feet anchor. */
function frameLayer(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  exempt = false,
): ResolvedLayer {
  return {
    frame: { offsetX, offsetY, width, height } as ResolvedLayer['frame'],
    scale: 1,
    ...(exempt ? { boundsExempt: true } : {}),
  } as ResolvedLayer;
}

describe('notice vehicle fit', () => {
  /** A ship 160 x 80 map px, its feet anchor at its bottom middle. */
  const SHIP = frameLayer(-80, -80, 160, 80);
  const WIDTH = 46;
  const HEIGHT = 48;
  /** The side, bottom and uncovered top padding (design px). */
  const SIDE = 5;
  const BOTTOM = 3;
  const TOP = 5;

  it('grows one box over the body frames it has seen and leaves the shadow out', () => {
    const first = growFigureBounds(null, [frameLayer(-100, -10, 300, 20, true), SHIP]);
    expect(first).toEqual({ minX: -80, minY: -80, maxX: 80, maxY: 0 });
    const turned = growFigureBounds(first, [frameLayer(-60, -90, 120, 90)]);
    expect(turned).toEqual({ minX: -80, minY: -90, maxX: 80, maxY: 0 });
    expect(growFigureBounds(null, [frameLayer(0, 0, 1, 1, true)])).toBeNull();
  });

  it('contains a ship in the padded box, centred', () => {
    const bounds = { minX: -80, minY: -80, maxX: 80, maxY: 0 };
    const fit = vehicleFit(bounds, WIDTH, HEIGHT, HEIGHT, PIXEL_SCALE);
    expect(fit.zoom).toBeCloseTo((WIDTH - 2 * SIDE) / 160);
    expect(fit.feetX).toBeCloseTo(WIDTH / 2);
    // The ship's middle sits in the middle of the padded box.
    expect(fit.feetY - 40 * fit.zoom).toBeCloseTo((TOP + HEIGHT - BOTTOM) / 2);
  });

  it('never blows a small cart past one map px per design px', () => {
    const fit = vehicleFit({ minX: -5, minY: -10, maxX: 5, maxY: 0 }, WIDTH, HEIGHT, HEIGHT, PIXEL_SCALE);
    expect(fit.zoom).toBe(1);
  });

  it('shrinks a tall body into the visible strip of a covered card, up to the cap', () => {
    const tall = { minX: -10, minY: -100, maxX: 10, maxY: 0 };
    const open = vehicleFit(tall, WIDTH, HEIGHT, HEIGHT, PIXEL_SCALE);
    const covered = vehicleFit(tall, WIDTH, HEIGHT, 30, PIXEL_SCALE);
    expect(covered.zoom).toBeLessThan(open.zoom);
    // The cover's top padding stops at 24 px however far the card is covered.
    const most = vehicleFit(tall, WIDTH, HEIGHT, 0, PIXEL_SCALE);
    expect(most.zoom).toBeCloseTo((HEIGHT - BOTTOM - 24) / 100);
  });
});
