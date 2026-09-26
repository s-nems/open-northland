import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { SpritePool } from '../../src/gpu/sprite-pool/index.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { SpriteAtlas } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** The pool hands the wake overlay every drawn ship, moored ones included, and no land vehicle. */

const VIKING = 1;
const HANDCART = 1;
const SHIP = 3;
const BOB = 1;
const SW = 2; // the six-direction `Vehicle.facing` south-west, render facing 0
const source = new TextureSource({ width: 8, height: 8 });
const atlas: SpriteAtlas = {
  width: 8,
  height: 8,
  frames: new Map([[BOB, { x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -8 }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 0,
    building: 0,
    resource: 0,
    vehicle: {
      byTribe: {
        [VIKING]: {
          [HANDCART]: { layer: 'body', idle: BOB },
          [SHIP]: { layer: 'body', idle: BOB, afloat: true },
        },
      },
      fallbackTribe: VIKING,
    },
  },
  families: { body: { source, atlas } },
};
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };

const vehicle = (vehicleType: number, moored: boolean) => ({
  Vehicle: { vehicleType, tribe: VIKING, facing: SW, moored },
});
const frameOf = (viewport: Viewport, portraitRef?: number) => ({
  snapshot: snapshotOf([
    entity(1, 2, 2, vehicle(SHIP, false)),
    entity(2, 6, 2, vehicle(SHIP, true)),
    entity(3, 2, 6, vehicle(HANDCART, false)),
  ]),
  viewport,
  tick: 1,
  camera: { offsetX: 0, offsetY: 0 },
  screenW: 800,
  screenH: 600,
  elevation: FLAT,
  alpha: 1,
  ...(portraitRef !== undefined ? { portraitRef } : {}),
});

describe('SpritePool.shipsAfloat', () => {
  it('lists the drawn ships at sea and moored, facing as drawn, and leaves the cart out', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), sheet);
    pool.reconcile(frameOf(VIEW_ALL));
    const ships = [...pool.shipsAfloat()].sort((a, b) => a.ref - b.ref);
    expect(ships).toEqual([
      { ref: 1, facing: 0, sailing: false },
      { ref: 2, facing: 0, sailing: false },
    ]);
  });

  it('leaves out a ship drawn only for the details portrait, hidden on the map', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), sheet);
    const nowhere: Viewport = { minX: -1e6, maxX: -1e6 + 1, minY: -1e6, maxY: -1e6 + 1 };
    pool.reconcile(frameOf(nowhere, 1));
    expect(pool.drawnItems().some((item) => item.ref === 1)).toBe(true);
    expect(pool.shipsAfloat()).toEqual([]);
  });
});
