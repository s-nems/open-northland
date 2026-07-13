import { type ContentSet, IR_VERSION, type LandscapeType, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  isLandLayerType,
  isUniversalLayerType,
  isWaterLayerType,
  landLayerLandscape,
  universalLayerLandscape,
  waterLayerLandscape,
} from '../../src/systems/index.js';

/** Resolve a landscape type by its `id` (throws if absent — a test-fixture programmer error). */
function land(content: ContentSet, id: string): LandscapeType {
  const found = content.landscape.find((t) => t.id === id);
  if (found === undefined) throw new Error(`fixture has no landscape "${id}"`);
  return found;
}

/**
 * The landscape placement-layer read views — `waterLayerLandscape`/`isWaterLayerType` and
 * `universalLayerLandscape`/`isUniversalLayerType` classify the rows out of `content.landscape` *by the
 * data alone* (the `allowedonwater`/`allowedoneverything` flags the original `landscapetypes.ini` carries),
 * never by a hardcoded list. These flags are genuinely extracted (unlike `walkable`/`buildable`, which keep
 * schema defaults), yet had no sim consumer until now.
 *
 * The fixture mirrors the real `landscapetypes.ini` shape: the layer-agnostic `void` (the only
 * `allowedoneverything` type), the three wall/gate structures that span water (`allowedonwater`, also on
 * land), and plain land terrain (`grass`, `tree`) that sits on neither water nor everything. Declared OUT
 * of typeId order so the sort is exercised.
 */
function landscapeContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    landscape: [
      // wall_gate_open (typeId 84) declared first — a water-layer type. Proves the sort, not declaration order.
      { typeId: 84, id: 'wall_gate_open', allowedOnLand: true, allowedOnWater: true, maxValency: 100 },
      { typeId: 30, id: 'grass', allowedOnLand: true }, // plain land — neither water nor everything
      { typeId: 82, id: 'wall', allowedOnLand: true, allowedOnWater: true, maxValency: 100 }, // water layer, after 84 — proves sort puts it first
      { typeId: 1, id: 'void', allowedOnEverything: true, maxValency: 100 }, // the only universal-layer type
      { typeId: 40, id: 'tree', allowedOnLand: true, maxValency: 5 }, // land decor — neither
    ],
  });
}

describe('isWaterLayerType', () => {
  it('is true for a structure that spans water and false for plain land / the universal type', () => {
    const content = landscapeContent();
    expect(isWaterLayerType(land(content, 'wall'))).toBe(true);
    expect(isWaterLayerType(land(content, 'wall_gate_open'))).toBe(true);
    expect(isWaterLayerType(land(content, 'grass'))).toBe(false); // land only
    expect(isWaterLayerType(land(content, 'tree'))).toBe(false);
    expect(isWaterLayerType(land(content, 'void'))).toBe(false); // everything ≠ water
  });
});

describe('waterLayerLandscape', () => {
  it('returns only the water-layer types', () => {
    const ids = waterLayerLandscape(landscapeContent()).map((t) => t.id);
    expect(ids).toEqual(['wall', 'wall_gate_open']); // land/decor/void excluded
  });

  it('sorts ascending by typeId regardless of declaration order', () => {
    // Declared wall_gate_open(84) before wall(82); the view must still put wall first.
    const typeIds = waterLayerLandscape(landscapeContent()).map((t) => t.typeId);
    expect(typeIds).toEqual([82, 84]);
  });

  it('is empty when no type carries the water flag (a land-only set)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      landscape: [{ typeId: 30, id: 'grass', allowedOnLand: true }],
    });
    expect(waterLayerLandscape(content)).toEqual([]);
  });
});

describe('isUniversalLayerType', () => {
  it('is true only for the `allowedoneverything` type', () => {
    const content = landscapeContent();
    expect(isUniversalLayerType(land(content, 'void'))).toBe(true);
    expect(isUniversalLayerType(land(content, 'wall'))).toBe(false); // land+water ≠ everything
    expect(isUniversalLayerType(land(content, 'grass'))).toBe(false);
  });
});

describe('universalLayerLandscape', () => {
  it('returns only the universal-layer type', () => {
    const ids = universalLayerLandscape(landscapeContent()).map((t) => t.id);
    expect(ids).toEqual(['void']);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = landscapeContent();
    expect(universalLayerLandscape(content)).toEqual(universalLayerLandscape(content));
  });
});

describe('isLandLayerType', () => {
  it('is true for terrain/decor/structures on land and false for the layer-agnostic void', () => {
    const content = landscapeContent();
    expect(isLandLayerType(land(content, 'grass'))).toBe(true);
    expect(isLandLayerType(land(content, 'tree'))).toBe(true);
    expect(isLandLayerType(land(content, 'wall'))).toBe(true); // a water structure is also on land
    expect(isLandLayerType(land(content, 'wall_gate_open'))).toBe(true);
    expect(isLandLayerType(land(content, 'void'))).toBe(false); // everything ≠ land (the lone exception)
  });
});

describe('landLayerLandscape', () => {
  it('returns every land-layer type and excludes the void, sorted by typeId', () => {
    // Mirrors the real IR shape: every row but `void` carries allowedonland (86/87 there).
    const typeIds = landLayerLandscape(landscapeContent()).map((t) => t.typeId);
    expect(typeIds).toEqual([30, 40, 82, 84]); // grass, tree, wall, wall_gate_open — void(1) excluded
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = landscapeContent();
    expect(landLayerLandscape(content)).toEqual(landLayerLandscape(content));
  });
});
