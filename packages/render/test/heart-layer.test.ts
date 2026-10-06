import type { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  heartBelow,
  type LifeHeart,
  type LifeHeartFrame,
  LifeHeartLayer,
} from '../src/gpu/overlays/heart-layer.js';
import { ONE, tileToScreen } from '../src/index.js';
import { drawnGeometry } from './support/fixtures.js';

/**
 * The heart is a life gauge: the faction-coloured fill is the silhouette cut at the bottom `life`
 * fraction of its height. Pinned against the full-life fill rather than the shape's constants, so
 * replacing the placeholder art cannot fail these.
 */

const heart = (life: number, colour = 0xff0000): LifeHeart => ({ id: 1, x: ONE, y: ONE, colour, life });

/** A heart node's children are drained, fill, rim, in that order. */
function drawnFill(layer: LifeHeartLayer, h: LifeHeart): Graphics {
  layer.draw({ hearts: [h] });
  const node = layer.container.children[0] as Container;
  return node.children[1] as Graphics;
}

/** The fill's local bounds; the tip sits at y 0 and the heart grows up into negative y. */
function fillBounds(layer: LifeHeartLayer, h: LifeHeart): { minY: number; maxY: number } {
  const { minY, maxY } = drawnFill(layer, h).getLocalBounds();
  return { minY, maxY };
}

describe('LifeHeartLayer - the fill level is the life fraction', () => {
  it('cuts the fill to the bottom half at half life - it drains from the top, not the tip', () => {
    const layer = new LifeHeartLayer();
    const full = fillBounds(layer, heart(1));
    const half = fillBounds(new LifeHeartLayer(), heart(0.5));
    expect(full.minY).toBeLessThan(0);
    expect(half.minY).toBeCloseTo(full.minY / 2);
    expect(half.maxY).toBeCloseTo(full.maxY); // the bottom stays pinned at the tip
    expect(drawnFill(layer, heart(0.5)).mask).toBeFalsy();
  });

  it('keeps the outline below the cut and puts the cut on the level line', () => {
    const full = heartBelow(-1e9);
    const cut = heartBelow(-5);
    for (let i = 1; i < cut.length; i += 2) expect(cut[i]).toBeGreaterThanOrEqual(-5);
    expect(cut.filter((_, i) => i % 2 === 1 && cut[i] === -5).length).toBeGreaterThanOrEqual(2);
    expect(full.length).toBeGreaterThan(cut.length);
  });

  it('clamps beyond the range and hides the fill at zero', () => {
    const full = fillBounds(new LifeHeartLayer(), heart(1));
    expect(fillBounds(new LifeHeartLayer(), heart(2)).minY).toBeCloseTo(full.minY);
    expect(drawnFill(new LifeHeartLayer(), heart(0)).visible).toBe(false);
  });

  it('the rim is a constant-width border over both fills, not a scaled copy behind them', () => {
    const layer = new LifeHeartLayer();
    layer.draw({ hearts: [heart(0.5)] });
    const node = layer.container.children[0] as Container;
    expect(node.children).toHaveLength(3);
    const [drained, fill, rim] = node.children as [Graphics, Graphics, Graphics];
    // Painted last, so the drained top wears the same border as the filled bottom.
    expect(node.children.indexOf(rim)).toBe(node.children.length - 1);
    for (const part of [drained, fill, rim]) {
      expect(part.scale.x).toBe(1);
      expect(part.scale.y).toBe(1);
    }
    // A stroke pads the silhouette's bounds equally on every side, while a scaled copy grows in
    // proportion to the distance from the scale origin, so its four margins would disagree.
    const body = drained.getLocalBounds();
    const border = rim.getLocalBounds();
    const margins = [
      body.minX - border.minX,
      border.maxX - body.maxX,
      body.minY - border.minY,
      border.maxY - body.maxY,
    ];
    expect(margins[0]).toBeGreaterThan(0);
    for (const margin of margins) expect(margin).toBeCloseTo(margins[0] as number);
  });

  it('a life change recuts the fill on the retained node; only a colour change rebuilds it', () => {
    const layer = new LifeHeartLayer();
    layer.draw({ hearts: [heart(1)] });
    const node = layer.container.children[0];
    const full = fillBounds(layer, heart(1));
    layer.draw({ hearts: [heart(0.25)] });
    expect(layer.container.children[0]).toBe(node);
    expect(fillBounds(layer, heart(0.25)).minY).toBeCloseTo(full.minY / 4);
    layer.draw({ hearts: [heart(0.25, 0x00ff00)] });
    expect(layer.container.children[0]).not.toBe(node);
  });
});

/** The shared mark anchor picks the estimate; these pin what the heart layer contributes to it - its own
 *  back height and float gap. */
describe('LifeHeartLayer back anchoring', () => {
  const HEART_GAP = 4;
  const BACK_ABOVE_FEET = 26;

  function tipOf(frame: LifeHeartFrame): { x: number; y: number } {
    const layer = new LifeHeartLayer();
    layer.draw(frame);
    const node = layer.container.children[0] as Container;
    return { x: node.position.x, y: node.position.y };
  }

  it('floats the gap above the drawn sprite box, centred on it', () => {
    const bounds = { minX: 100, minY: 40, maxX: 140, maxY: 100 };
    const tip = tipOf({ hearts: [heart(1)], drawn: drawnGeometry({ boundsOf: () => bounds }) });
    expect(tip.x).toBe(120);
    expect(tip.y).toBe(40 - HEART_GAP);
  });

  it('raises the feet anchor a back height when no box was stamped', () => {
    const tip = tipOf({
      hearts: [heart(1)],
      drawn: drawnGeometry({ anchorOf: () => ({ x: 200, y: 300 }) }),
    });
    expect(tip.x).toBe(200);
    expect(tip.y).toBe(300 - BACK_ABOVE_FEET - HEART_GAP);
  });
});

describe('LifeHeartLayer viewport cull', () => {
  const culled = heart(1);
  /** The layer culls on the raw projection of the heart's own position. */
  const p = tileToScreen(culled.x / ONE, culled.y / ONE);
  const framing = { minX: p.x - 100, minY: p.y - 100, maxX: p.x + 100, maxY: p.y + 100 };
  const excluding = { minX: p.x + 1000, minY: p.y + 1000, maxX: p.x + 2000, maxY: p.y + 2000 };

  it('retires the pooled node when its unit scrolls off-screen, and re-mints it on return', () => {
    const layer = new LifeHeartLayer();
    layer.draw({ hearts: [culled] }, framing);
    expect(layer.container.children.length).toBe(1);

    layer.draw({ hearts: [culled] }, excluding);
    expect(layer.container.children.length).toBe(0);

    layer.draw({ hearts: [culled] }, framing);
    expect(layer.container.children.length).toBe(1);
  });
});
