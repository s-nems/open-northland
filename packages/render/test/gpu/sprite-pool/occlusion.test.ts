import type { WorldSnapshot } from '@open-northland/sim';
import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { SelectionGraphics } from '../../../src/gpu/selection/sprite-effect.js';
import { type PoolFrame, SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import { GHOST_ALPHA, type GhostOccluder } from '../../../src/gpu/sprite-pool/occlusion.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { SELECTION_STAMP } from '../../../src/gpu/world-batch/shader.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

/**
 * Occlusion ghosts without a sheet: every entity draws the placeholder marker, whose `pixelHit`
 * answers "no exact answer", so the scan keeps its box verdict - the same fallback a loaded sheet
 * takes where its pixels are unreadable. A cover half a row in front hides the unit's box; the same
 * cover behind it, or one the unit stands before, does not. The frame's static map-object candidates
 * join the same scan: a decoded map's virgin tree draws on the map-object layer, outside the pool's
 * draw list, and its bound pose covers by the same rules.
 */

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
    occlusionGhosts: true,
  };
}

describe('SpritePool - a unit a standing sprite hides shows as an occlusion ghost', () => {
  it('stamps the placeholder of a settler half a row behind a building, at the settler anchor', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)])));
    expect(layer.children.length).toBe(2);
    const ghosts = pool.occlusionGhosts.container;
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
    expect(pool.occlusionGhosts.container.children.length).toBe(0);
    // A second settler walks beside the house: the boxes never touch. The cover in front is a fresh
    // placement, since a resting kind keeps the anchor it first snapped to.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), house(4, 0, 0.4), settler(3, 2, 0)])));
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    pool.destroy();
  });

  it('keeps one stamp across a repeated still frame and moves it with the walking unit', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const ghosted = snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)]);
    pool.reconcile(frame(ghosted));
    pool.reconcile(frame(ghosted));
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    // Half a row further on (a tick later, so the motion track accepts the new anchor), the settler
    // still stands behind the house: same stamp, new anchor.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0.3), house(2, 0, 0.4)])), tick: 1 });
    const ghosts = pool.occlusionGhosts.container;
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
    const ghosts = pool.occlusionGhosts.container;
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
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    // A cart is neither an occluder nor ghosted: the settler's stamp hides while its unit still draws.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0), cart(2, 0, 0.4)])));
    expect(pool.occlusionGhosts.container.children[0]?.alpha).toBe(0);
    // The cart leaves the snapshot: the unit still draws, so its kept stamp stays, hidden.
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0)])));
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    expect(pool.occlusionGhosts.container.children[0]?.alpha).toBe(0);
    // The unit itself stops drawing: its stamp is freed with it.
    pool.reconcile(frame(snapshotOf([cart(2, 0, 0.4)])));
    expect(pool.occlusionGhosts.container.children.length).toBe(0);
    pool.destroy();
  });

  it('ghosts behind a static map-object tree the pool never drew, by its bound pose', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(frame(snapshotOf([settler(1, 0, 0)])));
    // Without the frame's static candidates a virgin tree is invisible to the scan.
    expect(pool.occlusionGhosts.container.children.length).toBe(0);
    const unit = pool.boundsOf(1);
    const depth = pool.depthOf(1);
    if (unit === undefined || depth === undefined) throw new Error('the unit drew no bounds or depth');
    // The map-object layer's bound pose of a virgin tree half a row in front: its crown hangs over
    // the unit's box, and it sorts a step in front of the unit.
    const crown: GhostOccluder = {
      depth: depth + 1,
      bounds: () => ({ minX: unit.minX - 16, minY: unit.minY - 48, maxX: unit.maxX + 16, maxY: unit.maxY }),
      hit: () => true,
    };
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), staticOccluders: [crown] });
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    // Texels that answer a miss keep the unit plain, whatever the pose's box covers: its kept stamp
    // hides, since the unit still draws.
    pool.reconcile({
      ...frame(snapshotOf([settler(1, 0, 0)])),
      staticOccluders: [{ ...crown, hit: () => false }],
    });
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    expect(pool.occlusionGhosts.container.children[0]?.alpha).toBe(0);
    // A tree whose feet stand behind the unit draws before it and covers nothing: the stamp stays hidden.
    pool.reconcile({
      ...frame(snapshotOf([settler(1, 0, 0)])),
      staticOccluders: [{ ...crown, depth: depth - 1 }],
    });
    expect(pool.occlusionGhosts.container.children[0]?.alpha).toBe(0);
    // The cover returns: the same stamp shows again.
    pool.reconcile({ ...frame(snapshotOf([settler(1, 0, 0)])), staticOccluders: [crown] });
    expect(pool.occlusionGhosts.container.children[0]?.alpha).toBe(1);
    pool.destroy();
  });

  it('draws nothing while the setting is off, and clears what it drew when it turns off', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    // The default: the flag absent draws no stamps, whatever the scene hides.
    const covered = snapshotOf([settler(1, 0, 0), house(2, 0, 0.4)]);
    pool.reconcile({ ...frame(covered), occlusionGhosts: undefined });
    expect(pool.occlusionGhosts.container.children.length).toBe(0);
    // Turning it on ghosts the hidden unit; turning it off drops the stamps at once.
    pool.reconcile(frame(covered));
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    pool.reconcile({ ...frame(covered), occlusionGhosts: undefined });
    expect(pool.occlusionGhosts.container.children.length).toBe(0);
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
    expect(pool.occlusionGhosts.container.children.length).toBe(1);
    expect(pool.occlusionGhosts.container.children[0]?.position.x).toBe(pool.anchorOf(1)?.x);
    // A deer in the open draws, and still no stamp: the gate skips it before any probe.
    pool.reconcile({ ...frame(snapshotOf([deer(3, 0.5, 0), house(2, 0, 0.1)])), tick: 1 });
    expect(pool.boundsOf(3)).toBeDefined();
    expect(pool.occlusionGhosts.container.children.length).toBe(0);
    pool.destroy();
    sheet.source.destroy();
  });
});
