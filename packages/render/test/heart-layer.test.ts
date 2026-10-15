import { type Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import {
  heartStepOf,
  LIFE_HEART_STEPS,
  type LifeHeart,
  type LifeHeartFrame,
  LifeHeartLayer,
  type LifeHeartSheet,
} from '../src/gpu/overlays/heart-layer.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { ONE, tileToScreen } from '../src/index.js';
import { drawnGeometry } from './support/fixtures.js';

const EMPTY_STEP = LIFE_HEART_STEPS - 1;
const RED_SLOT = 1;

/** A heart bob's size and hot spot, as the decoded frames author them: the tip on the bottom row. */
const bob = (x: number): AtlasFrame => ({ x, y: 0, width: 17, height: 15, offsetX: -8, offsetY: -14 });
const sheet = (): LifeHeartSheet => ({
  source: new TextureSource({ width: 17 * LIFE_HEART_STEPS, height: 15 }),
  frames: Array.from({ length: LIFE_HEART_STEPS }, (_, step) => bob(17 * step)),
});
const blue = sheet();
const red = sheet();

function layerWithArt(): LifeHeartLayer {
  const layer = new LifeHeartLayer();
  layer.setGfx({ byPlayer: [blue, red], textures: new TextureCache() });
  return layer;
}

const heart = (life: number, colourSlot = 0): LifeHeart => ({ id: 1, x: ONE, y: ONE, colourSlot, life });

const drawnSprite = (layer: LifeHeartLayer): Sprite => layer.container.children[0] as Sprite;

describe('heartStepOf - a tenth of life per frame', () => {
  it('draws full life on the first frame and none on the last', () => {
    expect(heartStepOf(1)).toBe(0);
    expect(heartStepOf(0)).toBe(EMPTY_STEP);
  });

  it('takes the nearest step', () => {
    expect(heartStepOf(0.5)).toBe(5);
    expect(heartStepOf(0.94)).toBe(1);
    expect(heartStepOf(0.96)).toBe(0);
    expect(heartStepOf(0.04)).toBe(EMPTY_STEP);
  });

  it('clamps beyond the range', () => {
    expect(heartStepOf(2)).toBe(0);
    expect(heartStepOf(-1)).toBe(EMPTY_STEP);
  });
});

describe('LifeHeartLayer - the owner palette and the life step', () => {
  it('draws the frame of the life step from the owner slot page', () => {
    const layer = layerWithArt();
    layer.draw({ hearts: [heart(0.3, RED_SLOT)] });
    const texture = drawnSprite(layer).texture;
    expect(texture.source).toBe(red.source);
    expect(texture.frame.x).toBe(red.frames[heartStepOf(0.3)]?.x);
  });

  it('a slot without a page draws slot 0 hearts', () => {
    const layer = layerWithArt();
    layer.draw({ hearts: [heart(1, 9)] });
    expect(drawnSprite(layer).texture.source).toBe(blue.source);
  });

  it('keeps the retained sprite and swaps its frame when life changes', () => {
    const layer = layerWithArt();
    layer.draw({ hearts: [heart(1)] });
    const sprite = drawnSprite(layer);
    layer.draw({ hearts: [heart(0)] });
    expect(drawnSprite(layer)).toBe(sprite);
    expect(sprite.texture.frame.x).toBe(blue.frames[EMPTY_STEP]?.x);
  });

  it('draws nothing without art, and says so to the column', () => {
    const layer = new LifeHeartLayer();
    expect(layer.drawsHearts).toBe(false);
    layer.draw({ hearts: [heart(1)] });
    expect(layer.container.children).toHaveLength(0);
    expect(layerWithArt().drawsHearts).toBe(true);
  });
});

/** The shared mark anchor picks the estimate; these pin what the heart layer contributes to it - its own
 *  back height and float gap, the bob's tip standing on the anchor. */
describe('LifeHeartLayer back anchoring', () => {
  const HEART_GAP = 4;
  const BACK_ABOVE_FEET = 26;

  function tipOf(frame: LifeHeartFrame): { x: number; y: number } {
    const layer = layerWithArt();
    layer.draw(frame);
    const sprite = drawnSprite(layer);
    expect(sprite.anchor.y).toBeCloseTo(14 / 15);
    return { x: sprite.position.x, y: sprite.position.y };
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
    const layer = layerWithArt();
    layer.draw({ hearts: [culled] }, framing);
    expect(layer.container.children.length).toBe(1);

    layer.draw({ hearts: [culled] }, excluding);
    expect(layer.container.children.length).toBe(0);

    layer.draw({ hearts: [culled] }, framing);
    expect(layer.container.children.length).toBe(1);
  });
});
