import { describe, expect, it } from 'vitest';
import { indexAtlasFrames, resolveSpriteFrame } from '../../src/data/sprites/index.js';
import {
  type AtlasManifest,
  atlasFromManifest,
  type SpriteAtlas,
  type SpriteBindings,
} from '../../src/index.js';
import { drawItem } from '../support/fixtures.js';

/**
 * Unit tests for the atlas layer — indexing decoded frames by bob id and resolving a draw item to its
 * atlas frame. The self-verifiable (data-lookup) half; binding the rect to a GPU texture stays a human's.
 */

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
    const frame = resolveSpriteFrame(drawItem('settler'), BINDINGS, atlas());
    expect(frame).toEqual({ x: 0, y: 0, width: 12, height: 24, offsetX: -6, offsetY: -24 });
  });

  it('returns null for a terrain tile (tiles bind by typeId, not these bindings)', () => {
    expect(resolveSpriteFrame(drawItem('tile'), BINDINGS, atlas())).toBeNull();
  });

  it('returns null when the kind has no binding (-> placeholder geometry)', () => {
    const partial = { settler: 10 } as SpriteBindings; // building/resource unbound
    expect(resolveSpriteFrame(drawItem('building'), partial, atlas())).toBeNull();
  });

  it('returns null when the bound bob id is absent from the atlas', () => {
    const missing: SpriteBindings = { settler: 999, building: 20, resource: 30 };
    expect(resolveSpriteFrame(drawItem('settler'), missing, atlas())).toBeNull();
  });

  it('returns null for a 0×0 (empty) bound frame, so the placeholder still draws', () => {
    // resource -> bob 30, which is the 0×0 empty bob.
    expect(resolveSpriteFrame(drawItem('resource'), BINDINGS, atlas())).toBeNull();
  });

  it('resolves a resource to its own (tree) atlas frame — the ls_trees per-kind bind', () => {
    // Mirrors the real resource bind: resource -> a non-empty bob in its OWN atlas (the per-kind tree
    // layer the GPU blits from). Geometry like ls_trees frame 60: a 101×111 tree anchored at its base.
    const treeAtlas = indexAtlasFrames(1024, 4914, [
      { bobId: 60, rect: { x: 1, y: 1, width: 101, height: 111 }, offsetX: -54, offsetY: -100 },
    ]);
    const bindings: SpriteBindings = { settler: 10, building: 20, resource: 60 };
    expect(resolveSpriteFrame(drawItem('resource'), bindings, treeAtlas)).toEqual({
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
    const first = resolveSpriteFrame(drawItem('building'), BINDINGS, a);
    const second = resolveSpriteFrame(drawItem('building'), BINDINGS, a);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
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
