import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../src/index.js';
import { type SpriteAtlas, type SpriteBindings, indexAtlasFrames, resolveSpriteFrame } from '../src/index.js';

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
