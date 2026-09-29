import { Container, Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { PalettedQuad } from '../../src/gpu/paletted-sprite/index.js';
import { palettedLutOf } from '../../src/gpu/pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE, type ShadowStyle } from '../../src/gpu/shadow-style.js';
import { type BindFrame, LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { type PoolFrame, SpritePool, settlerPalette } from '../../src/gpu/sprite-pool/index.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import type { ResolvedLayer } from '../../src/gpu/sprite-pool/resolved-layer.js';
import { type PlayerColourLut, settlerPaletteLutRow } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { DrawItem, SpriteAtlas, SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * A settler binds team-coloured PalettedQuads only when both the indexed characters and the player-colour
 * LUT are loaded. A vehicle's PalettedSprite mesh stays with the browser scenes: it needs a DOM canvas to
 * construct, since Pixi probes fragment precision.
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

  it('draws the silhouette ahead of the body quads, on no quad slot, stamping no bounds', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    // A body layer from an earlier frame: the silhouette must still land first in child order.
    const earlier = new Sprite();
    pe.container.addChild(earlier);

    binder.bind(pe, item, [shadowLayer], bindFrame, 1);

    expect(pe.shadows[0]?.visible).toBe(true);
    expect(pe.container.children[0]).toBe(pe.shadows[0]);
    expect(pe.sprites.length).toBe(0); // the silhouette never consumes a body slot
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

  it('draws the cast under the blob, both ahead of the body quads, only with a style to project by', () => {
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
});

describe('LayerBinder - a paletted character body draws as a batched quad through its LUT', () => {
  const lut: PlayerColourLut = {
    source: new TextureSource({ width: 256, height: 17 }),
    colours: 17,
    playerRows: 16,
    armorTierByGood: new Map(),
    headRow: 16,
  };
  const indexed = new TextureSource({ width: 64, height: 64 });
  const body: ResolvedLayer = {
    source: indexed,
    frame: { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 },
    scale: 2,
    atlasW: 64,
    atlasH: 64,
  };
  const OWNER = 3;
  const item: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, tribe: 0, player: OWNER };
  const head: ResolvedLayer = { ...body, frame: { ...body.frame, y: 32 }, head: true };
  const paletted = () => {
    const pe = createPooled('settler', lut);
    if (!pe.paletted) throw new Error('a LUT must create the paletted variant');
    return pe;
  };
  const quadAt = (pe: ReturnType<typeof paletted>, slot: number): PalettedQuad => {
    const quad = pe.sprites[slot];
    if (!(quad instanceof PalettedQuad)) throw new Error('a character layer must bind a PalettedQuad');
    return quad;
  };

  it("binds each layer on a quad that names the entity's LUT, the body on the owner's row", () => {
    const palettedSheet = { ...sheet, palette: lut };
    const binder = new LayerBinder(new TextureCache(), palettedSheet);
    const pe = paletted();

    binder.bind(pe, item, [body, head], { camera: CAMERA, screenW: 800, screenH: 600 }, 1);

    const [bodyQuad, headQuad] = [quadAt(pe, 0), quadAt(pe, 1)];
    expect(palettedLutOf(bodyQuad.texture)).toBe(lut.source);
    expect(bodyQuad.texture.frame.width).toBe(16);
    expect(bodyQuad.lutRow).toBe(settlerPaletteLutRow(palettedSheet, item));
    expect(bodyQuad.lutRow).not.toBe(0); // the owner's row, not the default one
    expect(headQuad.lutRow).toBe(lut.headRow);
    expect(pe.container.children).toEqual([bodyQuad, headQuad]);
  });

  it('lands the quad origin on the device grid the snapped camera draws on', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = paletted();
    const camera: Camera = { offsetX: 10.3, offsetY: 5.6, scale: 1.5 };
    const resolution = 2;
    pe.motion.drawX = 100.17;
    pe.motion.drawY = 40.41;

    binder.bind(pe, item, [body], { camera, screenW: 800, screenH: 600, snapResolution: resolution }, 1);

    const quad = quadAt(pe, 0);
    // The frame's own draw offset, scaled, is the unsnapped part; the feet anchor itself is snapped.
    const zoom = camera.scale ?? 1;
    const feetX =
      camera.offsetX + zoom * (pe.motion.drawX + quad.position.x - body.frame.offsetX * body.scale);
    const feetY =
      camera.offsetY + zoom * (pe.motion.drawY + quad.position.y - body.frame.offsetY * body.scale);
    expect(feetX * resolution).toBeCloseTo(Math.round(feetX * resolution), 9);
    expect(feetY * resolution).toBeCloseTo(Math.round(feetY * resolution), 9);
  });

  it("snaps the quad to a portrait camera's grid for the inset, then back to the main camera's", () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), {
      ...sheet,
      characters: { byJob: {}, default: { body: { source: indexed, atlas }, binding: { idle: BODY_BOB } } },
      palette: lut,
    });
    const main: Camera = { offsetX: 10.3, offsetY: 5.6, scale: 1.5 };
    const inset: Camera = { offsetX: 3.7, offsetY: 8.2, scale: 2.25 };
    const resolution = 2;
    pool.reconcile({
      ...poolFrame(snapshotOf([entity(1, 0.37, 0.61, { Settler: { tribe: 0 } })])),
      camera: main,
      snapResolution: resolution,
    });
    const container = layer.children[0] as Container;
    const quad = container.children.find((c): c is PalettedQuad => c instanceof PalettedQuad);
    if (quad === undefined) throw new Error('a human settler must bind a PalettedQuad');
    /** The quad's snapped anchor on `camera`, in device px: whole when the snap is right. */
    const anchorDevicePx = (camera: Camera) =>
      (camera.offsetX + (camera.scale ?? 1) * (container.position.x + quad.position.x - quad.offsetX)) *
      resolution;

    let insetPx = Number.NaN;
    pool.portraitPass(
      [],
      { camera: inset, width: 92, height: 92 },
      { camera: main, width: 800, height: 600 },
      () => {
        insetPx = anchorDevicePx(inset);
      },
    );

    expect(insetPx).toBeCloseTo(Math.round(insetPx), 9);
    const mainPx = anchorDevicePx(main);
    expect(mainPx).toBeCloseTo(Math.round(mainPx), 9);
  });
});

describe('LayerBinder - an animal settler is never paletted, even with the LUT loaded', () => {
  // The species atlases are baked recolours: reading them through the player-colour LUT would treat
  // pixel colours as palette indices. The class is decided at creation and rechecked each frame.
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

  const MONSTER_TRIBE = 5;
  const HUMAN_FORM_JOB = 31;
  const ANIMAL_FORM_JOB = 35;
  const monsterSheet: SpriteSheet = {
    ...palettedSheet,
    characters: {
      byJob: {},
      default: { body: { source, atlas }, binding: { idle: BODY_BOB } },
      byTribe: {
        [MONSTER_TRIBE]: {
          byJob: {
            [ANIMAL_FORM_JOB]: { body: { source, atlas }, binding: { idle: BODY_BOB }, indexed: false },
          },
          default: { body: { source, atlas }, binding: { idle: BODY_BOB } },
        },
      },
    },
  };

  it('keeps a monster job with a baked animal body plain', () => {
    const binder = new LayerBinder(new TextureCache(), monsterSheet);
    const monster = (jobType: number): DrawItem => ({ ...item(MONSTER_TRIBE), jobType });
    expect(binder.create('settler', monster(ANIMAL_FORM_JOB)).paletted).toBe(false);
    expect(binder.create('settler', monster(HUMAN_FORM_JOB)).paletted).toBe(true);
    expect(settlerPalette(monsterSheet, monster(ANIMAL_FORM_JOB))).toBeUndefined();
    expect(settlerPalette(monsterSheet, monster(HUMAN_FORM_JOB))).toBe(monsterSheet.palette);
    expect(settlerPalette(palettedSheet, item(ANIMAL_TRIBE))).toBeUndefined();
  });

  it('re-mints a settler whose job moves its look between an indexed and a baked atlas', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), monsterSheet);
    const drawAs = (jobType: number): Container => {
      pool.reconcile(
        poolFrame(snapshotOf([entity(1, 0, 0, { Settler: { tribe: MONSTER_TRIBE, jobType } })])),
      );
      expect(layer.children).toHaveLength(1);
      return layer.children[0] as Container;
    };
    const human = drawAs(HUMAN_FORM_JOB);
    expect(human.children.some((c) => c instanceof PalettedQuad)).toBe(true);
    const animal = drawAs(ANIMAL_FORM_JOB);
    expect(animal).not.toBe(human);
    expect(animal.children.length).toBeGreaterThan(0);
    for (const spr of animal.children) expect(spr).toBeInstanceOf(Sprite);
    const again = drawAs(HUMAN_FORM_JOB);
    expect(again).not.toBe(animal);
    expect(again.children.some((c) => c instanceof PalettedQuad)).toBe(true);
    // An unchanged look keeps its pooled sprites.
    expect(drawAs(HUMAN_FORM_JOB)).toBe(again);
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

describe('LayerBinder - a hero glow binds under the body on the plain player row', () => {
  const ARMOR = 9;
  const PLAYER = 2;
  const lut: PlayerColourLut = {
    source,
    colours: 33,
    playerRows: 16,
    armorTierByGood: new Map([[ARMOR, 1]]),
    headRow: 32,
  };
  const frame = { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 };
  const body: ResolvedLayer = { source, frame, scale: 1 };
  const glow: ResolvedLayer = { source, frame, scale: 1, dx: -6, dy: 0, boundsExempt: true, glow: 0.25 };
  const armored: DrawItem = {
    kind: 'settler',
    ref: 1,
    x: 0,
    y: 0,
    depth: 0,
    tribe: 0,
    player: PLAYER,
    armorGood: ARMOR,
  };
  const bindFrame: BindFrame = { camera: CAMERA, screenW: 800, screenH: 600 };
  const quadAt = (pe: ReturnType<typeof createPooled>, i: number): PalettedQuad => {
    const spr = pe.sprites[i];
    if (!(spr instanceof PalettedQuad)) throw new Error(`slot ${i} must hold a PalettedQuad`);
    return spr;
  };

  it('reads the team row despite armor, fades by its opacity and keeps the body box', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = createPooled('settler', lut);

    binder.bind(pe, armored, [glow, body], bindFrame, 1);

    const halo = quadAt(pe, 0);
    const drawn = quadAt(pe, 1);
    expect([halo.glow, halo.alpha, halo.lutRow]).toEqual([true, 0.25, PLAYER]);
    expect([drawn.glow, drawn.alpha, drawn.lutRow]).toEqual([false, 1, lut.playerRows + PLAYER]);
    expect(pe.bounds.maxX - pe.bounds.minX).toBe(frame.width); // the halo's offset copy is off the box
  });

  it('returns a slot that held a glow copy to a plain body quad', () => {
    const binder = new LayerBinder(new TextureCache(), { ...sheet, palette: lut });
    const pe = createPooled('settler', lut);
    binder.bind(pe, armored, [glow, body], bindFrame, 1);

    binder.bind(pe, armored, [body], bindFrame, 2);

    expect([quadAt(pe, 0).glow, quadAt(pe, 0).alpha]).toEqual([false, 1]);
    expect(pe.sprites[1]?.visible).toBe(false);
  });

  it('draws no glow for a look without the LUT', () => {
    const binder = new LayerBinder(new TextureCache(), sheet);
    const pe = createPooled('settler', undefined);

    binder.bind(pe, armored, [glow, body], bindFrame, 1);

    expect(pe.sprites.filter((s) => s.visible)).toHaveLength(1);
  });
});
