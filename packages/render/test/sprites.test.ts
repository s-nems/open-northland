import { describe, expect, it } from 'vitest';
import type { DrawItem, SpriteState } from '../src/index.js';
import {
  type AtlasManifest,
  DEFAULT_FACING,
  type DirectionalAnim,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  atlasFromManifest,
  indexAtlasFrames,
  resolveSpriteBobId,
  resolveSpriteFrame,
} from '../src/index.js';

/**
 * Unit tests for the PURE half of the atlas-sprite swap — which atlas frame a draw item resolves to.
 * This is the self-verifiable part (a data lookup); binding the rect to a GPU texture + sampling its
 * pixels stays on the Pixi side, deferred to a human. No Pixi, no canvas here.
 */

/** Hand-build a minimal draw item (the fields the resolver reads). */
function item(kind: DrawItem['kind']): DrawItem {
  return { kind, ref: 1, x: 0, y: 0, depth: 0 };
}

/** A tiny atlas: a settler frame (bob 10), a building frame (bob 20), and an empty 0×0 bob (30). */
function atlas(): SpriteAtlas {
  return indexAtlasFrames(64, 64, [
    { bobId: 10, rect: { x: 0, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
    { bobId: 20, rect: { x: 16, y: 0, width: 28, height: 40 }, offsetX: -14, offsetY: -40 },
    { bobId: 30, rect: { x: 0, y: 0, width: 0, height: 0 }, offsetX: 0, offsetY: 0 },
  ]);
}

const BINDINGS: SpriteBindings = { settler: 10, building: 20, resource: 30 };

describe('indexAtlasFrames', () => {
  it('indexes manifest frames by bob id, carrying rect + draw offset', () => {
    const a = atlas();
    expect(a.width).toBe(64);
    expect(a.height).toBe(64);
    expect(a.frames.get(10)).toEqual({ x: 0, y: 0, width: 12, height: 24, offsetX: -6, offsetY: -24 });
    expect(a.frames.get(20)?.width).toBe(28);
    expect(a.frames.has(30)).toBe(true); // the empty bob is still indexed (id-addressable)
  });
});

describe('resolveSpriteFrame', () => {
  it('resolves a bound kind to its atlas frame', () => {
    const frame = resolveSpriteFrame(item('settler'), BINDINGS, atlas());
    expect(frame).toEqual({ x: 0, y: 0, width: 12, height: 24, offsetX: -6, offsetY: -24 });
  });

  it('returns null for a terrain tile (tiles bind by typeId, not these bindings)', () => {
    expect(resolveSpriteFrame(item('tile'), BINDINGS, atlas())).toBeNull();
  });

  it('returns null when the kind has no binding (-> placeholder geometry)', () => {
    const partial = { settler: 10 } as SpriteBindings; // building/resource unbound
    expect(resolveSpriteFrame(item('building'), partial, atlas())).toBeNull();
  });

  it('returns null when the bound bob id is absent from the atlas', () => {
    const missing: SpriteBindings = { settler: 999, building: 20, resource: 30 };
    expect(resolveSpriteFrame(item('settler'), missing, atlas())).toBeNull();
  });

  it('returns null for a 0×0 (empty) bound frame, so the placeholder still draws', () => {
    // resource -> bob 30, which is the 0×0 empty bob.
    expect(resolveSpriteFrame(item('resource'), BINDINGS, atlas())).toBeNull();
  });

  it('resolves a resource to its own (tree) atlas frame — the ls_trees per-kind bind', () => {
    // Mirrors the real resource bind: resource -> a non-empty bob in its OWN atlas (the per-kind tree
    // layer the GPU blits from). Geometry like ls_trees frame 60: a 101×111 tree anchored at its base.
    const treeAtlas = indexAtlasFrames(1024, 4914, [
      { bobId: 60, rect: { x: 1, y: 1, width: 101, height: 111 }, offsetX: -54, offsetY: -100 },
    ]);
    const bindings: SpriteBindings = { settler: 10, building: 20, resource: 60 };
    expect(resolveSpriteFrame(item('resource'), bindings, treeAtlas)).toEqual({
      x: 1,
      y: 1,
      width: 101,
      height: 111,
      offsetX: -54,
      offsetY: -100,
    });
  });

  it('is pure: the same item + tables always resolve to the same frame', () => {
    const a = atlas();
    const first = resolveSpriteFrame(item('building'), BINDINGS, a);
    const second = resolveSpriteFrame(item('building'), BINDINGS, a);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('resolveSpriteFrame — per-state settler binding', () => {
  /** A settler draw item in a given state (+ optional atomic id). */
  function settler(state?: SpriteState, atomicId?: number): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      ...(state !== undefined ? { state } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
    };
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
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state,
      ...(facing !== undefined ? { facing } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
      ...(elapsed !== undefined ? { elapsed } : {}),
    };
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

describe('atlasFromManifest', () => {
  /** A decoded `.atlas.json` shape, including the `type`/`opaque` fields the renderer ignores. */
  const manifest: AtlasManifest = {
    width: 1024,
    height: 7693,
    frames: [
      { bobId: 0, rect: { x: 1, y: 1, width: 20, height: 33 }, offsetX: -11, offsetY: -27 },
      { bobId: 1931, rect: { x: 517, y: 3063, width: 25, height: 35 }, offsetX: -12, offsetY: -27 },
    ],
  };

  it('adapts the on-disk manifest into a frame-indexed SpriteAtlas', () => {
    const atlas = atlasFromManifest(manifest);
    expect(atlas.width).toBe(1024);
    expect(atlas.height).toBe(7693);
    // Frames are keyed by bobId, carrying the rect + draw offset; a non-contiguous id resolves.
    const idle = atlas.frames.get(1931);
    expect(idle).toEqual({ x: 517, y: 3063, width: 25, height: 35, offsetX: -12, offsetY: -27 });
    expect(atlas.frames.get(0)?.width).toBe(20);
    expect(atlas.frames.has(999)).toBe(false);
  });

  it('equals the indexAtlasFrames it wraps (same width/height/frames)', () => {
    const direct = indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
    const wrapped = atlasFromManifest(manifest);
    expect(wrapped.width).toBe(direct.width);
    expect(wrapped.height).toBe(direct.height);
    expect([...wrapped.frames]).toEqual([...direct.frames]);
  });
});
