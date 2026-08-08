import type { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type LifeHeart, type LifeHeartFrame, LifeHeartLayer } from '../src/gpu/overlays/heart-layer.js';
import { ONE, tileToScreen } from '../src/index.js';
import { drawnGeometry } from './support/fixtures.js';

/**
 * The heart is a life gauge: a rect mask clips the faction-coloured fill to the bottom `life` fraction of
 * the silhouette. Pinned against the full-life mask rather than the shape's constants, so replacing the
 * placeholder art cannot fail these.
 */

const heart = (life: number, colour = 0xff0000): LifeHeart => ({ id: 1, x: ONE, y: ONE, colour, life });

/** A heart node's children are drained, fill, mask, rim, in that order. */
function drawnHeart(layer: LifeHeartLayer, h: LifeHeart): { fill: Graphics; mask: Graphics } {
  layer.draw({ hearts: [h] });
  const node = layer.container.children[0] as Container;
  const [, fill, mask] = node.children as [Graphics, Graphics, Graphics, Graphics];
  return { fill, mask };
}

/** The mask's height at full life - the gauge's own 100% reference. */
function fullHeightOf(layer: LifeHeartLayer): number {
  const height = drawnHeart(layer, heart(1)).mask.scale.y;
  expect(height).toBeGreaterThan(0);
  return height;
}

describe('LifeHeartLayer - the fill level is the life fraction', () => {
  it('clips the fill to the bottom half at half life - it drains from the top, not the tip', () => {
    const layer = new LifeHeartLayer();
    const fullHeight = fullHeightOf(layer);
    const { fill, mask } = drawnHeart(layer, heart(0.5));
    expect(fill.visible).toBe(true);
    expect(fill.mask).toBe(mask);
    expect(mask.scale.y).toBeCloseTo(fullHeight / 2);
    expect(mask.position.y + mask.scale.y).toBeCloseTo(0); // bottom edge stays pinned at the tip
  });

  it('clamps beyond the range and hides the fill at zero', () => {
    const layer = new LifeHeartLayer();
    const fullHeight = fullHeightOf(layer);
    expect(drawnHeart(layer, heart(2)).mask.scale.y).toBeCloseTo(fullHeight);
    expect(drawnHeart(layer, heart(0)).fill.visible).toBe(false);
  });

  it('the rim is a constant-width border over both fills, not a scaled copy behind them', () => {
    const layer = new LifeHeartLayer();
    layer.draw({ hearts: [heart(0.5)] });
    const node = layer.container.children[0] as Container;
    expect(node.children).toHaveLength(4);
    const [drained, fill, , rim] = node.children as [Graphics, Graphics, Graphics, Graphics];
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

  it('a life change moves the mask on the retained node; only a colour change rebuilds it', () => {
    const layer = new LifeHeartLayer();
    layer.draw({ hearts: [heart(1)] });
    const node = layer.container.children[0];
    layer.draw({ hearts: [heart(0.25)] });
    expect(layer.container.children[0]).toBe(node);
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
