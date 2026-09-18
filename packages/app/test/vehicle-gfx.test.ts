import type { VehicleGraphics } from '@open-northland/data';
import { GFX_DIR_TO_FACING, VEHICLE_ATTACK_TICKS } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  buildVehicleBinding,
  type DrawableFrames,
  vehicleAtlasStems,
  vehicleLook,
} from '../src/content/vehicle-gfx/index.js';

/**
 * The vehicle-look join over the IR's `vehicleGraphics` rows, and the fallbacks the shipped data's holes
 * need (docs/formats/VEHICLES.md "Graphics"): a tribe with no rows draws the base tribe's, a clip whose
 * frames the baked body lacks is dropped so its state falls back, a wait with no drive stands while
 * moving.
 */

const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
const OXCART = 2;
const SHIP_BIG = 4;
const CATAPULT = 5;
const WOOD = 5;
const WAIT = 2;
const SECOND_HULL = 4;
const ATTACK = 81;
const DIRS = 8;

const CART_BODY = 'data/engine2d/bin/bobs/cr_veh_body_00.bmd';
const BIG_SHIP_BODY = 'data/engine2d/bin/bobs/ve_test_ship.bmd';

/** Per-`<dir>` lists `base + dir` (one frame each). */
const perDir = (base: number): number[][] => Array.from({ length: DIRS }, (_, d) => [base + d]);
/** Per-`<dir>` lists of `frames` frames laid back-to-back from `base`, the `[bobseq]` layout. */
const perDirStrip = (base: number, frames: number): number[][] =>
  Array.from({ length: DIRS }, (_, d) => Array.from({ length: frames }, (_, i) => base + d * frames + i));

const row = (
  fields: Partial<VehicleGraphics> & Pick<VehicleGraphics, 'tribe' | 'vehicleType'>,
): VehicleGraphics => ({
  job: fields.vehicleType + 49,
  body: CART_BODY,
  bodyPalette: 'oxcart',
  clips: [],
  gaits: [],
  ...fields,
});

const vikingOxcart = row({
  tribe: VIKING,
  vehicleType: OXCART,
  clips: [{ action: WAIT, dirFrames: perDir(0) }],
  gaits: [{ goodType: 0, dirFrames: perDirStrip(48, 12) }],
});
/** A wait but no drive, the shipped byzantine cart. */
const byzantineOxcart = row({
  tribe: BYZANTINE,
  vehicleType: OXCART,
  clips: [{ action: WAIT, dirFrames: perDir(0) }],
});
/** A drive but no wait. */
const driveOnly = row({
  tribe: FRANK,
  vehicleType: OXCART,
  gaits: [{ goodType: 0, dirFrames: perDirStrip(48, 12) }],
});
const catapult = row({
  tribe: VIKING,
  vehicleType: CATAPULT,
  bodyPalette: 'goods_bow',
  clips: [
    { action: WAIT, dirFrames: perDir(0) },
    { action: ATTACK, dirFrames: perDirStrip(145, 40) },
  ],
});
/** The viking big ship: 32 baked frames, rows indexing the 98-frame layout for its loaded hull. */
const vikingBigShip = row({
  tribe: VIKING,
  vehicleType: SHIP_BIG,
  body: BIG_SHIP_BODY,
  bodyPalette: 'human_ship01',
  shadowBody: 'data/engine2d/bin/bobs/ve_test_ship_s.bmd',
  playerPalettes: ['human_ship01', 'human_ship02', 'human_ship03'],
  clips: [
    { action: WAIT, dirFrames: perDir(0) },
    { action: SECOND_HULL, dirFrames: perDir(0) },
  ],
  gaits: [
    { goodType: 0, dirFrames: perDir(0) },
    { goodType: WOOD, dirFrames: perDir(66) },
  ],
});

const drawable = (stem: string, ids: Iterable<number>): DrawableFrames => new Map([[stem, new Set(ids)]]);
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const CART_FRAMES = range(512);

describe('the vehicle look join', () => {
  it('names every body atlas and shadow twin the rows draw from, one bake per body whatever the owner', () => {
    const { stems, shadowByStem } = vehicleAtlasStems([vikingOxcart, catapult, vikingBigShip]);
    expect([...stems].sort()).toEqual([
      'cr_veh_body_00.goods_bow',
      'cr_veh_body_00.oxcart',
      've_test_ship.human_ship01',
    ]);
    expect(shadowByStem.get('ve_test_ship.human_ship01')).toBe('ve_test_ship_s.shadow');
    expect(shadowByStem.has('cr_veh_body_00.oxcart')).toBe(false);
  });

  it('binds the wait and the drive in render-facing order over the loaded body', () => {
    const look = vehicleLook(
      vikingOxcart,
      new Set(['cr_veh_body_00.oxcart']),
      drawable('cr_veh_body_00.oxcart', CART_FRAMES),
    );
    expect(look?.layer).toBe('cr_veh_body_00.oxcart');
    const idle = look?.idle;
    if (idle === undefined || typeof idle === 'number' || !('frameLists' in idle))
      throw new Error('wait is a frame list');
    // `<dir>` 0 (E) lands on render facing GFX_DIR_TO_FACING[0].
    expect(idle.frameLists[GFX_DIR_TO_FACING[0]]).toEqual([0]);
    expect(idle.frameLists[GFX_DIR_TO_FACING[5]]).toEqual([5]);
    expect(idle.loop).toBe(true);
    const moving = look?.moving;
    if (moving === undefined || typeof moving === 'number' || !('frameLists' in moving))
      throw new Error('drive is a frame list');
    expect(moving.frameLists[GFX_DIR_TO_FACING[1]]).toHaveLength(12);
    expect(moving.frameLists[GFX_DIR_TO_FACING[1]]?.[0]).toBe(48 + 12);
    expect(look?.loadedMoving).toBeUndefined();
    expect(look?.attack).toBeUndefined();
  });

  it('leaves a wait-only row with no drive, and stands a drive-only row on its first frame', () => {
    const frames = drawable('cr_veh_body_00.oxcart', CART_FRAMES);
    const loaded = new Set(['cr_veh_body_00.oxcart']);
    expect(vehicleLook(byzantineOxcart, loaded, frames)?.moving).toBeUndefined();
    const standing = vehicleLook(driveOnly, loaded, frames);
    expect(standing?.moving).toBeDefined();
    const idle = standing?.idle;
    if (idle === undefined || typeof idle === 'number' || !('frameLists' in idle))
      throw new Error('idle is a frame list');
    expect(idle.frameLists.every((list) => list.length === 1)).toBe(true);
  });

  it('paces the catapult shot so its 40 frames fill the 48-tick attack cadence', () => {
    const look = vehicleLook(
      catapult,
      new Set(['cr_veh_body_00.goods_bow']),
      drawable('cr_veh_body_00.goods_bow', CART_FRAMES),
    );
    const attack = look?.attack;
    if (attack === undefined || typeof attack === 'number' || !('frameLists' in attack))
      throw new Error('shot is a frame list');
    expect(attack.ticksPerFrame).toBeCloseTo(VEHICLE_ATTACK_TICKS / 40);
    expect(attack.frameLists[GFX_DIR_TO_FACING[0]]).toHaveLength(40);
  });

  it('drops the viking big ship’s loaded hull, whose bobs the 32-frame bake lacks, and keeps the rest', () => {
    const stem = 've_test_ship.human_ship01';
    const look = vehicleLook(vikingBigShip, new Set([stem]), drawable(stem, range(32)));
    expect(look?.layer).toBe(stem);
    expect(look?.moving).toBeDefined();
    expect(look?.loadedMoving).toBeUndefined();
    expect(look?.movingByGood).toBeUndefined();
    expect(look?.mooredIdle).toBeDefined();
  });

  it('binds nothing for a row whose body did not load, and no binding at all when none did', () => {
    expect(vehicleLook(vikingOxcart, new Set(), new Map())).toBeUndefined();
    expect(buildVehicleBinding([vikingOxcart], new Set(), new Map(), VIKING, false)).toBeUndefined();
  });

  it('keys the binding by tribe with the base tribe as the fallback for a tribe with no rows', () => {
    const loaded = new Set(['cr_veh_body_00.oxcart', 'cr_veh_body_00.goods_bow']);
    const frames: DrawableFrames = new Map([
      ['cr_veh_body_00.oxcart', new Set(CART_FRAMES)],
      ['cr_veh_body_00.goods_bow', new Set(CART_FRAMES)],
    ]);
    const binding = buildVehicleBinding(
      [vikingOxcart, byzantineOxcart, catapult],
      loaded,
      frames,
      VIKING,
      true,
    );
    expect(binding?.fallbackTribe).toBe(VIKING);
    expect(
      Object.keys(binding?.byTribe ?? {})
        .map(Number)
        .sort(),
    ).toEqual([VIKING, BYZANTINE]);
    expect(
      Object.keys(binding?.byTribe[VIKING] ?? {})
        .map(Number)
        .sort(),
    ).toEqual([OXCART, CATAPULT]);
    expect(binding?.attackFx).toMatchObject({ name: 'fx smoke' });
    expect(buildVehicleBinding([vikingOxcart], loaded, frames, VIKING, false)?.attackFx).toBeUndefined();
  });
});
