import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ONE } from '../../src/data/projection/index.js';
import { OVERHEAD_BASE_GAP, OVERHEAD_STEP, OverheadColumn } from '../../src/data/scene/overhead-column.js';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { ExperienceStarLayer } from '../../src/gpu/overlays/experience-star-layer.js';
import { ImportMarkerLayer } from '../../src/gpu/overlays/import-marker-layer.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { drawnGeometry } from '../support/fixtures.js';

const SOLDIER = 1;
const HEAD_Y = 100;
const HEAD_X = 5;

describe('OverheadColumn', () => {
  it('stacks the worn icons bottom up: weapon star, heart, trade star, bubble, marker', () => {
    const column = new OverheadColumn();
    for (const slot of ['weaponStar', 'heart', 'jobStar', 'bubble', 'marker'] as const)
      column.wear(SOLDIER, slot);
    expect(column.riseOf(SOLDIER, 'weaponStar')).toBe(0);
    expect(column.riseOf(SOLDIER, 'heart')).toBe(OVERHEAD_STEP.weaponStar);
    expect(column.riseOf(SOLDIER, 'jobStar')).toBe(OVERHEAD_STEP.weaponStar + OVERHEAD_STEP.heart);
    expect(column.riseOf(SOLDIER, 'marker')).toBe(16 + 20 + 16 + 16);
  });

  it('an icon not worn takes no room, and a cleared column lifts nothing', () => {
    const column = new OverheadColumn();
    column.wear(SOLDIER, 'heart');
    expect(column.riseOf(SOLDIER, 'marker')).toBe(OVERHEAD_STEP.heart);
    expect(column.riseOf(2, 'marker')).toBe(0);
    column.clear();
    expect(column.riseOf(SOLDIER, 'marker')).toBe(0);
  });
});

describe('the over-head layers read one column', () => {
  const FRAME: AtlasFrame = { x: 0, y: 0, width: 64, height: 32, offsetX: -30, offsetY: -19 };
  const textures = new TextureCache();
  const source = new TextureSource({ width: 64, height: 32 });
  const drawn = drawnGeometry({
    boundsOf: (ref) =>
      ref === SOLDIER ? { minX: 0, minY: HEAD_Y, maxX: 2 * HEAD_X, maxY: HEAD_Y + 40 } : undefined,
  });
  const at = { id: SOLDIER, x: ONE, y: ONE };

  it('hangs the marker over both stars and the heart, the trade star over the heart', () => {
    const column = new OverheadColumn();
    column.wear(SOLDIER, 'weaponStar');
    column.wear(SOLDIER, 'heart');
    column.wear(SOLDIER, 'jobStar');

    const stars = new ExperienceStarLayer();
    stars.setGfx({ source, frameByTier: [FRAME, FRAME, FRAME, FRAME], textures });
    stars.draw({ stars: [{ ...at, weaponTier: 2, jobTier: 1 }], drawn, column });
    const [weaponStar, jobStar] = stars.container.children;
    const base = HEAD_Y - OVERHEAD_BASE_GAP;
    expect(weaponStar?.position.y).toBe(base);
    expect(jobStar?.position.y).toBe(base - OVERHEAD_STEP.weaponStar - OVERHEAD_STEP.heart);
    expect(jobStar?.position.x).toBe(HEAD_X);

    const markers = new ImportMarkerLayer();
    markers.setGfx({ source, frame: FRAME, exemptJobs: new Set(), textures });
    markers.draw({ markers: [at], drawn, column });
    expect(markers.container.children[0]?.position.y).toBe(base - (16 + 20 + 16));
    stars.destroy();
    markers.destroy();
  });

  it('retires a star its wearer lost and swaps the frame when he grows a size', () => {
    const column = new OverheadColumn();
    const small: AtlasFrame = { ...FRAME, width: 8 };
    const stars = new ExperienceStarLayer();
    stars.setGfx({ source, frameByTier: [small, FRAME, FRAME, FRAME], textures });
    stars.draw({ stars: [{ ...at, weaponTier: 1, jobTier: 0 }], drawn, column });
    expect(stars.container.children).toHaveLength(1);
    stars.draw({ stars: [{ ...at, weaponTier: 2, jobTier: 0 }], drawn, column });
    expect(stars.container.children).toHaveLength(1);
    expect(stars.container.children[0]?.width).toBe(FRAME.width);
    stars.draw({ stars: [], drawn, column });
    expect(stars.container.children).toHaveLength(0);
    stars.destroy();
  });
});
