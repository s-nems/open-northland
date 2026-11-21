import type { WorldSnapshot } from '@open-northland/sim';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { HumanPaletteBook } from '../../../src/data/palettes/human-palettes.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import {
  GhostOutlineSprite,
  SelectionGraphics,
  type SelectionSprite,
} from '../../../src/gpu/selection/sprite-effect.js';
import { type PoolFrame, SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import {
  GHOST_ALPHA,
  GHOST_FILL_ALPHA,
  GHOST_TINT,
  GHOST_UNDER_RING_FILL_ALPHA,
  type GhostOccluder,
  OCCLUDER_FADE_ALPHA,
} from '../../../src/gpu/sprite-pool/occlusion.js';
import { HumanPaletteLut } from '../../../src/gpu/textures/human-palette-lut.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import {
  SELECTION_COVER,
  SELECTION_GHOST_OUTLINE,
  SELECTION_STAMP,
} from '../../../src/gpu/world-batch/shader.js';
import type { SpriteSheet } from '../../../src/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';
import { flatRamp, syntheticLane, TEST_BASE } from '../../support/human-palettes.js';

/**
 * Occlusion ghosts without a sheet: every entity draws the placeholder marker. A cover half a row in
 * front whose box meets the unit's ghosts it; the same cover behind it, or one the unit stands before,
 * does not. The frame's static map-object candidates join the same scan: a decoded map's virgin tree
 * draws on the map-object layer, outside the pool's draw list, and its bound pose covers by the same
 * rules. Which pixels of a ghost show is the GPU's depth test, which no test here sees.
 */

/** The alphas of the entities drawn into `layer`, most faded first. */
const alphasOf = (layer: Container): number[] => layer.children.map((c) => c.alpha).sort((a, b) => a - b);

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA = { offsetX: 0, offsetY: 0 };
const EVERYTHING = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };

const settler = (id: number, col: number, row: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Settler: { tribe: 0 } });
const house = (id: number, col: number, row: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Building: {} });
const tree = (id: number, col: number, row: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Resource: { goodType: 3 } });
const cart = (id: number, col: number, row: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Vehicle: { tribe: 0 } });
/** A wildlife entity: tribe 7 is a sheet animal tribe in the sheet-with-animals fixture below. */
const deer = (id: number, col: number, row: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Settler: { tribe: 7 } });

/** A sheet whose single frame every kind binds, with one human look and tribe 7 as a bound animal
 *  species: a deer draws like anyone else, so the scan's wildlife gate is what leaves it unghosted. */
function sheetWithAnimals() {
  const source = new TextureSource({ width: 8, height: 8, scaleMode: 'nearest' });
  const atlas = {
    width: 8,
    height: 8,
    frames: new Map([[1, { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 }]]),
  };
  const character = { body: { source, atlas }, binding: { idle: 1 } };
  return {
    source,
    atlas,
    bindings: { settler: 1, building: 1, resource: 1 },
    characters: {
      byJob: {},
      default: character,
      animals: { byTribe: { 7: character }, tribes: new Set([7]) },
    },
  };
}

function frame(snapshot: WorldSnapshot): PoolFrame {
  return {
    snapshot,
    viewport: EVERYTHING,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    occlusionOutline: true,
  };
}

/** A human palette LUT whose player 0 recipes paint the team band (the band the hero glow's colour
 *  step reads) one flat colour, the men's and the women's. */
function teamPaletteLut(
  male: readonly [number, number, number],
  female: readonly [number, number, number] = male,
): HumanPaletteLut {
  const lane = syntheticLane({ men: flatRamp(...male), women: flatRamp(...female) }, [
    { name: 'player_00', patches: [{ band: 10, source: { kind: 'ramp', ramp: 'men' }, weight: 1 }] },
    { name: 'woman_00', patches: [{ band: 10, source: { kind: 'ramp', ramp: 'women' }, weight: 1 }] },
  ]);
  return new HumanPaletteLut(new HumanPaletteBook(lane, TEST_BASE), {
    tierByGood: new Map(),
    soldierJobs: new Set(),
  });
}

/** The animals sheet with a palette LUT, so its settler binds team-coloured PalettedQuads. */
function sheetWithTeamPalette(
  male: readonly [number, number, number],
  female: readonly [number, number, number] = male,
): SpriteSheet {
  const source = new TextureSource({ width: 8, height: 8, scaleMode: 'nearest' });
  const atlas = {
    width: 8,
    height: 8,
    frames: new Map([[1, { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 }]]),
  };
  const character = { body: { source, atlas }, binding: { idle: 1 } };
  return {
    source,
    atlas,
    bindings: { settler: 1, building: 1, resource: 1 },
    characters: {
      byJob: {},
      default: character,
      animals: { byTribe: { 7: character }, tribes: new Set([7]) },
    },
    palette: teamPaletteLut(male, female),
  };
}

/** A settler of `player`: a ghost ring reads its tint off the owner slot. */
const ownedSettler = (id: number, col: number, row: number, player: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Settler: { tribe: 0 }, Owner: { player } });
/** A woman of player 0: her body wears the women's recipe, which paints the team step its own colour. */
const womanSettler = (id: number, col: number, row: number): ReturnType<typeof entity> =>
  entity(id, col, row, { Settler: { tribe: 0 }, Owner: { player: 0 }, Female: { female: true } });

describe('SpritePool - a unit a standing sprite hides shows as an occlusion ghost', () => {
  it('stamps the placeholder of a settler half a row behind a building, at the settler anchor', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)])));
    expect(layer.children.length).toBe(2);
    const ghosts = pool.occlusionGhosts.marks;
    expect(ghosts.children.length).toBe(1);
    const stamp = ghosts.children[0];
    expect(stamp?.alpha).toBe(1);
    // The anchor the settler itself draws at.
    const anchor = pool.anchorOf(1);
    expect(stamp?.position.x).toBe(anchor?.x);
    expect(stamp?.position.y).toBe(anchor?.y);
    // No atlas layers are bound, so the placeholder marker carries the stamp, at the ghost alpha.
    const marker = stamp?.children[0];
    expect(marker).toBeInstanceOf(SelectionGraphics);
    expect((marker as SelectionGraphics).alpha).toBe(GHOST_ALPHA);
    expect((marker as SelectionGraphics).selectionEffect).toBe(SELECTION_STAMP);
    pool.destroy();
  });

  it('leaves a unit plain when the cover stands behind it or clear of its box', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    // The house half a row behind the settler draws before it: nothing stands in front of the unit.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(2, 0, -0.4)])));
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    // A second settler walks beside the house: the boxes never touch. The cover in front is a fresh
    // placement, since a resting kind keeps the anchor it first snapped to.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(4, 0, 0.4), settler(3, 2, 0)])));
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    pool.destroy();
  });

  it('keeps one stamp across a repeated still frame and moves it with the walking unit', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const ghosted = snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)]);
    pool.reconcile(frame(ghosted));
    pool.reconcile(frame(ghosted));
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    // Half a row further on (a tick later, so the motion track accepts the new anchor), the settler
    // still stands behind the house: same stamp, new anchor.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0.3), house(2, 0, 0.4)])), tick: 1 });
    const ghosts = pool.occlusionGhosts.marks;
    expect(ghosts.children.length).toBe(1);
    const anchor = pool.anchorOf(1);
    expect(ghosts.children[0]?.position.x).toBe(anchor?.x);
    expect(ghosts.children[0]?.position.y).toBe(anchor?.y);
    expect(anchor?.y).toBeGreaterThan(0); // the unit drew lower, still behind the house
    pool.destroy();
  });

  it('hides the stamp once the unit steps out in front, and frees it when it stops drawing', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)])));
    const ghosts = pool.occlusionGhosts.marks;
    expect(ghosts.children.length).toBe(1);
    // The settler walks past the house's row: it now draws in front of it. A tick later, so the
    // motion track accepts the new anchor, as the walking-unit spec above does.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0.8), house(2, 0, 0.4)])), tick: 1 });
    expect(ghosts.children.length).toBe(1);
    expect(ghosts.children[0]?.alpha).toBe(0);
    // The settler leaves the view: its stamp goes with it.
    pool.reconcile(frame(snapshotOf([house(2, 0, 0.4)])));
    expect(ghosts.children.length).toBe(0);
    pool.destroy();
  });

  it('ghosts behind a tree and stays plain behind a cart', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), tree(2, 0, 0.3)])));
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    // A cart is neither an occluder nor ghosted: the settler's stamp hides while its unit still draws.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), cart(2, 0, 0.4)])));
    expect(pool.occlusionGhosts.marks.children[0]?.alpha).toBe(0);
    // The cart leaves the snapshot: the unit still draws, so its kept stamp stays, hidden.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0)])));
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    expect(pool.occlusionGhosts.marks.children[0]?.alpha).toBe(0);
    // The unit itself stops drawing: its stamp is freed with it.
    pool.reconcile(frame(snapshotOf([cart(2, 0, 0.4)])));
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    pool.destroy();
  });

  it('ghosts behind a static map-object tree the pool never drew, by its bound pose', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0)])));
    // Without the frame's static candidates a virgin tree is invisible to the scan.
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    const unit = pool.boundsOf(1);
    const depth = pool.depthOf(1);
    if (unit === undefined || depth === undefined) throw new Error('the unit drew no bounds or depth');
    // The map-object layer's bound pose of a virgin tree half a row in front: its crown hangs over
    // the unit's box, and it sorts a step in front of the unit.
    const crown: GhostOccluder = {
      depth: depth + 1,
      bounds: () => ({ minX: unit.minX - 16, minY: unit.minY - 48, maxX: unit.maxX + 16, maxY: unit.maxY }),
      body: () => undefined,
    };
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), staticOccluders: [crown] });
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    // A tree whose feet stand behind the unit draws before it and covers nothing: the kept stamp hides,
    // since the unit still draws.
    pool.reconcile({
      ...frame(snapshotOf([settler(1, 0, 0)])),
      staticOccluders: [{ ...crown, depth: depth - 1 }],
    });
    expect(pool.occlusionGhosts.marks.children[0]?.alpha).toBe(0);
    // The cover returns: the same stamp shows again.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), staticOccluders: [crown] });
    expect(pool.occlusionGhosts.marks.children[0]?.alpha).toBe(1);
    pool.destroy();
  });

  it('copies a cover in front into the clip, nearer than the stamp of the unit it hides', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithAnimals());
    const ghosts = pool.occlusionGhosts;
    // The sheet's single 8 px frame sits at its anchor, so a tenth of a row keeps the boxes together.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(2, 0, 0.1), house(3, 0, -0.1)])));
    // The house behind the unit hides nothing and gets no copy.
    expect(ghosts.covers.children.length).toBe(1);
    const cover = ghosts.covers.children[0]?.children[0] as SelectionSprite;
    expect(cover.selectionEffect).toBe(SELECTION_COVER);
    const mark = ghosts.marks.children[0]?.children[0] as SelectionSprite;
    expect(cover.clipDepth).toBeLessThan(mark.clipDepth);
    // The unit steps out in front: the copy goes at once, the house still in view.
    pool.reconcile({
      ...frame(snapshotOf([settler(1, 0, 0.3), house(2, 0, 0.1), house(3, 0, -0.1)])),
      tick: 1,
    });
    expect(ghosts.covers.children.length).toBe(0);
    pool.destroy();
  });

  it('copies the sprite a static map-object tree draws its pose with', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0)])));
    const unit = pool.boundsOf(1);
    if (unit === undefined) throw new Error('the unit drew no bounds');
    const body = new Sprite(new Texture({ source: new TextureSource({ width: 8, height: 8 }) }));
    body.position.set(unit.minX, unit.minY);
    const crown: GhostOccluder = { depth: 1e9, bounds: () => unit, body: () => body };
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), tick: 1, staticOccluders: [crown] });
    const cover = pool.occlusionGhosts.covers.children[0]?.children[0] as SelectionSprite;
    expect(cover.texture).toBe(body.texture);
    expect([cover.position.x, cover.position.y]).toEqual([unit.minX, unit.minY]);
    pool.destroy();
  });

  it('keeps the occluder grid to the frame occluders while trees are replaced and leave the view', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const ghosts = pool.occlusionGhosts;
    // A tree in front of the settler, replaced by a fresh entity every frame - a felled tree, then its
    // regrowth - must not leave its earlier registrations in the cells the settler probes.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0), tree(100, 0, 0.3)])), tick: 0 });
    const oneTree = ghosts.gridEntries;
    expect(oneTree).toBeGreaterThan(0);
    for (let t = 1; t <= 50; t++) {
      pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0), tree(100 + t, 0, 0.3)])), tick: t });
      expect(ghosts.marks.children[0]?.alpha).toBe(1);
    }
    expect(ghosts.gridEntries).toBe(oneTree);
    // A static candidate minted per frame stays bounded the same way, and leaves with the view.
    const unit = pool.boundsOf(1);
    if (unit === undefined) throw new Error('the unit drew no bounds');
    const crown = (): GhostOccluder => ({ depth: 1e9, bounds: () => unit, body: () => undefined });
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), tick: 51, staticOccluders: [crown()] });
    const oneCrown = ghosts.gridEntries;
    expect(oneCrown).toBeGreaterThan(0);
    for (let t = 52; t <= 60; t++)
      pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), tick: t, staticOccluders: [crown()] });
    expect(ghosts.gridEntries).toBe(oneCrown);
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), tick: 61 });
    expect(ghosts.gridEntries).toBe(0);
    expect(ghosts.marks.children[0]?.alpha).toBe(0);
    pool.destroy();
  });

  it('draws nothing while the setting is off, and clears what it drew when it turns off', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    // The default: the flag absent draws no stamps, whatever the scene hides.
    const covered = snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)]);
    pool.reconcile({ ...frame(covered), occlusionOutline: undefined });
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    // Turning it on ghosts the hidden unit; turning it off drops the stamps at once.
    pool.reconcile(frame(covered));
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    pool.reconcile({ ...frame(covered), occlusionOutline: undefined });
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    pool.destroy();
  });

  it('fades every occluder on the screen while the reveal toggle is on, covered or not', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    // A house and a tree in the open hide nobody; the unit itself is no occluder and stays opaque.
    const open = snapshotOf([settler(1, 0, 0), house(2, 0, -0.4), tree(3, 4, -0.4)]);
    pool.reconcile({ ...frame(open), fadeOccluders: true });
    expect(alphasOf(layer)).toEqual([OCCLUDER_FADE_ALPHA, OCCLUDER_FADE_ALPHA, 1]);
    pool.reconcile({ ...frame(open), tick: 1 });
    expect(alphasOf(layer)).toEqual([1, 1, 1]);
    pool.destroy();
  });

  it('fades every occluder with no unit on screen, and undoes them when the toggle lifts', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const lonely = snapshotOf([house(2, 0, 0), tree(3, 4, 0)]);
    pool.reconcile({ ...frame(lonely), fadeOccluders: true });
    expect(alphasOf(layer)).toEqual([OCCLUDER_FADE_ALPHA, OCCLUDER_FADE_ALPHA]);
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    pool.reconcile({ ...frame(lonely), tick: 1 });
    expect(alphasOf(layer)).toEqual([1, 1]);
    pool.destroy();
  });

  it('fades the covers with both mark settings off, and stamps no ghost', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const covered = snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)]);
    const unmarked = { ...frame(covered), occlusionOutline: false };
    pool.reconcile({ ...unmarked, fadeOccluders: true });
    expect(alphasOf(layer)).toEqual([OCCLUDER_FADE_ALPHA, 1]);
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    pool.reconcile({ ...unmarked, tick: 1 });
    expect(alphasOf(layer)).toEqual([1, 1]);
    pool.destroy();
  });

  it('shows an inset the world without the ghosts and the fades, then puts both back', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const covered = snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)]);
    pool.reconcile({ ...frame(covered), fadeOccluders: true });
    const view = { camera: CAMERA, width: 800, height: 600 };
    let seen: { ghosts: number; world: number[] } | undefined;
    pool.portraitPass([1], view, view, () => {
      seen = { ghosts: pool.occlusionGhosts.container.alpha, world: alphasOf(layer) };
    });
    expect(seen).toEqual({ ghosts: 0, world: [1, 1] });
    expect(pool.occlusionGhosts.container.alpha).toBe(1);
    expect(alphasOf(layer)).toEqual([OCCLUDER_FADE_ALPHA, 1]);
    pool.destroy();
  });

  it('fades a static occluder through its setFade and restores it when the ask lifts', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0)])));
    const unit = pool.boundsOf(1);
    if (unit === undefined) throw new Error('the unit drew no bounds');
    let faded: number | undefined;
    const crown: GhostOccluder = {
      depth: 1e9,
      bounds: () => unit,
      body: () => undefined,
      setFade: (alpha) => {
        faded = alpha;
      },
    };
    pool.reconcile({
      ...frame(snapshotOf([settler(1, 0, 0)])),
      tick: 1,
      staticOccluders: [crown],
      fadeOccluders: true,
    });
    expect(faded).toBe(OCCLUDER_FADE_ALPHA);
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), tick: 2, staticOccluders: [crown] });
    expect(faded).toBe(undefined);
    pool.destroy();
  });

  it('lays the ghost of a bound body as ring quads in the ghost tint, not as filled stamps', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithAnimals());
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0), house(2, 0, 0.1)])), tick: 1 });
    const stamp = pool.occlusionGhosts.marks.children[0];
    expect(stamp?.children.length).toBeGreaterThan(0);
    for (const child of stamp?.children ?? []) {
      expect(child).toBeInstanceOf(GhostOutlineSprite);
      const quad = child as GhostOutlineSprite;
      expect(quad.selectionEffect).toBe(SELECTION_GHOST_OUTLINE);
      expect(quad.tint).toBe(GHOST_TINT);
      expect(quad.alpha).toBe(GHOST_ALPHA);
      // The ring reaches: its grown view past the body and its uv step per unit of reach ride along.
      expect(quad.reachUv.some((step) => step !== 0)).toBe(true);
      expect(quad.bodyTexture).not.toBe(Texture.EMPTY);
      expect(quad.texture.frame.width).toBeGreaterThan(quad.bodyTexture.frame.width);
    }
    pool.destroy();
  });

  it("tints the ring of a ghosted settler with its owner's team colour", () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithTeamPalette([0, 255, 0]));
    pool.reconcile({ ...frame(snapshotOf([ownedSettler(1, 0, 0, 0), house(2, 0, 0.1)])), tick: 1 });
    const stamp = pool.occlusionGhosts.marks.children[0];
    expect(stamp?.children.length).toBeGreaterThan(0);
    for (const child of stamp?.children ?? []) expect(child.tint).toBe(0x00ff00);
    pool.destroy();
  });

  it('keeps a dark team colour as its body wears it, with no legibility lift', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithTeamPalette([255, 0, 0]));
    pool.reconcile({ ...frame(snapshotOf([ownedSettler(1, 0, 0, 0), house(2, 0, 0.1)])), tick: 1 });
    const stamp = pool.occlusionGhosts.marks.children[0];
    expect(stamp?.children.length).toBeGreaterThan(0);
    for (const child of stamp?.children ?? []) expect(child.tint).toBe(0xff0000);
    pool.destroy();
  });

  it("tints a woman's ring with her owner's team colour, not the colour her recipe paints there", () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithTeamPalette([0, 255, 0], [255, 0, 0]));
    pool.reconcile({ ...frame(snapshotOf([womanSettler(1, 0, 0), house(2, 0, 0.1)])), tick: 1 });
    const stamp = pool.occlusionGhosts.marks.children[0];
    expect(stamp?.children.length).toBeGreaterThan(0);
    for (const child of stamp?.children ?? []) expect(child.tint).toBe(0x00ff00);
    pool.destroy();
  });

  it("falls back to the grey base's team step for a player the book lacks", () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithTeamPalette([0, 255, 0]));
    pool.reconcile({ ...frame(snapshotOf([ownedSettler(1, 0, 0, 1), house(2, 0, 0.1)])), tick: 1 });
    const stamp = pool.occlusionGhosts.marks.children[0];
    expect(stamp?.children.length).toBeGreaterThan(0);
    for (const child of stamp?.children ?? []) expect(child.tint).toBe(0xaaaaaa);
    pool.destroy();
  });

  it('leaves a sheet wildlife tribe unghosted where a human ghosts', () => {
    const layer = new Container();
    const sheet = sheetWithAnimals();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    // A human and a deer stand side by side behind the same cover: both draw, only the human ghosts.
    // The cover half a tenth of a row in front puts its frame's box over the units' boxes, since the
    // sheet's single 8 px frame sits at its anchor.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0), deer(3, 0.5, 0), house(2, 0, 0.1)])), tick: 1 });
    expect(pool.boundsOf(1)).toBeDefined();
    expect(pool.boundsOf(3)).toBeDefined();
    expect(pool.occlusionGhosts.marks.children.length).toBe(1);
    expect(pool.occlusionGhosts.marks.children[0]?.position.x).toBe(pool.anchorOf(1)?.x);
    // A deer in the open draws, and still no stamp: the gate skips it before any probe.
    pool.reconcile({ ...frame(snapshotOf([deer(3, 0.5, 0), house(2, 0, 0.1)])), tick: 1 });
    expect(pool.boundsOf(3)).toBeDefined();
    expect(pool.occlusionGhosts.marks.children.length).toBe(0);
    pool.destroy();
    sheet.source.destroy();
  });

  it('stamps the body as fill quads with only the fill setting on, with no ring', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithTeamPalette([0, 255, 0]));
    const covered = snapshotOf([ownedSettler(1, 0, 0, 0), house(2, 0, 0.1)]);
    pool.reconcile({ ...frame(covered), tick: 1, occlusionOutline: false, occlusionFill: true });
    const shown = (pool.occlusionGhosts.marks.children[0]?.children ?? []).filter((c) => c.alpha > 0);
    expect(shown.length).toBeGreaterThan(0);
    for (const child of shown) {
      expect(child).not.toBeInstanceOf(GhostOutlineSprite);
      expect((child as SelectionSprite).selectionEffect).toBe(SELECTION_STAMP);
      expect(child.alpha).toBe(GHOST_FILL_ALPHA);
      expect(child.tint).toBe(0x00ff00);
    }
    pool.destroy();
  });

  it('lays a light fill under the ring with both settings on', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithAnimals());
    pool.reconcile({
      ...frame(snapshotOf([settler(1, 0, 0), house(2, 0, 0.1)])),
      tick: 1,
      occlusionFill: true,
    });
    const children = pool.occlusionGhosts.marks.children[0]?.children ?? [];
    const rings = children.filter((c) => c instanceof GhostOutlineSprite);
    const fills = children.filter((c) => !(c instanceof GhostOutlineSprite));
    expect(rings.length).toBeGreaterThan(0);
    expect(fills.length).toBe(rings.length);
    for (const fill of fills) expect(fill.alpha).toBe(GHOST_UNDER_RING_FILL_ALPHA);
    // Every fill sits under every ring.
    const lastFill = Math.max(...fills.map((c) => children.indexOf(c)));
    const firstRing = Math.min(...rings.map((c) => children.indexOf(c)));
    expect(lastFill).toBeLessThan(firstRing);
    pool.destroy();
  });

  it('hides the fill quads when the fill setting turns off, keeping their textures', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithAnimals());
    const covered = snapshotOf([settler(1, 0, 0), house(2, 0, 0.1)]);
    pool.reconcile({ ...frame(covered), tick: 1, occlusionFill: true });
    const children = pool.occlusionGhosts.marks.children[0]?.children ?? [];
    const fills = children.filter((c): c is SelectionSprite => !(c instanceof GhostOutlineSprite));
    const textures = fills.map((f) => f.texture);
    pool.reconcile({ ...frame(covered), tick: 1, occlusionFill: false });
    for (const [i, fill] of fills.entries()) {
      expect(fill.alpha).toBe(0);
      expect(fill.texture).toBe(textures[i]);
    }
    for (const ring of children.filter((c) => c instanceof GhostOutlineSprite))
      expect(ring.alpha).toBe(GHOST_ALPHA);
    pool.destroy();
  });

  it('hides the rings when the outline setting turns off with fill still on', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheetWithAnimals());
    const covered = snapshotOf([settler(1, 0, 0), house(2, 0, 0.1)]);
    pool.reconcile({ ...frame(covered), tick: 1, occlusionFill: true });
    const children = pool.occlusionGhosts.marks.children[0]?.children ?? [];
    const rings = children.filter((c) => c instanceof GhostOutlineSprite);
    expect(rings.length).toBeGreaterThan(0);
    pool.reconcile({ ...frame(covered), tick: 1, occlusionFill: true, occlusionOutline: false });
    for (const ring of rings) expect(ring.alpha).toBe(0);
    for (const fill of children.filter((c) => !(c instanceof GhostOutlineSprite)))
      expect(fill.alpha).toBe(GHOST_FILL_ALPHA);
    pool.destroy();
  });
});
