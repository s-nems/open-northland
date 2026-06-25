import { describe, expect, it } from 'vitest';
import type { DrawItem, SpriteState } from '../src/index.js';
import {
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  indexAtlasFrames,
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
