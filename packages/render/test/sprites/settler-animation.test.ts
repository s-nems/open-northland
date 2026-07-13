import { describe, expect, it } from 'vitest';
import type { SpriteState } from '../../src/data/scene/index.js';
import {
  DEFAULT_FACING,
  type DirectionalAnim,
  type DrawItem,
  type FrameListAnim,
  indexAtlasFrames,
  resolveSpriteBobId,
  resolveSpriteFrame,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
} from '../../src/index.js';
import { drawItem } from '../support/fixtures.js';

/**
 * Unit tests for the settler animation PLAYBACK — the per-state frame pick, the directional
 * (start + facing*stride + phase) sequence, and the explicit per-facing FrameListAnim one-shot. All
 * pure "which bob id at this state/facing/clock" decisions.
 */

describe('resolveSpriteFrame — per-state settler binding', () => {
  /** A settler draw item in a given state (+ optional atomic id). */
  function settler(state?: SpriteState, atomicId?: number): DrawItem {
    return drawItem('settler', {
      ...(state !== undefined ? { state } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
    });
  }

  /** An atlas with a distinct frame per state bob: idle=10, moving=11, acting=12, chop=13. */
  function stateAtlas(): SpriteAtlas {
    return indexAtlasFrames(64, 64, [
      { bobId: 10, rect: { x: 0, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
      { bobId: 11, rect: { x: 16, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
      { bobId: 12, rect: { x: 32, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
      { bobId: 13, rect: { x: 48, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
    ]);
  }

  const FULL: SettlerStateBinding = {
    idle: 10,
    moving: 11,
    acting: 12,
    byAtomic: { 24: 13 }, // atomic 24 (chop) overrides the generic acting frame
  };
  const bindings = (settlerBinding: SpriteBindings['settler']): SpriteBindings => ({
    settler: settlerBinding,
    building: 20,
    resource: 30,
  });

  it('picks the state-specific frame: idle/moving/acting each resolve to their own bob', () => {
    const atlas = stateAtlas();
    const b = bindings(FULL);
    expect(resolveSpriteFrame(settler('idle'), b, atlas)?.x).toBe(0); // bob 10
    expect(resolveSpriteFrame(settler('moving'), b, atlas)?.x).toBe(16); // bob 11
    expect(resolveSpriteFrame(settler('acting'), b, atlas)?.x).toBe(32); // bob 12
  });

  it('picks the per-atomic override for an acting settler with a bound atomic id', () => {
    const frame = resolveSpriteFrame(settler('acting', 24), bindings(FULL), stateAtlas());
    expect(frame?.x).toBe(48); // bob 13 — the chop override, not the generic acting bob 12
  });

  it('falls back acting->idle and moving->idle when those states are unbound', () => {
    const sparse: SettlerStateBinding = { idle: 10 }; // no moving/acting/byAtomic
    const b = bindings(sparse);
    const atlas = stateAtlas();
    expect(resolveSpriteFrame(settler('moving'), b, atlas)?.x).toBe(0); // -> idle bob 10
    expect(resolveSpriteFrame(settler('acting'), b, atlas)?.x).toBe(0); // -> idle bob 10
    expect(resolveSpriteFrame(settler('acting', 24), b, atlas)?.x).toBe(0); // unlisted atomic -> idle
  });

  it('falls back an unlisted atomic to the generic acting frame', () => {
    const frame = resolveSpriteFrame(settler('acting', 99), bindings(FULL), stateAtlas());
    expect(frame?.x).toBe(32); // bob 12 — generic acting, since atomic 99 isn't in byAtomic
  });

  it('treats a stateless settler item as idle (back-compat with the flat scene)', () => {
    const frame = resolveSpriteFrame(settler(), bindings(FULL), stateAtlas());
    expect(frame?.x).toBe(0); // bob 10 — no state field -> idle
  });

  it('a plain-number settler binding draws the same frame for every state (back-compat)', () => {
    const b = bindings(10); // a bare bob id, the old binding shape
    const atlas = stateAtlas();
    expect(resolveSpriteFrame(settler('idle'), b, atlas)?.x).toBe(0);
    expect(resolveSpriteFrame(settler('moving'), b, atlas)?.x).toBe(0);
    expect(resolveSpriteFrame(settler('acting', 24), b, atlas)?.x).toBe(0);
  });
});

describe('resolveSpriteBobId — directional animated binding', () => {
  /** A settler draw item with an explicit facing + the resolver's other inputs. */
  function settler(state: SpriteState, facing?: number, atomicId?: number, elapsed?: number): DrawItem {
    return drawItem('settler', {
      state,
      ...(facing !== undefined ? { facing } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
      ...(elapsed !== undefined ? { elapsed } : {}),
    });
  }
  const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
  const CHOP: DirectionalAnim = { start: 5106, dirs: 8, stride: 15 };
  const STAND: DirectionalAnim = { start: 1988, dirs: 8, stride: 12, frames: 1 };
  // No generic `acting`: CHOP is bound only to the harvest atomic (24), mirroring the real human
  // binding — an unmapped action (a deposit) must fall back to the idle pose, not the woodcut swing.
  const ANIM: SettlerStateBinding = { idle: STAND, moving: WALK, byAtomic: { 24: CHOP } };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('moving: start + facing*stride + tick%stride (the walk cycle for the heading)', () => {
    expect(resolveSpriteBobId(settler('moving', 3), bindings, 5)).toBe(1988 + 3 * 12 + 5);
    expect(resolveSpriteBobId(settler('moving', 0), bindings, 0)).toBe(1988);
  });

  it('wraps the cycle by tick % stride (frame 12 loops back to 0)', () => {
    expect(resolveSpriteBobId(settler('moving', 0), bindings, 12)).toBe(1988); // 12 % 12 == 0
    expect(resolveSpriteBobId(settler('moving', 0), bindings, 13)).toBe(1989);
  });

  it('acting chop (atomic 24) advances on its elapsed clock at a fixed cadence, ignoring tick', () => {
    // frame = start + facing*stride + ((elapsed-1) % cycle): driven by the atomic's OWN elapsed-tick
    // clock (frame 0 on its first tick), NOT the free tick clock — tick=999 must not change it.
    const swing = (elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', 4, 24, elapsed), bindings, 999);
    expect(swing(1)).toBe(5106 + 4 * 15 + 0); // first acting tick -> frame 0 (the swing's start)
    expect(swing(8)).toBe(5106 + 4 * 15 + 7); // seven ticks in -> frame 7, mid-swing
    expect(swing(15)).toBe(5106 + 4 * 15 + 14); // fifteenth tick -> frame 14, the swing's last frame
  });

  it('the chop cadence is the SAME regardless of how long the action runs (constant speed)', () => {
    // The phase is a pure function of elapsed alone — no duration input — so a swing always advances one
    // frame per tick. (The pre-fix bug stretched the swing across each atomic's duration, so a short
    // action replayed the whole swing faster; that is structurally impossible now.)
    const frameAt = (elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', 0, 24, elapsed), bindings, 0);
    expect(frameAt(1)).toBe(5106 + 0); // frame 0
    expect(frameAt(2)).toBe(5106 + 1); // +1 tick == +1 frame, always
    expect(frameAt(16)).toBe(5106 + 0); // elapsed 16 -> (16-1) % 15 == 0: a longer action loops the cycle
  });

  it('phaseStart rotates the loop start so a chop plays windup (9..14) then strike (0..8)', () => {
    // The woodcut loop is 0..8 = strike-down, 9..14 = windup-rise. phaseStart 9 begins on the windup:
    // frame = (9 + (elapsed-1)) % 15, so elapsed 1 -> 9 (windup start), elapsed 15 -> 8 (impact, the end).
    const SWING: DirectionalAnim = { start: 5106, dirs: 8, stride: 15, phaseStart: 9 };
    const b: SpriteBindings = { settler: { idle: STAND, byAtomic: { 24: SWING } }, building: 0, resource: 0 };
    const at = (elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', 4, 24, elapsed), b, 0);
    expect(at(1)).toBe(5106 + 4 * 15 + 9); // first tick -> frame 9 (windup begins, axe rising)
    expect(at(6)).toBe(5106 + 4 * 15 + 14); // -> frame 14 (top of the windup)
    expect(at(7)).toBe(5106 + 4 * 15 + 0); // wraps -> frame 0 (strike begins, axe coming down)
    expect(at(15)).toBe(5106 + 4 * 15 + 8); // -> frame 8 (impact, the strike lands — the final frame)
  });

  it('an acting atomic with no bound animation holds the idle pose (no borrowed swing)', () => {
    // Atomic 23 (a deposit) isn't in byAtomic and there is no generic `acting`, so it falls back to the
    // single-pose idle/STAND — never the woodcut swing replayed at the wrong speed.
    expect(resolveSpriteBobId(settler('acting', 2, 23, 3), bindings, 0)).toBe(1988 + 2 * 12);
  });

  it('idle holds a single planted pose per direction (frames: 1 ignores tick)', () => {
    expect(resolveSpriteBobId(settler('idle', 2), bindings, 99)).toBe(1988 + 2 * 12); // no phase advance
  });

  it('falls back to DEFAULT_FACING when the item carries no facing', () => {
    expect(resolveSpriteBobId(settler('moving'), bindings, 0)).toBe(1988 + DEFAULT_FACING * 12);
  });

  it('wraps an out-of-range / negative facing into 0..dirs', () => {
    expect(resolveSpriteBobId(settler('moving', 8), bindings, 0)).toBe(1988); // 8 % 8 == 0
    expect(resolveSpriteBobId(settler('moving', -1), bindings, 0)).toBe(1988 + 7 * 12); // -> dir 7
  });

  it('a plain-number frame ref still ignores facing + tick (back-compat)', () => {
    const flat: SpriteBindings = { settler: { idle: 1931 }, building: 20, resource: 30 };
    expect(resolveSpriteBobId(settler('idle', 5), flat, 42)).toBe(1931);
  });
});

describe('resolveSpriteBobId — FrameListAnim (explicit per-direction attack layout)', () => {
  function settler(state: SpriteState, facing?: number, atomicId?: number, elapsed?: number): DrawItem {
    return drawItem('settler', {
      state,
      ...(facing !== undefined ? { facing } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
      ...(elapsed !== undefined ? { elapsed } : {}),
    });
  }
  const ATTACK = 81;
  const STAND: DirectionalAnim = { start: 100, dirs: 8, stride: 4, frames: 1 };
  // A swing pool at bob 2000 with DISTINCT per-facing lists (so facing must select the right list), and
  // an authored hold/repeat in dir 1 (frame 5 held) — the layout a uniform stride can't encode.
  const SWING: FrameListAnim = {
    start: 2000,
    frameLists: [
      [0, 2, 4, 6], // dir 0
      [5, 5, 7], // dir 1 — holds frame 5, then a 3-frame list (shorter than dir 0)
    ],
  };
  const ANIM: SettlerStateBinding = { idle: STAND, byAtomic: { [ATTACK]: SWING } };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('draws start + frameLists[facing][elapsed-1] — the facing selects the list, elapsed indexes it', () => {
    const at = (facing: number, elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', facing, ATTACK, elapsed), bindings, 999);
    expect(at(0, 1)).toBe(2000 + 0); // dir 0, frame 0 -> local 0
    expect(at(0, 3)).toBe(2000 + 4); // dir 0, frame 2 -> local 4
    expect(at(1, 1)).toBe(2000 + 5); // dir 1, frame 0 -> local 5 (the held windup)
    expect(at(1, 2)).toBe(2000 + 5); // dir 1, frame 1 -> local 5 again (the authored hold)
    expect(at(1, 3)).toBe(2000 + 7); // dir 1, frame 2 -> local 7
  });

  it('plays ONE-SHOT: past the CHOSEN list end the sprite shows the FIRST entry (the ready stance)', () => {
    // dir 1 is 3 long: elapsed 4 is one past the end — entry 0 (which a wrap ALSO gives; the cases
    // below are the ones where the two contracts diverge).
    expect(resolveSpriteBobId(settler('acting', 1, ATTACK, 4), bindings, 0)).toBe(2000 + 5);
    // dir 0 past its 4-entry end: entry 0 (local 0) — a wrap would give entry 1 (local 2) at elapsed 6
    // and cycle back through the motion (the reported mid-swing freeze/stutter class of bug).
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 6), bindings, 0)).toBe(2000 + 0);
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 60), bindings, 0)).toBe(2000 + 0);
  });

  it('runs on the atomic elapsed clock, not the free tick (a swing is duration-independent)', () => {
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 2), bindings, 12345)).toBe(2000 + 2); // frame 1
  });

  it('wraps a facing beyond the list count into the available directions', () => {
    // Only 2 lists here; facing 3 wraps 3 % 2 == 1 -> dir 1's list.
    expect(resolveSpriteBobId(settler('acting', 3, ATTACK, 1), bindings, 0)).toBe(2000 + 5);
  });

  it('an empty facing list holds the pool start (never a crash / bogus id)', () => {
    const GAPPY: FrameListAnim = { start: 3000, frameLists: [[], [1, 2]] };
    const b: SpriteBindings = {
      settler: { idle: STAND, byAtomic: { [ATTACK]: GAPPY } },
      building: 0,
      resource: 0,
    };
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 5), b, 0)).toBe(3000); // dir 0 is empty -> start
  });
});
