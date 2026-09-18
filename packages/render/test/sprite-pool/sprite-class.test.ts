import { Container, Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { type BindFrame, LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import type { ResolvedLayer } from '../../src/gpu/sprite-pool/resolved-layer.js';
import type { PlayerColourLut } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import {
  DEFAULT_SHADOW_STYLE,
  type DrawItem,
  type ShadowStyle,
  type SpriteAtlas,
  type SpriteSheet,
} from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * A settler binds team-coloured PalettedSprite meshes only when both the indexed characters and the
 * player-colour LUT are loaded. The mesh half stays with the browser scenes: a PalettedSprite needs a DOM
 * canvas to construct, since Pixi probes fragment precision.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const source = new TextureSource({ width: 64, height: 64 });

const BODY_BOB = 1;
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};
/** A one-character sheet without a palette LUT: every job resolves to the same body at idle. */
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: { settler: BODY_BOB, resource: 1, building: 1 },
  characters: { byJob: {}, default: { body: { source, atlas }, binding: { idle: BODY_BOB } } },
};

function poolFrame(snapshot: ReturnType<typeof snapshotOf>, shadowStyle?: ShadowStyle): PoolFrame {
  return {
    snapshot,
    viewport: VIEW_ALL,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    shadowStyle,
  };
}

describe('SpritePool - the sprite-class decision without a LUT', () => {
  it('binds a character settler as plain Sprites and stamps its drawn bounds', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    pool.reconcile(poolFrame(snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })])));

    const container = layer.children[0] as Container;
    const sprites = container.children;
    expect(sprites.length).toBeGreaterThan(0); // the character body bound, not the placeholder
    for (const spr of sprites) expect(spr).toBeInstanceOf(Sprite);
    const bounds = pool.boundsOf(1);
    if (bounds === undefined) throw new Error('a drawn settler must stamp bounds');
    expect(bounds.maxY - bounds.minY).toBe(32); // the body frame's rect, feet-anchored
  });
});

describe('SpritePool - a plain character shadow draws under the body without moving its box', () => {
  // The silhouette is wider and shorter than the body, as the decoded `_s` twins are, so a box that
  // counted it would be unmistakable - and the picker's box is what a click on the shadow would hit.
  const SHADOW_WIDTH = 40;
  const shadowAtlas: SpriteAtlas = {
    width: 64,
    height: 16,
    frames: new Map([
      [BODY_BOB, { x: 0, y: 0, width: SHADOW_WIDTH, height: 12, offsetX: -20, offsetY: -12 }],
    ]),
  };
  const shadowed: SpriteSheet = {
    ...sheet,
    characters: {
      byJob: {},
      default: {
        body: { source, atlas, shadow: { source, atlas: shadowAtlas } },
        binding: { idle: BODY_BOB },
      },
    },
  };

  it('binds both layers and stamps the body rect alone', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), shadowed);

    pool.reconcile(poolFrame(snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })])));

    const container = layer.children[0] as Container;
    expect(container.children.filter((c) => c.visible).length).toBe(2);
    const bounds = pool.boundsOf(1);
    if (bounds === undefined) throw new Error('a drawn settler must stamp bounds');
    expect(bounds.maxX - bounds.minX).toBe(16); // the body frame's width, not the silhouette's
    expect(bounds.maxY - bounds.minY).toBe(32);
  });

  it('adds the projected cast under both, out of the pixel picker and off the box', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), shadowed);

    pool.reconcile(poolFrame(snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })]), DEFAULT_SHADOW_STYLE));

    const container = layer.children[0] as Container;
    expect(container.children.filter((c) => c.visible).length).toBe(3);
    const bounds = pool.boundsOf(1);
    if (bounds === undefined) throw new Error('a drawn settler must stamp bounds');
    expect(bounds.maxX - bounds.minX).toBe(16); // still the body rect: both silhouettes are exempt
    expect(bounds.maxY - bounds.minY).toBe(32);
  });
});

describe('LayerBinder - a paletted character binds its silhouette on a plain sprite of its own', () => {
  // The LUT meshes need a DOM canvas, so this binds a shadow-only layer list: the silhouette path the
  // character resolver puts first, without the body mesh that follows it in a real frame.
  const lut: PlayerColourLut = {
    source,
    colours: 17,
    playerRows: 16,
    armorTierByGood: new Map(),
    headRow: 16,
  };
  const shadowSource = new TextureSource({ width: 64, height: 64 });
  const shadowLayer: ResolvedLayer = {
    source: shadowSource,
    frame: { x: 0, y: 0, width: 20, height: 8, offsetX: -10, offsetY: -6 },
    scale: 1,
    boundsExempt: true,
    shadow: true,
  };
  const bodySource = new TextureSource({ width: 64, height: 64 });
  /** The projected twin of the drawn body frame, which the character resolver puts under the blob. */
  const castLayer: ResolvedLayer = {
    source: bodySource,
    frame: { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 },
    scale: 1,
    boundsExempt: true,
    shadow: true,
    cast: true,
  };
  const item: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, tribe: 0 };
  const bindFrame: BindFrame = { camera: CAMERA, screenW: 800, screenH: 600 };
  const paletted = () => {
    const pe = createPooled('settler', lut);
    if (!pe.paletted) throw new Error('a LUT must create the paletted variant');
    return pe;
  };

  it('draws the silhouette ahead of the meshes, on no mesh slot, stamping no bounds', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    // A mesh from an earlier frame: the silhouette must still land first in child order.
    const earlier = new Sprite();
    pe.container.addChild(earlier);

    binder.bind(pe, item, [shadowLayer], bindFrame, 1);

    expect(pe.shadows[0]?.visible).toBe(true);
    expect(pe.container.children[0]).toBe(pe.shadows[0]);
    expect(pe.sprites.length).toBe(0); // the silhouette never consumes a mesh slot
    expect(pe.shadows[0]?.texture.source).toBe(shadowSource);
    expect(pe.boundsFrame).toBe(-1); // bounds-exempt and alone, so nothing is pickable
    expect(pe.container.children[1]).toBe(earlier);
  });

  it('hides the silhouette on a later frame whose bob has none', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    binder.bind(pe, item, [shadowLayer], bindFrame, 1);
    const spr = pe.shadows[0];

    binder.bind(pe, item, [], bindFrame, 2);

    expect(pe.shadows[0]).toBe(spr); // retained, not re-minted
    expect(spr?.visible).toBe(false);
  });

  it('hides the silhouette behind the placeholder when the entity resolves no layers at all', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    binder.bind(pe, item, [shadowLayer], bindFrame, 1);

    binder.bind(pe, item, null, bindFrame, 2);

    expect(pe.shadows[0]?.visible).toBe(false);
    expect(pe.placeholder?.visible).toBe(true);
  });

  it('draws the cast under the blob, both ahead of the meshes, only with a style to project by', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    const layers = [castLayer, shadowLayer];

    binder.bind(pe, item, layers, bindFrame, 1);
    expect(pe.shadows.length).toBe(1); // no style: the cast never reaches a sprite
    expect(pe.shadows[0]?.texture.source).toBe(shadowSource);

    binder.bind(pe, item, layers, { ...bindFrame, shadowStyle: DEFAULT_SHADOW_STYLE }, 2);
    expect(pe.shadows.map((s) => s.texture.source)).toEqual([bodySource, shadowSource]);
    expect(pe.container.children.slice(0, 2)).toEqual([pe.shadows[0], pe.shadows[1]]);
  });

  /** The head overlay's cast, cropped to the rows above `castLayer`'s own top row, as the character
   *  resolver crops it. */
  const HEAD_FRAME = { x: 0, y: 32, width: 14, height: 22, offsetX: -7, offsetY: -41 };
  const HEAD_ROWS = castLayer.frame.offsetY - HEAD_FRAME.offsetY;
  const headCast = (scale: number): ResolvedLayer => ({
    source: bodySource,
    frame: HEAD_FRAME,
    scale,
    boundsExempt: true,
    shadow: true,
    cast: true,
    castRows: HEAD_ROWS,
  });

  it('crops a head cast to its own row count while the body cast keeps the whole frame', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();

    binder.bind(pe, item, [castLayer, headCast(1)], { ...bindFrame, shadowStyle: DEFAULT_SHADOW_STYLE }, 1);

    expect(pe.shadows.map((spr) => spr.texture.frame.height)).toEqual([32, HEAD_ROWS]);
    // The kept rows are the top ones, so the head cast still hangs off the head frame's own anchor.
    expect(pe.shadows[1]?.texture.frame.y).toBe(HEAD_FRAME.y);
  });

  it.each([1, 2])('meets the head cast bottom to the body cast top at scale %i', (scale) => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    const body = { ...castLayer, scale };

    binder.bind(pe, item, [body, headCast(scale)], { ...bindFrame, shadowStyle: DEFAULT_SHADOW_STYLE }, 1);

    const [bodyCast, head] = pe.shadows;
    if (bodyCast === undefined || head === undefined) throw new Error('both casts must bind');
    bodyCast.updateLocalTransform();
    head.updateLocalTransform();
    // The crop takes the head frame's own top rows, so the drawn rows are the ones above the body frame.
    expect(head.texture.frame.y).toBe(HEAD_FRAME.y);
    // The whole point of it: the head's last projected row sits exactly on the body's first, from the rows
    // actually bound, so the two silhouettes neither gap nor overlap.
    const drawnRows = head.texture.frame.height;
    const headBottom = head.position.y + drawnRows * scale * DEFAULT_SHADOW_STYLE.castFlatten;
    expect(headBottom).toBeCloseTo(bodyCast.position.y);
    // Columns shear by height alone, so the seam row lands at the same x in both.
    expect(head.localTransform.c).toBeCloseTo(bodyCast.localTransform.c);
  });

  it('hides the authored blob in cast-only mode and keeps the projection', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    const castOnly = { ...DEFAULT_SHADOW_STYLE, blob: false };

    binder.bind(pe, item, [castLayer, shadowLayer], { ...bindFrame, shadowStyle: castOnly }, 1);

    expect(pe.shadows.length).toBe(1);
    expect(pe.shadows[0]?.texture.source).toBe(bodySource);
  });
});

describe('LayerBinder - an animal settler is never paletted, even with the LUT loaded', () => {
  // The species atlases are baked recolours: reading them through the player-colour LUT would treat
  // pixel colours as palette indices. The class is decided once at creation, so the guard lives there.
  const ANIMAL_TRIBE = 8;
  const palettedSheet: SpriteSheet = {
    ...sheet,
    characters: {
      byJob: {},
      default: { body: { source, atlas }, binding: { idle: BODY_BOB } },
      animals: {
        byTribe: { [ANIMAL_TRIBE]: { body: { source, atlas }, binding: { idle: BODY_BOB } } },
        tribes: new Set([ANIMAL_TRIBE]),
      },
    },
    palette: { source, colours: 17, playerRows: 16, armorTierByGood: new Map(), headRow: 16 },
  };
  const item = (tribe: number): DrawItem => ({ kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, tribe });

  it('creates a human settler paletted and an animal settler plain', () => {
    const binder = new LayerBinder(new TextureCache(), palettedSheet);
    expect(binder.create('settler', item(0)).paletted).toBe(true);
    expect(binder.create('settler', item(ANIMAL_TRIBE)).paletted).toBe(false);
  });

  it('binds a drawn animal through plain Sprites end-to-end while the LUT is loaded', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), palettedSheet);
    pool.reconcile(poolFrame(snapshotOf([entity(1, 0, 0, { Settler: { tribe: ANIMAL_TRIBE } })])));
    const container = layer.children[0] as Container;
    expect(container.children.length).toBeGreaterThan(0);
    for (const spr of container.children) expect(spr).toBeInstanceOf(Sprite);
  });
});
