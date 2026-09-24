import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createPresentationTrack, presentItem } from '../../src/gpu/sprite-pool/present-item.js';
import { resolveLayersInto } from '../../src/gpu/sprite-pool/resolve-layers.js';
import { LayerBuffer } from '../../src/gpu/sprite-pool/resolved-layer.js';
import type { DrawItem, SpriteAtlas, SpriteLayer, SpriteSheet } from '../../src/index.js';
import { resolveLayers } from '../../src/index.js';

/** The pool resolves every drawn entity every frame, so a refill must reuse its list and records. */

const source = {} as TextureSource;
const shadowSource = {} as TextureSource;
const WALK_BOB = 3;
const UNSHADOWED_BOB = 4;
const HEAD_BOB = 3;
const BODY_TOP = -30;
const UNBOUND_TRIBE = 9;

const frameAt = (offsetY: number, height = 30) => ({ x: 0, y: 0, width: 10, height, offsetX: -5, offsetY });
const bodyAtlas: SpriteAtlas = {
  width: 64,
  height: 64,
  frames: new Map([
    [WALK_BOB, frameAt(BODY_TOP)],
    [UNSHADOWED_BOB, frameAt(BODY_TOP)],
  ]),
};
const shadowAtlas: SpriteAtlas = { width: 64, height: 64, frames: new Map([[WALK_BOB, frameAt(-10, 10)]]) };
const head: SpriteLayer = {
  source,
  atlas: { width: 64, height: 64, frames: new Map([[HEAD_BOB, frameAt(-38, 12)]]) },
};

/** A fresh body atlas topping out at `bodyTop`, under the one shared head frame. */
function sheetFor(bodyTop: number): SpriteSheet {
  const atlas: SpriteAtlas = {
    ...bodyAtlas,
    frames: new Map([...bodyAtlas.frames].map(([bob, f]) => [bob, { ...f, offsetY: bodyTop }])),
  };
  return {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 1, resource: 1, building: 1 },
    characters: {
      byJob: {},
      default: {
        body: { source, atlas, shadow: { source: shadowSource, atlas: shadowAtlas } },
        heads: [head],
        binding: { idle: WALK_BOB },
      },
    },
  };
}

const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: { settler: 1, resource: 1, building: 1 },
  characters: {
    byJob: {},
    default: {
      body: { source, atlas: bodyAtlas, shadow: { source: shadowSource, atlas: shadowAtlas } },
      heads: [head],
      binding: { idle: WALK_BOB },
    },
  },
};
const settler: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, state: 'idle' };

describe('layer reuse across frames', () => {
  it('refills one list per presentation track with the same records', () => {
    const track = createPresentationTrack('settler');
    const first = presentItem(track, settler, 10, 0.25, sheet);
    const firstLayers = [...(first ?? [])];
    const second = presentItem(track, settler, 10, 0.75, sheet);
    expect(second).toBe(first);
    expect(firstLayers).toHaveLength(5); // body cast, head cast, twin silhouette, body, head
    expect(second).toEqual(firstLayers);
    for (const [i, layer] of firstLayers.entries()) expect(second?.[i]).toBe(layer);
  });

  it('trims the tail a shorter resolve leaves and keeps working after an empty one', () => {
    const buffer = new LayerBuffer();
    const unshadowed: SpriteSheet = {
      ...sheet,
      characters: {
        byJob: {},
        default: { body: { source, atlas: bodyAtlas }, binding: { idle: UNSHADOWED_BOB } },
      },
    };
    expect(resolveLayersInto(buffer, sheet, settler, 0, 0, 0)).toHaveLength(5);
    const shorter = resolveLayersInto(buffer, unshadowed, settler, 0, 0, 0) ?? [];
    expect(shorter.map((l) => [l.cast ?? false, l.shadow ?? false])).toEqual([
      [true, true],
      [false, false],
    ]);
    // An unbound wildlife tribe draws nothing, which is not the placeholder.
    const wild: SpriteSheet = {
      ...unshadowed,
      characters: {
        byJob: {},
        default: { body: { source, atlas: bodyAtlas }, binding: { idle: WALK_BOB } },
        animals: { byTribe: {}, tribes: new Set([UNBOUND_TRIBE]) },
      },
    };
    expect(resolveLayersInto(buffer, wild, { ...settler, tribe: UNBOUND_TRIBE }, 0, 0, 0)).toEqual([]);
    expect(resolveLayersInto(buffer, sheet, settler, 0, 0, 0)).toHaveLength(5);
  });

  it('rebuilds a remembered record when an input that shaped it differs', () => {
    // The same atlas frames at two art scales.
    const scaled = resolveLayers({ ...sheet, kindScales: { settler: 2 } }, settler, 0) ?? [];
    const native = resolveLayers(sheet, settler, 0) ?? [];
    expect(scaled.map((l) => l.scale)).toEqual([2, 2, 2, 2, 2]);
    expect(native.map((l) => l.scale)).toEqual([1, 1, 1, 1, 1]);
  });

  it('keeps each body its own head cast rows when two bodies share one head frame', () => {
    const headCastRows = (bodyTop: number) =>
      (resolveLayers(sheetFor(bodyTop), settler, 0) ?? []).find((l) => l.castRows !== undefined)?.castRows;
    // The head frame starts at -38, so it clears a body topping out at -30 by 8 rows and at -34 by 4.
    expect(headCastRows(-30)).toBe(8);
    expect(headCastRows(-34)).toBe(4);
    expect(headCastRows(-30)).toBe(8);
  });

  it('rebuilds a remembered record for the same frame under another atlas size or shadow source', () => {
    const building: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 13 };
    const houses = (atlasWidth: number, silhouetteSource: TextureSource): SpriteSheet => ({
      source,
      atlas: { width: 0, height: 0, frames: new Map() },
      bindings: {
        settler: 1,
        resource: 1,
        building: { byType: { 13: { layer: 'houses', bob: WALK_BOB } }, default: WALK_BOB },
      },
      families: {
        houses: {
          source,
          atlas: { ...bodyAtlas, width: atlasWidth },
          shadow: { source: silhouetteSource, atlas: shadowAtlas },
        },
      },
    });
    const read = (sheetUnder: SpriteSheet) =>
      (resolveLayers(sheetUnder, building, 0) ?? []).map((l) => [l.source === shadowSource, l.atlasW]);
    const otherShadowSource = {} as TextureSource;
    // One body frame object and one silhouette frame object behind both sheets.
    expect(read(houses(64, shadowSource))).toEqual([
      [true, undefined],
      [false, 64],
    ]);
    expect(read(houses(128, otherShadowSource))).toEqual([
      [false, undefined],
      [false, 128],
    ]);
  });
});
