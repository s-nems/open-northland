import { Container, Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { VIEW_DETAILS } from '../../../src/data/view-detail.js';
import { PalettedQuad } from '../../../src/gpu/paletted-sprite/index.js';
import { type PoolFrame, SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import { HumanPaletteLut } from '../../../src/gpu/textures/human-palette-lut.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { DEFAULT_SHADOW_STYLE } from '../../../src/gpu/world-batch/shadow-style.js';
import type { SpriteAtlas, SpriteSheet } from '../../../src/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';
import { syntheticHumanLut } from '../../support/human-palettes.js';

/** A detail tier takes the cast shadows off settlers, out of their bands, and leaves the portrait's
 *  subject its own. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const BODY_BOB = 1;
const HUMANS = 2;
const indexed = new TextureSource({ width: 64, height: 64 });
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};

function pool(): { pool: SpritePool; layer: Container } {
  const sheet: SpriteSheet = {
    source: indexed,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: BODY_BOB, resource: 1, building: 1 },
    characters: { byJob: {}, default: { body: { source: indexed, atlas }, binding: { idle: BODY_BOB } } },
    palette: syntheticHumanLut(new Map(), HumanPaletteLut.rowsFor(HUMANS)),
  };
  const layer = new Container();
  return { pool: new SpritePool(layer, new TextureCache(), sheet), layer };
}

const human = (id: number) => entity(id, id, id, { Settler: { tribe: 0 }, Owner: { player: 0 } });
const SNAPSHOT = snapshotOf([human(1), human(2)]);

function frameOf(extra: Partial<PoolFrame> = {}): PoolFrame {
  return {
    snapshot: SNAPSHOT,
    viewport: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
    tick: SNAPSHOT.tick,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 4000,
    screenH: 4000,
    elevation: FLAT,
    alpha: 1,
    shadowStyle: DEFAULT_SHADOW_STYLE,
    ...extra,
  };
}

/** How many shadow silhouettes each drawn human shows, in draw order. */
function shadowsShown(layer: Container): number[] {
  return layer.children.map(
    (child) =>
      (child as Container).children.filter(
        (c) => c instanceof Sprite && !(c instanceof PalettedQuad) && c.visible && c.alpha > 0,
      ).length,
  );
}

describe('the sprite pool under a detail tier', () => {
  it('draws no settler shadow while the tier drops them, and all of them again at full detail', () => {
    const { pool: sprites, layer } = pool();
    sprites.reconcile(frameOf());
    expect(shadowsShown(layer)).toEqual([1, 1]);

    sprites.reconcile(frameOf({ detail: VIEW_DETAILS.reduced }));
    expect(shadowsShown(layer)).toEqual([0, 0]);

    sprites.reconcile(frameOf({ detail: VIEW_DETAILS.full }));
    expect(shadowsShown(layer)).toEqual([1, 1]);
  });

  it('leaves the portrait subject its shadow, and takes it off once the portrait moves on', () => {
    const { pool: sprites, layer } = pool();
    const reduced = { detail: VIEW_DETAILS.reduced };
    sprites.reconcile(frameOf({ ...reduced, portraitRef: 1 }));
    expect(shadowsShown(layer)).toEqual([1, 0]);

    sprites.reconcile(frameOf({ ...reduced, portraitRef: 2 }));
    expect(shadowsShown(layer)).toEqual([0, 1]);

    sprites.reconcile(frameOf(reduced));
    expect(shadowsShown(layer)).toEqual([0, 0]);
  });
});

describe('a plain landscape entity under a detail tier', () => {
  const TREE = 7;
  const bodySource = new TextureSource({ width: 64, height: 64 });
  const shadowSource = new TextureSource({ width: 64, height: 64 });
  // Its own frame objects: the texture cache keys a texture by its frame.
  const shadowAtlas: SpriteAtlas = {
    width: 32,
    height: 32,
    frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 8, offsetX: -8, offsetY: -8 }]]),
  };
  const treeSheet: SpriteSheet = {
    source: bodySource,
    atlas,
    bindings: { settler: BODY_BOB, resource: BODY_BOB, building: BODY_BOB },
    kindLayers: {
      resource: { source: bodySource, atlas, shadow: { source: shadowSource, atlas: shadowAtlas } },
    },
  };
  const forest = snapshotOf([entity(TREE, 3, 3, { Resource: { goodType: 1 } })]);

  /** The tree's layers still in its band, in paint order. */
  function drawnSources(layer: Container): string[] {
    return (layer.children[0] as Container).children
      .filter((c): c is Sprite => c instanceof Sprite && c.visible && c.alpha > 0)
      .map((sprite) => (sprite.texture.source === shadowSource ? 'shadow' : 'body'));
  }

  it('moves the body into the freed slot, takes the spare one out of the band and shows both again', () => {
    const layer = new Container();
    const sprites = new SpritePool(layer, new TextureCache(), treeSheet);
    const frame = (extra: Partial<PoolFrame> = {}) => ({
      ...frameOf(extra),
      snapshot: forest,
      tick: forest.tick,
    });
    sprites.reconcile(frame());
    expect(drawnSources(layer)).toEqual(['shadow', 'body']);

    sprites.reconcile(frame({ detail: VIEW_DETAILS.sparse }));
    expect(drawnSources(layer)).toEqual(['body']);
    expect(sprites.boundsOf(TREE)).toBeDefined();

    sprites.reconcile(frame({ detail: VIEW_DETAILS.full }));
    expect(drawnSources(layer)).toEqual(['shadow', 'body']);
  });
});
