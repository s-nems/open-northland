import { describe, expect, it } from 'vitest';
import type { SpriteState } from '../../src/data/scene/index.js';
import { type ByJobTable, pickByJob, resolveSpriteBobId } from '../../src/data/sprites/index.js';
import type { DirectionalAnim, DrawItem, SettlerStateBinding, SpriteBindings } from '../../src/index.js';
import { drawItem } from '../support/fixtures.js';

/**
 * Unit tests for the settler GAIT OVERRIDES and per-job pick — the engaged (aggressive) and carrying
 * (loaded) gait swaps, the per-good carry look, and pickByJob's body/head selection.
 */

describe('resolveSpriteBobId — engaged (aggressive) gait override', () => {
  function settler(state: SpriteState, engaged: boolean, facing = 0): DrawItem {
    return drawItem('settler', {
      state,
      facing,
      ...(engaged ? { engaged: true } : {}),
    });
  }
  const WALK: DirectionalAnim = { start: 1000, dirs: 8, stride: 12 };
  const STAND: DirectionalAnim = { start: 1000, dirs: 8, stride: 12, frames: 1 };
  const AGGR_WALK: DirectionalAnim = { start: 2000, dirs: 8, stride: 12 };
  const AGGR_WAIT: DirectionalAnim = { start: 3000, dirs: 1, stride: 20 };
  const ANIM: SettlerStateBinding = {
    idle: STAND,
    moving: WALK,
    engaged: { moving: AGGR_WALK, idle: AGGR_WAIT },
  };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('engaged moving plays the aggressive walk instead of the relaxed one', () => {
    expect(resolveSpriteBobId(settler('moving', true), bindings, 3)).toBe(2000 + 3); // AGGR_WALK
    expect(resolveSpriteBobId(settler('moving', false), bindings, 3)).toBe(1000 + 3); // relaxed WALK
  });

  it('engaged idle plays the aggressive ready stance (facing-locked strip)', () => {
    expect(resolveSpriteBobId(settler('idle', true), bindings, 5)).toBe(3000 + 5); // AGGR_WAIT (dirs 1)
    expect(resolveSpriteBobId(settler('idle', false), bindings, 5)).toBe(1000); // STAND (frames:1)
  });

  it('falls back to the relaxed gait when an engaged slot is unbound', () => {
    const partial: SpriteBindings = {
      settler: { idle: STAND, moving: WALK, engaged: { moving: AGGR_WALK } }, // no engaged idle
      building: 0,
      resource: 0,
    };
    expect(resolveSpriteBobId(settler('idle', true), partial, 5)).toBe(1000); // falls back to STAND
  });
});

describe('resolveSpriteBobId — carrying (loaded-gait) override', () => {
  /** A settler draw item, with the optional `carrying` haul flag the loaded gait keys off. */
  function settler(
    state: SpriteState,
    opts: { facing?: number; atomicId?: number; elapsed?: number; carrying?: boolean } = {},
  ): DrawItem {
    return drawItem('settler', {
      state,
      ...(opts.facing !== undefined ? { facing: opts.facing } : {}),
      ...(opts.atomicId !== undefined ? { atomicId: opts.atomicId } : {}),
      ...(opts.elapsed !== undefined ? { elapsed: opts.elapsed } : {}),
      ...(opts.carrying ? { carrying: true } : {}),
    });
  }
  const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
  const STAND: DirectionalAnim = { start: 1988, dirs: 8, stride: 12, frames: 1 };
  const CHOP: DirectionalAnim = { start: 5106, dirs: 8, stride: 15, phaseStart: 9 };
  // Mirrors the real human binding: empty walk/stand, the chop on the harvest atomic, and the loaded
  // gait (`..._walk_wood`, bob 4580) on the `carrying` override.
  const WALK_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12 };
  const STAND_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12, frames: 1 };
  const ANIM: SettlerStateBinding = {
    idle: STAND,
    moving: WALK,
    byAtomic: { 24: CHOP },
    carrying: { idle: STAND_WOOD, moving: WALK_WOOD },
  };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('a carrying settler walks the loaded cycle (WALK_WOOD), not the empty walk', () => {
    expect(resolveSpriteBobId(settler('moving', { facing: 3, carrying: true }), bindings, 5)).toBe(
      4580 + 3 * 12 + 5,
    );
    // Without the haul flag the SAME item walks the empty cycle (no carry override applied).
    expect(resolveSpriteBobId(settler('moving', { facing: 3 }), bindings, 5)).toBe(1988 + 3 * 12 + 5);
  });

  it('a carrying settler stands the loaded pose when idle (STAND_WOOD, frames:1 ignores tick)', () => {
    expect(resolveSpriteBobId(settler('idle', { facing: 2, carrying: true }), bindings, 99)).toBe(
      4580 + 2 * 12,
    );
  });

  it('a carrying settler depositing (unbound atomic) holds the loaded stand, not the empty idle', () => {
    // Atomic 23 (deposit/pileup) has no bound swing; while hauling it falls back to the carry stand
    // (STAND_WOOD) so the settler keeps its load on screen until the wood is actually placed.
    expect(
      resolveSpriteBobId(
        settler('acting', { facing: 2, atomicId: 23, elapsed: 3, carrying: true }),
        bindings,
        0,
      ),
    ).toBe(4580 + 2 * 12);
  });

  it('a bound atomic still wins over the carry override (a settler harvests empty-handed)', () => {
    // The chop is bound on atomic 24; even if a (spurious) carry flag were present the harvest swing
    // must still play — carry only swaps the gait, never a bound action animation.
    expect(
      resolveSpriteBobId(
        settler('acting', { facing: 4, atomicId: 24, elapsed: 1, carrying: true }),
        bindings,
        0,
      ),
    ).toBe(
      5106 + 4 * 15 + 9, // phaseStart 9: windup begins
    );
  });

  it('a carry override falls back to the un-loaded slot when a loaded slot is absent', () => {
    // Only `carrying.moving` bound: a hauling idle settler falls through to the plain idle STAND.
    const partial: SpriteBindings = {
      settler: { idle: STAND, moving: WALK, carrying: { moving: WALK_WOOD } },
      building: 0,
      resource: 0,
    };
    expect(resolveSpriteBobId(settler('moving', { facing: 1, carrying: true }), partial, 2)).toBe(
      4580 + 1 * 12 + 2,
    );
    expect(resolveSpriteBobId(settler('idle', { facing: 1, carrying: true }), partial, 2)).toBe(
      1988 + 1 * 12,
    );
  });
});

describe('resolveSpriteBobId — per-good carry look (carrying.byGood)', () => {
  /** A hauling settler item carrying a specific good (or none — the generic loaded look). */
  function hauler(state: SpriteState, facing: number, carryGood?: number): DrawItem {
    return drawItem('settler', {
      state,
      facing,
      carrying: true,
      ...(carryGood !== undefined ? { carryGood } : {}),
    });
  }
  const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
  const WALK_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12 };
  const WALK_STONE: DirectionalAnim = { start: 4100, dirs: 8, stride: 12 };
  const STAND_STONE: DirectionalAnim = { start: 4100, dirs: 8, stride: 12, frames: 1 };
  const STONE = 3;
  const bindings: SpriteBindings = {
    settler: {
      idle: { ...WALK, frames: 1 },
      moving: WALK,
      carrying: {
        idle: { ...WALK_WOOD, frames: 1 },
        moving: WALK_WOOD,
        byGood: { [STONE]: { idle: STAND_STONE, moving: WALK_STONE } },
      },
    },
    building: 20,
    resource: 30,
  };

  it('a settler hauling a byGood-bound good walks THAT cycle, not the generic loaded one', () => {
    expect(resolveSpriteBobId(hauler('moving', 3, STONE), bindings, 5)).toBe(4100 + 3 * 12 + 5);
  });

  it('a settler hauling an unbound good falls back to the generic loaded cycle', () => {
    expect(resolveSpriteBobId(hauler('moving', 3, 99), bindings, 5)).toBe(4580 + 3 * 12 + 5);
  });

  it('a settler hauling with NO carryGood on the item uses the generic loaded cycle', () => {
    expect(resolveSpriteBobId(hauler('moving', 3), bindings, 5)).toBe(4580 + 3 * 12 + 5);
  });

  it('the per-good stand backs the idle/deposit states too', () => {
    expect(resolveSpriteBobId(hauler('idle', 2, STONE), bindings, 99)).toBe(4100 + 2 * 12);
  });

  it('a byGood slot missing one state falls back to the generic loaded slot for that state', () => {
    const partial: SpriteBindings = {
      settler: {
        idle: { ...WALK, frames: 1 },
        moving: WALK,
        carrying: {
          idle: { ...WALK_WOOD, frames: 1 },
          moving: WALK_WOOD,
          byGood: { [STONE]: { moving: WALK_STONE } }, // no per-good idle
        },
      },
      building: 20,
      resource: 30,
    };
    expect(resolveSpriteBobId(hauler('idle', 2, STONE), partial, 0)).toBe(4580 + 2 * 12);
    expect(resolveSpriteBobId(hauler('moving', 2, STONE), partial, 0)).toBe(4100 + 2 * 12);
  });
});

describe('pickByJob — the per-job character pick', () => {
  const table: ByJobTable<string> = {
    byJob: { 5: 'woman', 31: 'warrior' },
    youngByJob: { 1: 'baby', 3: 'girl' },
    default: 'civilian',
  };

  it('an adult job picks from byJob; a miss (any trade) falls to the default', () => {
    expect(pickByJob(table, 5, false)).toBe('woman');
    expect(pickByJob(table, 31, false)).toBe('warrior');
    expect(pickByJob(table, 11, false)).toBe('civilian');
  });

  it('a young settler picks from youngByJob — never the adult table', () => {
    expect(pickByJob(table, 1, true)).toBe('baby');
    expect(pickByJob(table, 3, true)).toBe('girl');
    // A young settler whose age class isn't mapped falls to the default, not to byJob.
    expect(pickByJob(table, 5, true)).toBe('civilian');
  });

  it('an ADULT with a fixture job id colliding with an age class stays the default (dc3ef54)', () => {
    // The demo woodcutter is jobType 1 — the real baby_female id. Without the Age flag it must NEVER
    // draw the baby body.
    expect(pickByJob(table, 1, false)).toBe('civilian');
  });

  it('a jobless (undefined) settler picks the default', () => {
    expect(pickByJob(table, undefined, false)).toBe('civilian');
    expect(pickByJob(table, undefined, true)).toBe('civilian');
  });

  it('a table with no youngByJob sends young settlers to the default', () => {
    const bare: ByJobTable<string> = { byJob: { 5: 'woman' }, default: 'civilian' };
    expect(pickByJob(bare, 1, true)).toBe('civilian');
  });

  it('an equipped weapon good drives the ADULT look over the job; an empty/unmapped slot falls through', () => {
    const armed: ByJobTable<string> = {
      byJob: { 31: 'warrior', 40: 'warrior-shortbow' },
      byWeaponGood: { 41: 'warrior-sword', 37: 'warrior-shortbow' },
      default: 'civilian',
    };
    // A bare warrior (job 31, no weapon) keeps its job body; equip a sword good and it draws the sword body.
    expect(pickByJob(armed, 31, false)).toBe('warrior');
    expect(pickByJob(armed, 31, false, 41)).toBe('warrior-sword');
    // The weapon wins over a conflicting job — a job-40 archer holding a short-bow good still draws the bow.
    expect(pickByJob(armed, 40, false, 37)).toBe('warrior-shortbow');
    // An unmapped weapon good falls through to the job pick, not the default.
    expect(pickByJob(armed, 31, false, 999)).toBe('warrior');
    // A child never keys the weapon table even if a good is (spuriously) present.
    expect(pickByJob(armed, 3, true, 41)).toBe('civilian');
  });
});
