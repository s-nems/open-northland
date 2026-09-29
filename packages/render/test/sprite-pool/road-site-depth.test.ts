import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type Camera, tileToScreen } from '../../src/data/projection/index.js';
import { drawPassDepth, screenDepth } from '../../src/data/scene/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { PLOT_BOUNDS } from '../../src/gpu/plan-road.js';
import { SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const EVERYTHING = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };
const SITE = 1;
const BUILDER = 9;
const COL = 4;
const ROW = 6;

function siteDepth(reservation: unknown): number {
  const layer = new Container();
  const pool = new SpritePool(layer, new TextureCache(), undefined);
  const site = entity(SITE, COL, ROW, { RoadSite: { tribe: 1, construction: [], reservation } });
  pool.reconcile({
    snapshot: snapshotOf([site]),
    viewport: EVERYTHING,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
  });
  const [drawn] = layer.children;
  if (drawn === undefined) throw new Error('the road site drew nothing');
  return drawn.zIndex;
}

describe('SpritePool - road site depth', () => {
  it('paints an unclaimed plot with the ground and sorts a claimed one at its back edge', () => {
    expect(siteDepth(null)).toBeLessThan(drawPassDepth('sorted'));
    const at = tileToScreen(COL, ROW);
    expect(siteDepth({ builder: BUILDER })).toBe(screenDepth(at.x, at.y + PLOT_BOUNDS.top, 'roadsite'));
    // A walker standing on the plot's centre paints over the plot and its flag.
    expect(screenDepth(at.x, at.y, 'settler')).toBeGreaterThan(siteDepth({ builder: BUILDER }));
  });
});
