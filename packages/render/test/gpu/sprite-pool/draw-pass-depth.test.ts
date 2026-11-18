import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type Camera, depthKey, tileToScreen } from '../../../src/data/projection/index.js';
import { drawPassDepth, SIGN_DEPTH_EPS, screenDepth } from '../../../src/data/scene/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { PLOT_BOUNDS } from '../../../src/gpu/placement/plan-road.js';
import { SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const EVERYTHING = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };
const SUBJECT = 1;
const BUILDER = 9;
const WOOD = 4;
const COL = 4;
const ROW = 6;

function drawnDepth(components: Record<string, unknown>): number {
  const layer = new Container();
  const pool = new SpritePool(layer, new TextureCache(), undefined);
  pool.reconcile({
    snapshot: snapshotOf([entity(SUBJECT, COL, ROW, components)]),
    viewport: EVERYTHING,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
  });
  const [drawn] = layer.children;
  if (drawn === undefined) throw new Error('the entity drew nothing');
  return drawn.zIndex;
}

const roadSite = (reservation: unknown) => ({ RoadSite: { tribe: 1, construction: [], reservation } });

describe('SpritePool - draw pass depth', () => {
  const at = tileToScreen(COL, ROW);

  it('paints an unclaimed plot with the ground and sorts a claimed one at its back edge', () => {
    expect(drawnDepth(roadSite(null))).toBeLessThan(drawPassDepth('goods'));
    const claimed = drawnDepth(roadSite({ builder: BUILDER }));
    expect(claimed).toBe(screenDepth(at.x, at.y + PLOT_BOUNDS.top, 'roadsite'));
    // A walker standing on the plot's centre paints over the plot and its flag.
    expect(screenDepth(at.x, at.y, 'settler')).toBeGreaterThan(claimed);
  });

  it('paints goods on the ground over the still landscape and under a house sign rows behind them', () => {
    const heap = drawnDepth({ Stockpile: { amounts: [[WOOD, 3]] } });
    const drop = drawnDepth({ Stockpile: { amounts: [[WOOD, 1]] }, GroundDrop: { goodType: WOOD } });
    const houseRowsBehind = tileToScreen(COL, 0);
    const sign = screenDepth(houseRowsBehind.x, houseRowsBehind.y, 'building') + SIGN_DEPTH_EPS;
    // A bridge whose deck they lie on, anchored rows in front, as the map-object layer keys it.
    const deckRowsInFront = tileToScreen(COL, ROW + 4);
    const deck = depthKey(deckRowsInFront.x, deckRowsInFront.y) + drawPassDepth('ground');
    for (const goods of [heap, drop]) {
      expect(goods).toBeGreaterThan(deck);
      expect(goods).toBeLessThan(sign);
    }
    // The delivery flag holds no goods and stands among the standing sprites.
    expect(drawnDepth({ DeliveryFlag: {} })).toBe(screenDepth(at.x, at.y, 'stockpile'));
  });
});
