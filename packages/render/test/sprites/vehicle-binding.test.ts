import { describe, expect, it } from 'vitest';
import { GFX_DIR_TO_FACING } from '../../src/data/sprites/settler.js';
import type { FrameListAnim } from '../../src/data/sprites/settler-bindings.js';
import {
  attackSmokeShowing,
  resolveVehicleDraw,
  VEHICLE_ATTACK_TICKS,
} from '../../src/data/sprites/vehicle.js';
import type { VehicleBinding, VehicleLook } from '../../src/data/sprites/vehicle-bindings.js';
import { drawItem } from '../support/fixtures.js';

/**
 * The vehicle frame pick: one look per tribe and type, each state falling down the chain
 * `loaded → unloaded → wait`, and the base tribe standing in for an unbound one. Frame lists are in render-facing order here, as the app's join emits them.
 */

const VIKING = 1;
const FRANK = 2;
const EGYPT = 7;
const HANDCART = 1;
const OXCART = 2;
const SHIP = 3;
const WOOD = 5;
const FACINGS = 8;

/** One frame per facing, `base + facing`, so a test can read the facing off the bob id. */
const oneFrame = (base: number): FrameListAnim => ({
  start: 0,
  frameLists: Array.from({ length: FACINGS }, (_, f) => [base + f]),
  loop: true,
});
/** `frames` frames per facing at `base + facing * 100 + step`. */
const strip = (base: number, frames: number, ticksPerFrame?: number): FrameListAnim => ({
  start: 0,
  frameLists: Array.from({ length: FACINGS }, (_, f) =>
    Array.from({ length: frames }, (_, i) => base + f * 100 + i),
  ),
  loop: true,
  ...(ticksPerFrame !== undefined ? { ticksPerFrame } : {}),
});

const CART_LAYER = 'cr_veh_body_00.goods01';
const cart: VehicleLook = {
  layer: CART_LAYER,
  idle: oneFrame(1000),
  moving: strip(2000, 12),
  loadedMoving: strip(3000, 12),
  movingByGood: { [WOOD]: strip(4000, 12) },
};
/** A cart with a wait but no drive, the shipped byzantine data. */
const waitOnly: VehicleLook = { layer: 'cr_veh_body_00.oxcart', idle: oneFrame(5000) };
const ship: VehicleLook = {
  layer: 'ls_vehicles.human_ship01',
  idle: oneFrame(6000),
  mooredIdle: oneFrame(7000),
  moving: oneFrame(6000),
  afloat: true,
};
const catapult: VehicleLook = {
  layer: 'cr_veh_body_00.goods_bow',
  idle: oneFrame(8000),
  attack: strip(9000, 40, VEHICLE_ATTACK_TICKS / 40),
};
const CATAPULT = 5;

const binding: VehicleBinding = {
  byTribe: {
    [VIKING]: { [HANDCART]: cart, [SHIP]: ship, [CATAPULT]: catapult },
    [FRANK]: { [OXCART]: waitOnly },
  },
  fallbackTribe: VIKING,
  attackFx: { name: 'fx smoke', dx: 0, dy: -36 },
};

const item = (fields: Parameters<typeof drawItem>[1]) => drawItem('vehicle', { tribe: VIKING, ...fields });

describe('resolveVehicleDraw', () => {
  it('stands a vehicle on its wait at its facing, from its own family atlas', () => {
    const draw = resolveVehicleDraw(binding, item({ typeId: HANDCART, facing: 3, state: 'idle' }), 7);
    expect(draw).toEqual({ bob: 1003, layer: CART_LAYER, sway: 'none', indexed: false });
  });

  it('defaults an item with no facing to the toward-camera pose', () => {
    const draw = resolveVehicleDraw(binding, item({ typeId: HANDCART }), 0);
    expect(draw?.bob).toBe(1000 + GFX_DIR_TO_FACING[1]);
  });

  it('drives on the gait clock, unloaded, loaded per good, then loaded for any other good', () => {
    const moving = { typeId: HANDCART, facing: 2, state: 'moving' as const };
    expect(resolveVehicleDraw(binding, item(moving), 0, 5)?.bob).toBe(2000 + 200 + 5);
    expect(resolveVehicleDraw(binding, item({ ...moving, carrying: true, carryGood: WOOD }), 0, 5)?.bob).toBe(
      4000 + 200 + 5,
    );
    expect(resolveVehicleDraw(binding, item({ ...moving, carrying: true, carryGood: 9 }), 0, 5)?.bob).toBe(
      3000 + 200 + 5,
    );
    expect(resolveVehicleDraw(binding, item({ ...moving, carrying: true }), 0, 17)?.bob).toBe(3000 + 200 + 5);
  });

  it('holds the wait while moving when the row authors no drive', () => {
    const draw = resolveVehicleDraw(
      binding,
      item({ tribe: FRANK, typeId: OXCART, facing: 4, state: 'moving' }),
      3,
      9,
    );
    expect(draw).toEqual({ bob: 5004, layer: 'cr_veh_body_00.oxcart', sway: 'none', indexed: false });
  });

  it('furls the sails while a ship lies moored, sets them at sea, and keeps a cart on its one wait', () => {
    expect(resolveVehicleDraw(binding, item({ typeId: SHIP, facing: 0, moored: true }), 0)?.bob).toBe(7000);
    expect(
      resolveVehicleDraw(binding, item({ typeId: SHIP, facing: 0, moored: true, carrying: true }), 0)?.bob,
    ).toBe(7000);
    expect(resolveVehicleDraw(binding, item({ typeId: SHIP, facing: 0, carrying: true }), 0)?.bob).toBe(6000);
    expect(resolveVehicleDraw(binding, item({ typeId: HANDCART, facing: 0, moored: true }), 0)?.bob).toBe(
      1000,
    );
  });

  it('rides the swell at sea, harder under sail, and lies still moored; a cart never sways', () => {
    const sway = (fields: Parameters<typeof item>[0]) => resolveVehicleDraw(binding, item(fields), 0)?.sway;
    expect(sway({ typeId: SHIP, facing: 0, moored: true })).toBe('none');
    expect(sway({ typeId: SHIP, facing: 0 })).toBe('atSea');
    expect(sway({ typeId: SHIP, facing: 0, state: 'moving' })).toBe('sailing');
    expect(sway({ typeId: HANDCART, facing: 0, state: 'moving' })).toBe('none');
  });

  it('marks the frame of an indexed look, whatever the vehicle is doing', () => {
    const owned: VehicleBinding = {
      ...binding,
      byTribe: { [VIKING]: { [SHIP]: { ...ship, layer: 'ls_vehicles.indexed', indexed: true } } },
    };
    const indexed = (fields: Parameters<typeof item>[0]) =>
      resolveVehicleDraw(owned, item(fields), 0)?.indexed;
    expect(indexed({ typeId: SHIP, facing: 0 })).toBe(true);
    expect(indexed({ typeId: SHIP, facing: 0, state: 'moving' })).toBe(true);
    expect(resolveVehicleDraw(binding, item({ typeId: SHIP, facing: 0 }), 0)?.indexed).toBe(false);
  });

  it('loops the catapult shot on the attack cadence while the vehicle attacks, whatever its motion state', () => {
    const attacking = { typeId: CATAPULT, facing: 1, task: 'attacks' as const };
    expect(resolveVehicleDraw(binding, item(attacking), 0)?.bob).toBe(9100);
    expect(resolveVehicleDraw(binding, item(attacking), 12)?.bob).toBe(9100 + 10);
    expect(
      resolveVehicleDraw(binding, item({ ...attacking, state: 'moving' }), VEHICLE_ATTACK_TICKS - 1)?.bob,
    ).toBe(9100 + 39);
    expect(resolveVehicleDraw(binding, item(attacking), VEHICLE_ATTACK_TICKS)?.bob).toBe(9100);
    // A type with no shot clip stands its wait while attacking.
    expect(resolveVehicleDraw(binding, item({ typeId: HANDCART, facing: 1, task: 'attacks' }), 12)?.bob).toBe(
      1001,
    );
  });

  it('draws an unbound tribe’s vehicles from the fallback tribe, and nothing for a type nobody binds', () => {
    expect(resolveVehicleDraw(binding, item({ tribe: EGYPT, typeId: HANDCART, facing: 0 }), 0)?.bob).toBe(
      1000,
    );
    expect(resolveVehicleDraw(binding, item({ tribe: FRANK, typeId: HANDCART, facing: 0 }), 0)?.bob).toBe(
      1000,
    );
    expect(resolveVehicleDraw(binding, item({ tribe: FRANK, typeId: 6, facing: 0 }), 0)).toBeNull();
    expect(resolveVehicleDraw(binding, item({ facing: 0 }), 0)).toBeNull();
    expect(resolveVehicleDraw(undefined, item({ typeId: HANDCART }), 0)).toBeNull();
  });

  it('draws every facing of every state from a distinct frame', () => {
    for (const state of ['idle', 'moving'] as const) {
      const bobs = new Set<number>();
      for (let facing = 0; facing < FACINGS; facing++) {
        bobs.add(resolveVehicleDraw(binding, item({ typeId: HANDCART, facing, state }), 0, 0)?.bob ?? -1);
      }
      expect(bobs.size).toBe(FACINGS);
    }
  });
});

describe('attackSmokeShowing', () => {
  it('shows the smoke in the tail of every attack cycle and not at its start', () => {
    expect(attackSmokeShowing(0)).toBe(false);
    expect(attackSmokeShowing(VEHICLE_ATTACK_TICKS - 1)).toBe(true);
    expect(attackSmokeShowing(VEHICLE_ATTACK_TICKS * 3 + 30)).toBe(true);
    expect(attackSmokeShowing(VEHICLE_ATTACK_TICKS * 3 + 10)).toBe(false);
  });
});
