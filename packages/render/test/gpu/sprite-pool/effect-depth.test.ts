import { ONE } from '@open-northland/sim';
import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type Camera, tileToScreen } from '../../../src/data/projection/index.js';
import { screenDepth } from '../../../src/data/scene/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import type { SpriteSheet } from '../../../src/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

const LIFT = 40;
const HILL: ElevationField = { maxLift: LIFT, liftAt: () => LIFT, liftAtNode: () => LIFT };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const EVERYTHING = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };
const TEMPLE = 1;
const TEMPLE_TYPE = 37;
const COL = 4;
const ROW = 6;
/** A fire point behind the house's middle and off to its side. */
const FIRE = { x: 30, y: -50 };

const source = new TextureSource({ width: 8, height: 8 });
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: { settler: 1, resource: 1, building: 1 },
  holyFire: () => ({ name: 'fx fire incense', points: [FIRE], perpetual: true }),
};

describe('SpritePool - a staged effect on lifted ground', () => {
  it("sorts at its building's row, so the hill moves the two together", () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    const temple = entity(TEMPLE, COL, ROW, {
      Building: { buildingType: TEMPLE_TYPE, tribe: 1, level: 0, built: ONE },
      Owner: { player: 0 },
      TempleFire: { burnedSeconds: 0, blessing: true, doused: false, fuelGood: null },
    });
    pool.reconcile({
      snapshot: snapshotOf([temple]),
      viewport: EVERYTHING,
      tick: 0,
      camera: CAMERA,
      screenW: 800,
      screenH: 600,
      elevation: HILL,
      alpha: 1,
    });
    const at = tileToScreen(COL, ROW);
    const depths = layer.children.map((child) => child.zIndex);
    expect(depths).toContain(screenDepth(at.x, at.y, 'building'));
    expect(depths).toContain(screenDepth(at.x + FIRE.x, at.y, 'craftfx'));
  });
});
