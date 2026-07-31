import type { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type LifeHeart, LifeHeartLayer } from '../src/gpu/overlays/heart-layer.js';
import { ONE } from '../src/index.js';

/**
 * The heart is a life gauge over one silhouette: the faction-coloured fill is clipped to the bottom
 * `life` fraction of the shape by a rect mask, the drained top showing the darkened shade beneath.
 * Pinned against the full-life mask itself (not the shape's constants) so replacing the placeholder
 * art cannot fail these. Pixi `Container`/`Graphics` build without a GL context, so the mask
 * transform is checkable headless.
 */

const heart = (life: number, colour = 0xff0000): LifeHeart => ({ id: 1, x: ONE, y: ONE, colour, life });

/** Draw one heart and hand back its node's fill + mask (children: outline, drained, fill, mask). */
function drawnHeart(layer: LifeHeartLayer, h: LifeHeart): { fill: Graphics; mask: Graphics } {
  layer.draw({ hearts: [h] });
  const node = layer.container.children[0] as Container;
  const [, , fill, mask] = node.children as [Graphics, Graphics, Graphics, Graphics];
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

  it('one silhouette plus a rim - drained and fill sit unscaled, no second full-size heart', () => {
    const layer = new LifeHeartLayer();
    layer.draw({ hearts: [heart(0.5)] });
    const node = layer.container.children[0] as Container;
    expect(node.children).toHaveLength(4);
    const [outline, drained, fill] = node.children as [Graphics, Graphics, Graphics, Graphics];
    expect(drained.scale.x).toBe(1);
    expect(drained.scale.y).toBe(1);
    expect(fill.scale.x).toBe(1);
    // The rim grows the silhouette a hair - a border, not the old 35%-larger backing heart.
    expect(outline.scale.x).toBeGreaterThan(1);
    expect(outline.scale.x).toBeLessThan(1.25);
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
