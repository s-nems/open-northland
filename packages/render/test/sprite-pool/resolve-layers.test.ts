import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  type DrawItem,
  resolveLayers,
  type SpriteAtlas,
  type SpriteLayer,
  type SpriteSheet,
} from '../../src/index.js';

/** `resolveLayers` is a pure layer decision, so these fake sources are never touched. */
const source = {} as TextureSource;
const shadowSource = {} as TextureSource;

/** An atlas entry at bob `n`, laid out at x=n so an assertion can read `frame.x` back as the bob id. */
const frame = (
  n: number,
): [number, { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number }] => [
  n,
  { x: n, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 },
];

describe('resolveLayers - kinds that bind no atlas layer', () => {
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 100, height: 10, frames: new Map([frame(1)]) },
    bindings: { settler: 1, resource: 1, building: 1 },
  };
  const item = (kind: DrawItem['kind']): DrawItem => ({ kind, ref: 1, x: 0, y: 0, depth: 0 });

  it('draws the placeholder for a terrain tile (tiles bind by landscape typeId)', () => {
    expect(resolveLayers(sheet, item('tile'), 0)).toBeNull();
  });

  it('draws the placeholder for a projectile (no arrow bob is extracted)', () => {
    expect(resolveLayers(sheet, item('projectile'), 0)).toBeNull();
  });
});

describe('resolveLayers - the animated building overlay is bounds-exempt', () => {
  // The `miller` family atlas carries the bladeless body (70), the still blade (76) and one spin
  // frame (85).
  const atlas: SpriteAtlas = { width: 100, height: 10, frames: new Map([frame(70), frame(76), frame(85)]) };
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: {
      settler: 1,
      resource: 1,
      building: {
        byType: { 13: { layer: 'miller', bob: 70 } },
        default: 70,
        overlayByType: { 13: { layer: 'miller', idle: 76, working: [85] } },
      },
    },
    families: { miller: { source, atlas } },
  };
  const mill: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 13 };

  it('marks ONLY the overlay layer boundsExempt (the body still stamps the entity box)', () => {
    const layers = resolveLayers(sheet, mill, 0) ?? [];
    // Only the rotor leaves the bounds union, so the selection ring and the portrait framing read the
    // stable body box while the spin frames breathe.
    expect(layers.map((l) => [l.frame.x, l.boundsExempt ?? false])).toEqual([
      [70, false],
      [76, true],
    ]);
  });
});

describe('resolveLayers - connected palisades', () => {
  const atlas: SpriteAtlas = {
    width: 100,
    height: 10,
    frames: new Map([0, 1, 2, 10, 11, 12, 20, 21, 22, 30].map(frame)),
  };
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: {
      settler: 1,
      resource: 1,
      building: 1,
      palisade: {
        variantOrder: [691, 692, 693],
        byGfxIndex: {
          691: [
            { layer: 'wall', bob: 20 },
            { layer: 'wall', bob: 10 },
            { layer: 'wall', bob: 0 },
          ],
          692: [
            { layer: 'wall', bob: 21 },
            { layer: 'wall', bob: 11 },
            { layer: 'wall', bob: 1 },
          ],
          693: [
            { layer: 'wall', bob: 22 },
            { layer: 'wall', bob: 12 },
            { layer: 'wall', bob: 2 },
          ],
        },
        default: { layer: 'wall', bob: 0 },
      },
      stockpile: { byGood: {}, flag: [{ layer: 'goods', bob: 30 }], default: 30 },
    },
    families: { wall: { source, atlas }, goods: { source, atlas } },
  };

  it('draws the endpoint plus the two one-third posts, cycling source variants', () => {
    const item: DrawItem = {
      kind: 'palisade',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      gfxIndex: 691,
      palisadePosts: [
        { dx: 10, dy: 3, gfxIndex: 691, variantStep: 1 },
        { dx: 20, dy: 6, gfxIndex: 691, variantStep: 2 },
      ],
    };
    expect(
      resolveLayers(sheet, item, 0)?.map((layer) => [layer.frame.x, layer.dx ?? 0, layer.dy ?? 0]),
    ).toEqual([
      [0, 0, 0],
      [1, 10, 3],
      [2, 20, 6],
    ]);
  });

  it('draws only the work flag of a claimed site, and no wall art at an unclaimed or stocked one', () => {
    const site: DrawItem = {
      kind: 'palisade',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      gfxIndex: 691,
      palisadeSite: 'unclaimed',
    };
    expect(resolveLayers(sheet, site, 0)).toEqual([]);
    expect(
      resolveLayers(sheet, { ...site, palisadeSite: 'claimed' }, 0)?.map((layer) => layer.frame.x),
    ).toEqual([30]);
    expect(resolveLayers(sheet, { ...site, palisadeSite: 'stocked' }, 0)).toEqual([]);
  });

  it('uses the edge progress to keep connection posts at the lower construction height', () => {
    const item: DrawItem = {
      kind: 'palisade',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      gfxIndex: 691,
      palisadePosts: [{ dx: 10, dy: 0, gfxIndex: 691, variantStep: 1, builtPct: 10 }],
    };
    expect(resolveLayers(sheet, item, 0)?.map((layer) => layer.frame.x)).toEqual([0, 21]);
  });
});

describe('resolveLayers - construction reveal: per-pixel with time data, crop fallback without', () => {
  const atlas: SpriteAtlas = { width: 100, height: 10, frames: new Map([frame(70), frame(85)]) };
  const times = { width: 100, height: 10, values: new Uint8Array(100 * 10) };
  // The stack reuses the finished body bob (70) as its top stage, as the house family does.
  const building = {
    byType: { 13: { layer: 'houses', bob: 70 } },
    default: 70,
    constructionByType: {
      13: [
        { layer: 'houses', bob: 85, fromPct: 0, toPct: 60 },
        { layer: 'houses', bob: 70, fromPct: 20, toPct: 100 },
      ],
    },
  };
  const site: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 13, builtPct: 30 };
  const sheetWith = (withTimes: boolean): SpriteSheet => ({
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 1, resource: 1, building },
    families: { houses: withTimes ? { source, atlas, times } : { source, atlas } },
  });

  it('with a time sheet, every active stage reveals per-pixel in its own window - the finished bob too', () => {
    const layers = resolveLayers(sheetWith(true), site, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.reveal, l.revealWindow, l.times === times])).toEqual([
      [85, 0.3, [0, 60], true],
      [70, 0.3, [20, 100], true],
    ]);
  });

  it('without one, scaffold stages crop-reveal and the finished bob waits for completion (legacy)', () => {
    const layers = resolveLayers(sheetWith(false), site, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.reveal, l.revealWindow ?? null, l.times ?? null])).toEqual([
      [85, 0.3, null, null],
    ]);
  });
});

describe('resolveLayers - a human character casts its body twin silhouette', () => {
  const bodySource = {} as TextureSource;
  const headSource = {} as TextureSource;
  /** The plain walk gait, the trader's cart-pulling gait, and a bob the twin holds no silhouette for. */
  const WALK_BOB = 3;
  const CART_BOB = 9;
  const UNSHADOWED_BOB = 4;
  const bodyAtlas: SpriteAtlas = {
    width: 64,
    height: 10,
    frames: new Map([frame(WALK_BOB), frame(CART_BOB), frame(UNSHADOWED_BOB)]),
  };
  const shadowAtlas: SpriteAtlas = {
    width: 64,
    height: 10,
    frames: new Map([frame(WALK_BOB), frame(CART_BOB)]),
  };
  const body = { source: bodySource, atlas: bodyAtlas, shadow: { source: shadowSource, atlas: shadowAtlas } };
  const sheetAt = (bob: number, heads?: readonly SpriteLayer[]): SpriteSheet => ({
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 1, resource: 1, building: 1 },
    characters: {
      byJob: {},
      default: { body, binding: { idle: bob }, ...(heads !== undefined ? { heads } : {}) },
    },
  });
  const settler: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, state: 'idle' };
  /** `[bob, from the silhouette twin, shadow, cast, boundsExempt]` per resolved layer. */
  const readLayers = (bob: number, heads?: readonly SpriteLayer[]) =>
    (resolveLayers(sheetAt(bob, heads), settler, 0) ?? []).map((l) => [
      l.frame.x,
      l.source === shadowSource,
      l.shadow ?? false,
      l.cast ?? false,
      l.boundsExempt ?? false,
    ]);

  it('puts the projected body frame under the silhouette, both bounds-exempt and unpickable', () => {
    expect(readLayers(WALK_BOB)).toEqual([
      [WALK_BOB, false, true, true, true],
      [WALK_BOB, true, true, false, true],
      [WALK_BOB, false, false, false, false],
    ]);
  });

  it('shadows a cart-pulling gait from the same twin (the vehicle bobs of the body set)', () => {
    expect(readLayers(CART_BOB)).toEqual([
      [CART_BOB, false, true, true, true],
      [CART_BOB, true, true, false, true],
      [CART_BOB, false, false, false, false],
    ]);
  });

  it('still projects a cast for a bob the twin holds no silhouette for', () => {
    expect(readLayers(UNSHADOWED_BOB)).toEqual([
      [UNSHADOWED_BOB, false, true, true, true],
      [UNSHADOWED_BOB, false, false, false, false],
    ]);
  });

  it('keeps the head overlay above the body, with both silhouettes still at the bottom', () => {
    const head: SpriteLayer = { source: headSource, atlas: bodyAtlas };
    const layers = resolveLayers(sheetAt(WALK_BOB, [head]), settler, 0) ?? [];
    expect(
      layers.map((l) => [
        l.source === shadowSource,
        l.source === bodySource,
        l.cast ?? false,
        l.head ?? false,
      ]),
    ).toEqual([
      [false, true, true, false],
      [true, false, false, false],
      [false, true, false, false],
      [false, false, false, true],
    ]);
  });

  /** A head overlay atlas whose frame starts `above` px over the 10 px body frame's own top row. */
  const headAtlas = (above: number): SpriteAtlas => ({
    width: 64,
    height: 10,
    frames: new Map([[WALK_BOB, { x: WALK_BOB, y: 0, width: 10, height: 10, offsetX: 0, offsetY: -above }]]),
  });
  /** `[cast, castRows, head]` per resolved layer, for a character wearing that head overlay. */
  const readHeadCast = (above: number) =>
    (
      resolveLayers(sheetAt(WALK_BOB, [{ source: headSource, atlas: headAtlas(above) }]), settler, 0) ?? []
    ).map((l) => [l.cast ?? false, l.castRows ?? null, l.head ?? false]);

  it('casts the head overlay as well, cropped to the rows clear of the body frame', () => {
    // The head starts 8 px above the body frame's top row, so its bottom 2 rows project onto ground the
    // body's own cast already darkens and are dropped.
    expect(readHeadCast(8)).toEqual([
      [true, null, false],
      [true, 8, false],
      [false, null, false],
      [false, null, false],
      [false, null, true],
    ]);
  });

  it('casts the whole head frame when it clears the body frame entirely', () => {
    expect(readHeadCast(20)).toEqual([
      [true, null, false],
      [true, 10, false],
      [false, null, false],
      [false, null, false],
      [false, null, true],
    ]);
  });

  it('casts no head at all when the head frame starts inside the body frame', () => {
    expect(readHeadCast(0)).toEqual([
      [true, null, false],
      [false, null, false],
      [false, null, false],
      [false, null, true],
    ]);
  });
});

describe('resolveLayers - wildlife species resolution', () => {
  const animalSource = {} as TextureSource;
  const humanSource = {} as TextureSource;
  const ANIMAL_BOB = 5;
  const HUMAN_BOB = 7;
  const animalAtlas: SpriteAtlas = { width: 64, height: 10, frames: new Map([frame(ANIMAL_BOB)]) };
  const animalShadow = { source: shadowSource, atlas: animalAtlas };
  const humanAtlas: SpriteAtlas = { width: 64, height: 10, frames: new Map([frame(HUMAN_BOB)]) };
  const BOUND_TRIBE = 8;
  const UNBOUND_TRIBE = 35;
  const HUMAN_TRIBE = 1;
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 1, resource: 1, building: 1 },
    characters: {
      byJob: {},
      default: { body: { source: humanSource, atlas: humanAtlas }, binding: { idle: HUMAN_BOB } },
      animals: {
        byTribe: {
          [BOUND_TRIBE]: {
            body: { source: animalSource, atlas: animalAtlas, shadow: animalShadow },
            binding: { idle: ANIMAL_BOB },
          },
        },
        tribes: new Set([BOUND_TRIBE, UNBOUND_TRIBE]),
      },
    },
  };
  const settler = (tribe: number): DrawItem => ({ kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, tribe });

  it('draws a bound animal tribe as its cast, its silhouette and the species body', () => {
    const layers = resolveLayers(sheet, settler(BOUND_TRIBE), 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === shadowSource, l.shadow ?? false])).toEqual([
      [ANIMAL_BOB, false, true],
      [ANIMAL_BOB, true, true],
      [ANIMAL_BOB, false, false],
    ]);
  });

  it('draws a listed-but-unbound animal tribe as nothing, never the human default', () => {
    expect(resolveLayers(sheet, settler(UNBOUND_TRIBE), 0)).toEqual([]);
  });

  it('keeps a human tribe on the character path, atlas size riding for the paletted mesh', () => {
    const layers = resolveLayers(sheet, settler(HUMAN_TRIBE), 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === humanSource, l.cast ?? false, l.atlasW])).toEqual([
      [HUMAN_BOB, true, true, undefined],
      [HUMAN_BOB, true, false, 64],
    ]);
  });

  it('marks only the head overlay as the head layer (it reads the LUT head row, not the team row)', () => {
    const headSource = {} as TextureSource;
    const withHead: SpriteSheet = {
      ...sheet,
      characters: {
        byJob: {},
        default: {
          body: { source: humanSource, atlas: humanAtlas },
          heads: [{ source: headSource, atlas: humanAtlas }],
          binding: { idle: HUMAN_BOB },
        },
      },
    };
    const layers = resolveLayers(withHead, settler(HUMAN_TRIBE), 0) ?? [];
    expect(layers.map((l) => [l.source === headSource, l.head ?? false])).toEqual([
      [false, false],
      [false, false],
      [true, true],
    ]);
  });
});

describe('resolveLayers - the per-tribe civilization looks', () => {
  const vikingSource = {} as TextureSource;
  const frankSource = {} as TextureSource;
  const VIKING_BOB = 3;
  const FRANK_BOB = 4;
  const vikingAtlas: SpriteAtlas = { width: 64, height: 10, frames: new Map([frame(VIKING_BOB)]) };
  const frankAtlas: SpriteAtlas = { width: 64, height: 10, frames: new Map([frame(FRANK_BOB)]) };
  const VIKING = 1;
  const FRANK = 2;
  const EGYPT = 7;
  const viking = { body: { source: vikingSource, atlas: vikingAtlas }, binding: { idle: VIKING_BOB } };
  const frank = { body: { source: frankSource, atlas: frankAtlas }, binding: { idle: FRANK_BOB } };
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 1, resource: 1, building: 1 },
    characters: {
      byJob: {},
      default: viking,
      byTribe: { [VIKING]: { byJob: {}, default: viking }, [FRANK]: { byJob: {}, default: frank } },
    },
  };
  const settler = (tribe?: number): DrawItem => ({
    kind: 'settler',
    ref: 1,
    x: 0,
    y: 0,
    depth: 0,
    ...(tribe !== undefined ? { tribe } : {}),
  });

  /** The body bob each table resolves to; the leading cast layer repeats that same frame. */
  const bodyBob = (tribe?: number) =>
    (resolveLayers(sheet, settler(tribe), 0) ?? []).filter((l) => l.cast !== true).map((l) => l.frame.x);

  it('draws a settler from its own civilization table', () => {
    expect(bodyBob(FRANK)).toEqual([FRANK_BOB]);
    expect(bodyBob(VIKING)).toEqual([VIKING_BOB]);
  });

  it('falls back to the base table for a tribe whose looks were never loaded', () => {
    expect(bodyBob(EGYPT)).toEqual([VIKING_BOB]);
    expect(bodyBob()).toEqual([VIKING_BOB]);
  });
});

describe('resolveLayers - cast shadows draw under the body from the atlas shadow twin', () => {
  const atlas: SpriteAtlas = {
    width: 100,
    height: 10,
    frames: new Map([frame(60), frame(70), frame(85)]),
  };
  // The shadow twin holds a silhouette at the finished bob (70) only, so bob 85 casts none.
  const shadowAtlas: SpriteAtlas = { width: 100, height: 10, frames: new Map([frame(70)]) };
  const shadow = { source: shadowSource, atlas: shadowAtlas };
  const building = {
    byType: { 13: { layer: 'houses', bob: 70 }, 14: { layer: 'houses', bob: 85 } },
    default: 70,
    // The scaffold stage (60) is not any type's finished bob, so the timeless crop-reveal draws it.
    constructionByType: { 13: [{ layer: 'houses', bob: 60, fromPct: 0, toPct: 60 }] },
  };
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 1, resource: 1, building },
    families: { houses: { source, atlas, shadow } },
  };
  const finished: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 13 };

  it('prepends the same-id shadow frame, bounds-exempt, under a finished building body', () => {
    const layers = resolveLayers(sheet, finished, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === shadowSource, l.boundsExempt ?? false])).toEqual([
      [70, true, true],
      [70, false, false],
    ]);
  });

  it('draws only the body when the shadow twin has no frame at the bob id', () => {
    const noShadowBob: DrawItem = { ...finished, typeId: 14 };
    const layers = resolveLayers(sheet, noShadowBob, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === shadowSource])).toEqual([[85, false]]);
  });

  it('keeps the construction stack shadow-less (stage shadows are the shadowBobId lane)', () => {
    const site: DrawItem = { ...finished, builtPct: 30 };
    const layers = resolveLayers(sheet, site, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === shadowSource])).toEqual([[60, false]]);
  });

  it('prepends the shadow on a per-kind layer draw (the tree/resource path)', () => {
    const treeSheet: SpriteSheet = {
      source,
      atlas: { width: 0, height: 0, frames: new Map() },
      bindings: { settler: 1, resource: 70, building: 1 },
      kindLayers: { resource: { source, atlas, shadow } },
    };
    const tree: DrawItem = { kind: 'resource', ref: 1, x: 0, y: 0, depth: 0 };
    const layers = resolveLayers(treeSheet, tree, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === shadowSource, l.boundsExempt ?? false])).toEqual([
      [70, true, true],
      [70, false, false],
    ]);
  });

  it('prepends the pile shadow on a stockpile heap (the `ls_goods_s` silhouettes)', () => {
    const stockSheet: SpriteSheet = {
      source,
      atlas: { width: 0, height: 0, frames: new Map() },
      bindings: {
        settler: 1,
        resource: 1,
        building: 1,
        // The wood heap's bob 70 has a silhouette in the shadow twin; the flag bob (85) casts none.
        stockpile: {
          byGood: { 5: [{ layer: 'goods', bob: 70 }] },
          flag: [{ layer: 'goods', bob: 85 }],
          default: 0,
        },
      },
      families: { goods: { source, atlas, shadow } },
    };
    const pile: DrawItem = { kind: 'stockpile', ref: 1, x: 0, y: 0, depth: 0, goodType: 5, fill: 1 };
    const layers = resolveLayers(stockSheet, pile, 0) ?? [];
    expect(layers.map((l) => [l.frame.x, l.source === shadowSource, l.boundsExempt ?? false])).toEqual([
      [70, true, true],
      [70, false, false],
    ]);
    const empty: DrawItem = { kind: 'stockpile', ref: 2, x: 0, y: 0, depth: 0 };
    const flagLayers = resolveLayers(stockSheet, empty, 0) ?? [];
    expect(flagLayers.map((l) => [l.frame.x, l.source === shadowSource])).toEqual([[85, false]]);
  });
});

describe('complete character appearances', () => {
  const first = {} as TextureSource;
  const second = {} as TextureSource;
  const atlas: SpriteAtlas = { width: 64, height: 10, frames: new Map([frame(1), frame(2)]) };
  const body = { source: first, atlas };
  const sheet: SpriteSheet = {
    source,
    atlas,
    bindings: { settler: 1, resource: 1, building: 1 },
    characters: {
      byJob: {},
      default: {
        body,
        variants: [
          { body, binding: { idle: 1, moving: 1 }, scale: 0.75 },
          { body: { source: second, atlas }, binding: { idle: 1, moving: 2 }, scale: 0.5 },
        ],
        scale: 0.5,
        binding: { idle: 1, moving: 2 },
      },
    },
  };
  const item: DrawItem = { kind: 'settler', ref: 3, x: 0, y: 0, depth: 0, state: 'idle' };
  it('keeps the same appearance through state and animation clock changes', () => {
    expect(resolveLayers(sheet, item, 0)?.[0]?.source).toBe(second);
    const moving = resolveLayers(sheet, { ...item, state: 'moving' }, 30)?.[0];
    expect(moving?.source).toBe(second);
    expect(moving?.frame.x).toBe(2);
    expect(moving?.scale).toBe(0.5);
    const other = resolveLayers(sheet, { ...item, ref: 4, state: 'moving' }, 0)?.[0];
    expect(other?.source).toBe(first);
    expect(other?.frame.x).toBe(1);
    expect(other?.scale).toBe(0.75);
  });
});

describe('resolveLayers - one scale rule for every settler path', () => {
  const KIND_SCALE = 2;
  const OWN_SCALE = 0.5;
  const BOB = 1;
  const WALK_START = 10;
  const WALK_FRAMES = 4;
  const atlas: SpriteAtlas = {
    width: 64,
    height: 10,
    frames: new Map([frame(BOB), ...Array.from({ length: WALK_FRAMES }, (_, i) => frame(WALK_START + i))]),
  };
  const body = { source, atlas };
  const bare: SpriteSheet = {
    source,
    atlas,
    bindings: { settler: BOB, resource: BOB, building: BOB },
    kindScales: { settler: KIND_SCALE },
  };
  const idle: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, state: 'idle' };
  const scales = (sheet: SpriteSheet) => resolveLayers(sheet, idle, 0)?.map((l) => l.scale);

  it('draws a character with no scale of its own at the settler kind scale, its cast included', () => {
    const sheet = { ...bare, characters: { byJob: {}, default: { body, binding: { idle: BOB } } } };
    expect(scales(sheet)).toEqual([KIND_SCALE, KIND_SCALE]);
  });

  it('lets the scale authored with a character win over the kind scale', () => {
    const sheet = {
      ...bare,
      characters: { byJob: {}, default: { body, binding: { idle: BOB }, scale: OWN_SCALE } },
    };
    expect(scales(sheet)).toEqual([OWN_SCALE, OWN_SCALE]);
  });

  it('draws the shared body atlas at the kind scale too', () => {
    expect(scales(bare)).toEqual([KIND_SCALE]);
  });

  it('steps the shared body walk on the gait clock, as a character does', () => {
    const moving = { start: WALK_START, dirs: 1, stride: WALK_FRAMES };
    const sheet = { ...bare, bindings: { ...bare.bindings, settler: { idle: BOB, moving } } };
    const walker: DrawItem = { ...idle, state: 'moving', facing: 0 };
    const FREE_TICK = 0;
    const GAIT_CLOCK = 3;
    expect(resolveLayers(sheet, walker, FREE_TICK, GAIT_CLOCK)?.[0]?.frame.x).toBe(WALK_START + GAIT_CLOCK);
  });
});
