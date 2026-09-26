import type { SpriteAtlas, SpriteLayer, SpriteSheet, TextureSource } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  indexedStandingFrames,
  packIconFrames,
  type VehicleIconContent,
  vehicleGoodIcons,
  vehicleIconStem,
  vehicleTypeOfGood,
} from '../src/content/vehicle-gfx/icons.js';

/**
 * A vehicle good's HUD icon is the vehicle standing, cut from the vehicle atlas the map draws it from, so
 * a joiner set to build carts shows a cart rather than the generic goods heap.
 */

const VIKING = 1;
const HANDCART = 1;
const OXCART = 2;
const CART_NO_OX = 6;
const HANDCART_YARD = 42;
const OXCART_YARD = 43;
const SHIP = 3;
const SHIP_YARD = 44;
const SHIP_BOB = 5;
const HANDCART_BOB = 3;
const OXCART_BOB = 9;
const FACINGS = 8;

const content: VehicleIconContent = {
  goods: [
    { id: 'handcart', vehicleHouse: HANDCART_YARD },
    { id: 'oxcart', vehicleHouse: OXCART_YARD },
    { id: 'wood' },
    { id: 'ship', vehicleHouse: SHIP_YARD },
  ],
  buildings: [
    { typeId: HANDCART_YARD, vehicleType: HANDCART },
    { typeId: OXCART_YARD, vehicleType: CART_NO_OX },
    { typeId: SHIP_YARD, vehicleType: SHIP },
  ],
  vehicles: [
    { typeId: HANDCART },
    { typeId: CART_NO_OX, transformVehicleType: OXCART },
    { typeId: OXCART },
    { typeId: SHIP },
  ],
};

const source = {} as TextureSource;
const frame = (x: number) => ({ x, y: 0, width: 20, height: 14, offsetX: 0, offsetY: 0 });
const atlas: SpriteAtlas = {
  width: 100,
  height: 14,
  frames: new Map([
    [HANDCART_BOB, frame(0)],
    [OXCART_BOB, frame(40)],
  ]),
};
const carts: SpriteLayer = { source, atlas };
/** A wait clip whose every facing holds the one bob. */
const wait = (bob: number) => ({
  start: bob,
  frameLists: Array.from({ length: FACINGS }, () => [0]),
  loop: true,
});

const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: { byType: {}, default: 0 },
    vehicle: {
      fallbackTribe: VIKING,
      byTribe: {
        [VIKING]: {
          [HANDCART]: { layer: 'carts', idle: wait(HANDCART_BOB) },
          [OXCART]: { layer: 'carts', idle: wait(OXCART_BOB) },
        },
      },
    },
  },
  families: { carts },
};

describe('vehicleTypeOfGood', () => {
  it('follows the yard to the vehicle, in its harnessed form', () => {
    expect(vehicleTypeOfGood(content, 'handcart')).toBe(HANDCART);
    // The ox cart's yard spawns the ox-less cart, which becomes the ox cart the player ordered.
    expect(vehicleTypeOfGood(content, 'oxcart')).toBe(OXCART);
    expect(vehicleTypeOfGood(content, 'wood')).toBeUndefined();
  });
});

describe('vehicleGoodIcons', () => {
  it('cuts each vehicle good its standing frame from the vehicle atlas', () => {
    const icons = vehicleGoodIcons(sheet, content);
    expect(icons.get('handcart')?.frame.x).toBe(0);
    expect(icons.get('oxcart')?.frame.x).toBe(40);
    expect(icons.has('wood')).toBe(false);
  });

  it('has no icon without a sheet or a bound look, so the generic heap stays', () => {
    expect(vehicleGoodIcons(undefined, content).size).toBe(0);
    const { vehicle: _vehicle, ...unbound } = sheet.bindings;
    const bare: SpriteSheet = { ...sheet, bindings: unbound };
    expect(vehicleGoodIcons(bare, content).size).toBe(0);
  });

  it('mints one texture per sheet, so a remount reuses rather than re-wrapping the source', () => {
    expect(vehicleGoodIcons(sheet, content)).toBe(vehicleGoodIcons(sheet, content));
  });
});

describe('vehicleGoodIcons - an indexed look', () => {
  const HULLS = 'ls_vehicles.indexed';
  const hulls: SpriteLayer = {
    source,
    atlas: { width: 100, height: 14, frames: new Map([[SHIP_BOB, frame(60)]]) },
  };
  const shipSheet = (families: Record<string, SpriteLayer>): SpriteSheet => ({
    ...sheet,
    bindings: {
      ...sheet.bindings,
      vehicle: {
        fallbackTribe: VIKING,
        byTribe: { [VIKING]: { [SHIP]: { layer: HULLS, idle: wait(SHIP_BOB), indexed: true } } },
      },
    },
    families: { carts, ...families },
  });

  it('cuts the ship from its baked icon page, never from the palette-index atlas', () => {
    const baked: SpriteLayer = {
      source,
      atlas: { width: 20, height: 14, frames: new Map([[SHIP_BOB, frame(0)]]) },
    };
    const icons = vehicleGoodIcons(shipSheet({ [HULLS]: hulls, [vehicleIconStem(HULLS)]: baked }), content);
    expect(icons.get('ship')?.frame.x).toBe(0);
  });

  it('has no icon without the baked page, so the generic heap stays rather than a red silhouette', () => {
    const icons = vehicleGoodIcons(shipSheet({ [HULLS]: hulls }), content);
    expect(icons.has('ship')).toBe(false);
  });

  it('asks the loader for each indexed body standing frame only', () => {
    const binding = shipSheet({}).bindings.vehicle;
    expect(indexedStandingFrames(binding)).toEqual(new Map([[HULLS, new Set([SHIP_BOB])]]));
    expect(indexedStandingFrames(sheet.bindings.vehicle).size).toBe(0);
  });
});

describe('packIconFrames', () => {
  it('copies the named frames side by side with their ids and offsets', () => {
    // A 4x2 page: frame 1 is the right 2x2 block, frame 2 the left 1x1 pixel.
    const page = { width: 4, height: 2, data: Uint8Array.from({ length: 4 * 2 * 4 }, (_, i) => i) };
    const atlas: SpriteAtlas = {
      width: 4,
      height: 2,
      frames: new Map([
        [1, { x: 2, y: 0, width: 2, height: 2, offsetX: -1, offsetY: -2 }],
        [2, { x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 }],
        [3, { x: 0, y: 1, width: 0, height: 0, offsetX: 0, offsetY: 0 }],
      ]),
    };
    const packed = packIconFrames(page, atlas, [1, 2, 3]);
    expect(packed?.atlas.width).toBe(3);
    expect(packed?.atlas.height).toBe(2);
    expect(packed?.atlas.frames.get(1)).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      offsetX: -1,
      offsetY: -2,
    });
    expect(packed?.atlas.frames.get(2)).toMatchObject({ x: 2, y: 0 });
    expect(packed?.atlas.frames.has(3)).toBe(false);
    // Row 0 is page pixels 2, 3 then 0; row 1 is page pixels 6, 7 then the unused gap.
    const pixel = (i: number) => [...(packed?.pixels.subarray(i * 4, i * 4 + 4) ?? [])];
    expect([pixel(0), pixel(1), pixel(2)]).toEqual([
      [8, 9, 10, 11],
      [12, 13, 14, 15],
      [0, 1, 2, 3],
    ]);
    expect([pixel(3), pixel(4), pixel(5)]).toEqual([
      [24, 25, 26, 27],
      [28, 29, 30, 31],
      [0, 0, 0, 0],
    ]);
    expect(packIconFrames(page, atlas, [3])).toBeUndefined();
  });
});
