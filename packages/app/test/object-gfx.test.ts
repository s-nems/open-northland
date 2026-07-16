import type { AtlasFrame } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { pairedStateFrames, stateIndexForLevel, unshadedLogicTypeIds } from '../src/content/objects.js';

/**
 * The landscape/object render bindings: the lmlv growth level → GfxFrames state-list index
 * (stateIndexForLevel), the tree full-bright exemption resolved by name (unshadedLogicTypeIds), and
 * the body/shadow frame pairing (pairedStateFrames).
 */

describe('stateIndexForLevel — the lmlv level → GfxFrames state-list index', () => {
  it('counts levels up from the lowest state onto the highest-first lists', () => {
    // A 3-state tree (full-grown, mid, sapling in file order): level 3 = full-grown, level 1 = sapling.
    expect(stateIndexForLevel(3, 3)).toBe(0);
    expect(stateIndexForLevel(2, 3)).toBe(1);
    expect(stateIndexForLevel(1, 3)).toBe(2);
    // A 5-state deposit: level 5 = the full pile (first list), level 1 = the dregs (last).
    expect(stateIndexForLevel(5, 5)).toBe(0);
    expect(stateIndexForLevel(1, 5)).toBe(4);
  });

  it('falls back to the first (full) list for out-of-range levels, incl. the wall intact sentinel', () => {
    expect(stateIndexForLevel(100, 5)).toBe(0);
    expect(stateIndexForLevel(0, 3)).toBe(0);
    expect(stateIndexForLevel(4, 3)).toBe(0);
  });
});

describe('unshadedLogicTypeIds — the tree full-bright exemption resolves by NAME', () => {
  it('collects exactly the tree logic-type ids from the IR landscape table', () => {
    const ids = unshadedLogicTypeIds([
      { typeId: 1, name: 'void' },
      { typeId: 4, name: 'tree' },
      { typeId: 5, name: 'tree falling' },
      { typeId: 6, name: 'trunk' }, // a felled trunk lies ON the ground — shaded like stones
      { typeId: 15, name: 'stones' },
    ]);
    expect([...ids].sort((a, b) => a - b)).toEqual([4, 5]);
  });

  it('is empty for an absent/nameless table (every object then shades — the safe default)', () => {
    expect(unshadedLogicTypeIds(undefined).size).toBe(0);
    expect(unshadedLogicTypeIds([{ typeId: 4 }]).size).toBe(0);
  });
});

describe('pairedStateFrames — body/shadow frames stay index-aligned across 0×0 drops', () => {
  const frame = (n: number, w = 10, h = 10): [number, AtlasFrame] => [
    n,
    { x: n, y: 0, width: w, height: h, offsetX: 0, offsetY: 0 },
  ];
  const atlasOf = (
    frames: [number, AtlasFrame][],
  ): { width: number; height: number; frames: Map<number, AtlasFrame> } => ({
    width: 100,
    height: 10,
    frames: new Map(frames),
  });

  it('keeps a later pose paired with ITS shadow when an earlier 0×0 body frame is dropped', () => {
    // Body ids [1, 2, 3]: bob 1 decodes 0×0 (dropped), bob 3 alone casts a shadow. A naive
    // separate-pass resolve would slide bob 3's silhouette under bob 2.
    const layer = {
      atlas: atlasOf([frame(1, 0, 0), frame(2), frame(3)]),
      shadow: { source: {} as never, atlas: atlasOf([frame(3)]) },
    };
    const paired = pairedStateFrames(layer, [1, 2, 3]);
    expect(paired?.frames.map((f) => f.x)).toEqual([2, 3]);
    expect(paired?.shadowFrames.map((s) => s?.x)).toEqual([undefined, 3]);
  });

  it('drops a 0×0 SHADOW frame to undefined (that pose casts none) and survives a shadow-less layer', () => {
    const layer = {
      atlas: atlasOf([frame(5)]),
      shadow: { source: {} as never, atlas: atlasOf([frame(5, 0, 0)]) },
    };
    expect(pairedStateFrames(layer, [5])?.shadowFrames).toEqual([undefined]);
    expect(pairedStateFrames({ atlas: atlasOf([frame(5)]) }, [5])?.frames.map((f) => f.x)).toEqual([5]);
  });

  it('is null when no body frame survives (the caller falls back to another state)', () => {
    expect(pairedStateFrames({ atlas: atlasOf([frame(9, 0, 0)]) }, [9, 99])).toBeNull();
  });
});
