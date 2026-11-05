import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../../src/data/scene/index.js';
import type { AtlasFrame, SpriteAtlas } from '../../../src/data/sprites/index.js';
import { cullBox, type KindReach, kindReaches } from '../../../src/gpu/sprite-pool/cull-reach.js';
import { resolveLayers } from '../../../src/gpu/sprite-pool/index.js';
import { GLOW_REACH } from '../../../src/gpu/sprite-pool/layers/character.js';
import type { ResolvedLayer } from '../../../src/gpu/sprite-pool/layers/resolved-layer.js';
import { SNAP_DISTANCE } from '../../../src/gpu/sprite-pool/presentation/motion.js';
import { SHADOW_BLUR_PADDING } from '../../../src/gpu/textures/soft-shadow-cache.js';
import type {
  SettlerCharacter,
  SettlerCharacterSet,
  SpriteLayer,
  SpriteSheet,
} from '../../../src/gpu/textures/sprite-sheet.js';
import { drawItem } from '../../support/fixtures.js';

const source = new TextureSource({ width: 64, height: 64 });
const BOB = 1;
const TALL = 200;

function atlasOf(frames: Record<number, Omit<AtlasFrame, 'x' | 'y'>>): SpriteAtlas {
  return {
    width: 256,
    height: 256,
    frames: new Map(Object.entries(frames).map(([bob, frame]) => [Number(bob), { x: 0, y: 0, ...frame }])),
  };
}

/** A 16 px wide frame standing `height` px over its feet. */
const standing = (height: number) => ({ width: 16, height, offsetX: -8, offsetY: -height });

function look(height: number, extra: Partial<SettlerCharacter> = {}): SettlerCharacter {
  return { body: { source, atlas: atlasOf({ [BOB]: standing(height) }) }, binding: { idle: BOB }, ...extra };
}
const SMALL = look(10);

function sheetOf(fields: Partial<SpriteSheet>): SpriteSheet {
  return {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: BOB, resource: 1, building: 1 },
    ...fields,
  };
}

function reachOf(sheet: SpriteSheet, kind: keyof ReturnType<typeof kindReaches>): KindReach {
  const reach = kindReaches(sheet)[kind];
  if (reach === undefined) throw new Error(`no ${kind} reach`);
  return reach;
}

describe('kindReaches - settlers', () => {
  it('counts every look a settler can draw, wherever the look tables hold it', () => {
    const tall = look(TALL);
    const placements: Record<string, SettlerCharacterSet> = {
      'the default look': { byJob: {}, default: tall },
      'a job look': { byJob: { 3: tall }, default: SMALL },
      'a young look': { byJob: {}, youngByJob: { 1: tall }, default: SMALL },
      'a fixed look': { byJob: {}, fixedByJob: { 7: tall }, default: SMALL },
      'a weapon look': { byJob: {}, byWeaponGood: { 40: tall }, default: SMALL },
      'an unarmed look': { byJob: {}, unarmedByJob: { 7: tall }, default: SMALL },
      'a human form': { byJob: {}, default: SMALL, human: { byJob: { 2: tall }, default: SMALL } },
      "another tribe's look": {
        byJob: {},
        default: SMALL,
        byTribe: { 3: { byJob: { 2: tall }, default: SMALL } },
      },
      'an animal': { byJob: {}, default: SMALL, animals: { byTribe: { 9: tall }, tribes: new Set([9]) } },
      'a variant': { byJob: {}, default: look(10, { variants: [tall] }) },
      'a cart driver': { byJob: {}, default: look(10, { cartDriver: tall }) },
      'a head': {
        byJob: {},
        default: look(10, { heads: [{ source, atlas: atlasOf({ [BOB]: standing(TALL) }) }] }),
      },
      'a shadow twin': {
        byJob: {},
        default: look(10, {
          body: {
            source,
            atlas: atlasOf({ [BOB]: standing(10) }),
            shadow: { source, atlas: atlasOf({ [BOB]: standing(TALL) }) },
          },
        }),
      },
    };
    for (const [where, characters] of Object.entries(placements)) {
      // The glow copies body and head; the shadow twin softens by the blur instead.
      const pad = where === 'a shadow twin' ? SHADOW_BLUR_PADDING : GLOW_REACH;
      expect(reachOf(sheetOf({ characters }), 'settler').art.up, where).toBe(TALL + pad);
    }
  });

  it("scales a look's frames by its own scale, else the settler kind's", () => {
    const kindScales = { settler: 3 };
    const own = reachOf(
      sheetOf({ characters: { byJob: {}, default: look(TALL, { scale: 2 }) }, kindScales }),
      'settler',
    );
    const kind = reachOf(sheetOf({ characters: { byJob: {}, default: look(TALL) }, kindScales }), 'settler');
    expect(own.art.up).toBe(2 * (TALL + GLOW_REACH));
    expect(kind.art.up).toBe(3 * (TALL + GLOW_REACH));
  });

  it('gives an interpolating look the snap distance as slack and a tick-anchored one none', () => {
    expect(reachOf(sheetOf({ characters: { byJob: {}, default: SMALL } }), 'settler').slack).toBe(0);
    const smooth = { byJob: {}, default: look(10, { interpolateMotion: true }) };
    expect(reachOf(sheetOf({ characters: smooth }), 'settler').slack).toBe(SNAP_DISTANCE);
  });
});

describe('kindReaches - landscape kinds', () => {
  // The family holds a tall frame no binding names: only the bound frames count.
  const UNBOUND = 9;
  const family = (height: number, shadow?: SpriteLayer['shadow']): SpriteLayer => ({
    source,
    atlas: atlasOf({ [BOB]: standing(height), [UNBOUND]: standing(10 * TALL) }),
    ...(shadow !== undefined ? { shadow } : {}),
  });

  it('counts the frames a resource binding names, its loops and fallback included, not the rest of the family', () => {
    const sheet = sheetOf({
      families: { trees: family(TALL), mines: family(40) },
      bindings: {
        settler: BOB,
        building: 1,
        resource: {
          byGood: { 1: [null, { layer: 'mines', bob: BOB }, { layer: 'trees', frames: [BOB] }] },
          default: { layer: 'mines', bob: BOB },
        },
      },
    });
    expect(reachOf(sheet, 'resource').art.up).toBe(TALL);
  });

  it("reads a bare resource bob, or one whose family is not loaded, off the kind's own layer, else the shared body", () => {
    const kindLayers = { resource: { source, atlas: atlasOf({ [BOB]: standing(TALL) }) } };
    const bare = sheetOf({ kindLayers, bindings: { settler: BOB, building: 1, resource: BOB } });
    const missing = sheetOf({
      kindLayers,
      bindings: {
        settler: BOB,
        building: 1,
        resource: { byGood: {}, default: { layer: 'absent', bob: BOB } },
      },
    });
    const shared = sheetOf({
      atlas: atlasOf({ [BOB]: standing(TALL) }),
      bindings: { settler: BOB, building: 1, resource: BOB },
    });
    expect(reachOf(bare, 'resource').art.up).toBe(TALL);
    expect(reachOf(missing, 'resource').art.up).toBe(TALL);
    expect(reachOf(shared, 'resource').art.up).toBe(TALL);
  });

  it('counts the shadow twin of a bound frame', () => {
    const shadow = { source, atlas: atlasOf({ [BOB]: { width: 300, height: 4, offsetX: 0, offsetY: -4 } }) };
    const sheet = sheetOf({
      families: { trees: family(TALL, shadow) },
      bindings: {
        settler: BOB,
        building: 1,
        resource: { byGood: {}, default: { layer: 'trees', bob: BOB } },
      },
    });
    expect(reachOf(sheet, 'resource').art.right).toBe(300 + SHADOW_BLUR_PADDING);
  });

  it('counts every pile, flag and board frame of stockpiles and signposts, a player recolour included', () => {
    const sheet = sheetOf({
      families: { piles: family(20), flags: family(TALL), posts: family(20), boards: family(TALL) },
      bindings: {
        settler: BOB,
        building: 1,
        resource: 1,
        stockpile: {
          byGood: { 1: [{ layer: 'piles', bob: BOB }] },
          flag: [{ layer: 'flags', bob: BOB }],
          default: { layer: 'piles', bob: BOB },
        },
        signpost: {
          post: { layer: 'posts', bob: BOB },
          boards: [{ layer: 'posts', bob: BOB }],
          byPlayer: [{ post: { layer: 'posts', bob: BOB }, boards: [{ layer: 'boards', bob: BOB }] }],
        },
      },
    });
    expect(reachOf(sheet, 'stockpile').art.up).toBe(TALL);
    expect(reachOf(sheet, 'signpost').art.up).toBe(TALL);
  });

  it('includes the full extent of a player flag', () => {
    const sheet = sheetOf({
      families: { small: family(20), tall: family(TALL) },
      bindings: {
        settler: BOB,
        building: 1,
        resource: 1,
        stockpile: {
          byGood: {},
          flag: [{ layer: 'small', bob: BOB }],
          default: { layer: 'small', bob: BOB },
          flagsByPlayer: { 4: [{ layer: 'tall', bob: BOB }] },
        },
      },
    });
    expect(reachOf(sheet, 'stockpile').art.up).toBe(TALL);
  });

  it('leaves a kind whose art sways to the scene box, since its lean follows the wind', () => {
    const sheet = sheetOf({
      families: { trees: { ...family(TALL), sway: 0.1 } },
      bindings: {
        settler: BOB,
        building: 1,
        resource: { byGood: {}, default: { layer: 'trees', bob: BOB } },
      },
    });
    expect(kindReaches(sheet).resource).toBeUndefined();
  });
});

describe('cullBox', () => {
  const SCREEN = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  const reach = reachOf(sheetOf({ characters: { byJob: {}, default: look(TALL) } }), 'settler');

  it('lets feet below the screen show the art above them, and feet above it only what hangs below', () => {
    const box = cullBox(SCREEN, reach, 0, 1);
    expect(box.maxY - SCREEN.maxY).toBeGreaterThanOrEqual(reach.art.up);
    expect(SCREEN.minY - box.minY).toBeGreaterThanOrEqual(reach.art.down);
    expect(box.maxY - SCREEN.maxY).toBeGreaterThan(SCREEN.minY - box.minY);
  });

  it('widens sideways by a cast shadow sheared over the whole caster height', () => {
    const still = cullBox(SCREEN, reach, 0, 1);
    const cast = cullBox(SCREEN, reach, 0.5, 1);
    const shear = 0.5 * (reach.art.up + reach.art.down);
    expect(still.minX - cast.minX).toBe(shear);
    expect(cast.maxX - still.maxX).toBe(shear);
    expect(cast.maxY).toBe(still.maxY);
  });

  it('keeps the screen-sized marks at their screen size zoomed out, and the rest at world size', () => {
    const margin = (zoom: number) => cullBox(SCREEN, reach, 0, zoom).maxY - SCREEN.maxY - reach.art.up;
    expect(margin(0.5) - margin(1)).toBeCloseTo(reach.screenMarks.up);
    expect(margin(2)).toBe(margin(1));
  });
});

describe('kindReaches - against the resolver', () => {
  /** Every px a resolved layer covers about the feet, a shadow widened by its soft blur. */
  function layerBox(layer: ResolvedLayer): { up: number; down: number; left: number; right: number } {
    const pad = layer.shadow === true && layer.cast !== true ? SHADOW_BLUR_PADDING * layer.scale : 0;
    const x = layer.frame.offsetX * layer.scale + (layer.dx ?? 0);
    const y = layer.frame.offsetY * layer.scale + (layer.dy ?? 0);
    return {
      up: pad - y,
      down: y + layer.frame.height * layer.scale + pad,
      left: pad - x,
      right: x + layer.frame.width * layer.scale + pad,
    };
  }
  const LOOP = [BOB, 2, 3] as const;
  const famOf = (heights: readonly number[]): SpriteLayer => ({
    source,
    atlas: atlasOf(Object.fromEntries(heights.map((h, i) => [i + 1, standing(h)]))),
    shadow: { source, atlas: atlasOf({ [BOB]: { width: 90, height: 6, offsetX: -10, offsetY: -6 } }) },
  });
  const sheet = sheetOf({
    families: {
      trees: famOf([70, 90, 110]),
      piles: famOf([20, 30]),
      flags: famOf([40, 44]),
      posts: famOf([50, 60]),
      stumps: famOf([12]),
    },
    familyScales: { trees: 1.5 },
    kindLayers: { resource: famOf([80]) },
    characters: {
      byJob: { 2: look(64, { scale: 1.2, heads: [{ source, atlas: atlasOf({ [BOB]: standing(80) }) }] }) },
      default: look(48),
    },
    bindings: {
      settler: BOB,
      building: 1,
      resource: {
        byGood: {
          1: [
            { layer: 'trees', frames: LOOP },
            { layer: 'trees', bob: 2 },
          ],
          2: [BOB],
        },
        default: { layer: 'missing', bob: BOB },
      },
      stockpile: {
        byGood: {
          3: [
            { layer: 'piles', bob: BOB },
            { layer: 'piles', bob: 2 },
          ],
        },
        flag: [
          { layer: 'flags', bob: BOB },
          { layer: 'flags', bob: 2 },
        ],
        default: { layer: 'piles', bob: BOB },
      },
      stump: { byGood: { 1: [{ layer: 'stumps', bob: BOB }] }, default: { layer: 'stumps', bob: BOB } },
      signpost: { post: { layer: 'posts', bob: BOB }, boards: [{ layer: 'posts', bob: 2 }] },
    },
  });
  const items: DrawItem[] = [
    drawItem('resource', { goodType: 1, level: 1, levels: 2 }),
    drawItem('resource', { goodType: 1, level: 2, levels: 2 }),
    drawItem('resource', { goodType: 2 }),
    drawItem('resource', { goodType: 9 }),
    drawItem('stockpile', { goodType: 3, fill: 1 }),
    drawItem('stockpile', { goodType: 3, fill: 2 }),
    drawItem('stockpile'),
    drawItem('stump', { goodType: 1 }),
    drawItem('signpost'),
    drawItem('signpost', { boardIndex: 0 }),
    drawItem('settler', { jobType: 2, glow: true }),
    drawItem('settler'),
  ];

  it("holds every layer the resolver draws for a culled kind inside that kind's reach", () => {
    const reaches = kindReaches(sheet);
    for (const item of items) {
      const reach = reaches[item.kind as keyof typeof reaches];
      if (reach === undefined) throw new Error(`no ${item.kind} reach`);
      for (let tick = 0; tick < LOOP.length; tick++) {
        const layers = resolveLayers(sheet, item, tick) ?? [];
        expect(layers.length, `${item.kind} draws`).toBeGreaterThan(0);
        for (const layer of layers) {
          const box = layerBox(layer);
          for (const side of ['up', 'down', 'left', 'right'] as const)
            expect(box[side], `${item.kind} ${side}`).toBeLessThanOrEqual(reach.art[side] + 1e-9);
        }
      }
    }
  });
});
