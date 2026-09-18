import type { SpriteAtlas, SpriteLayer, SpriteSheet, TextureSource } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  type VehicleIconContent,
  vehicleGoodIcons,
  vehicleTypeOfGood,
} from '../src/content/vehicle-gfx/index.js';

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
const HANDCART_BOB = 3;
const OXCART_BOB = 9;
const FACINGS = 8;

const content: VehicleIconContent = {
  goods: [
    { id: 'handcart', vehicleHouse: HANDCART_YARD },
    { id: 'oxcart', vehicleHouse: OXCART_YARD },
    { id: 'wood' },
  ],
  buildings: [
    { typeId: HANDCART_YARD, vehicleType: HANDCART },
    { typeId: OXCART_YARD, vehicleType: CART_NO_OX },
  ],
  vehicles: [{ typeId: HANDCART }, { typeId: CART_NO_OX, transformVehicleType: OXCART }, { typeId: OXCART }],
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
