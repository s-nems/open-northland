import { FOG_MODE, FOG_STATE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FogGhostStore } from '../src/data/fog/index.js';
import { collectSpriteScene } from '../src/data/scene/index.js';
import { ONE, type ResourceTypeBinding, resolveResourceDraw, tileToScreen } from '../src/index.js';
import { entity, snapshotOf, fogViewOf as viewOf } from './support/fixtures.js';

// All fixtures sit on even rows, where the stagger is 0 and cell (cx, cy) = (⌊tileX⌋, tileY).
const HOUSE = entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 } });
const TREE = entity(2, 9, 4, { Resource: { goodType: 3 } });
const HOUSE_CELL = '5,4';
const TREE_CELL = '9,4';

describe('FogGhostStore', () => {
  it('captures a static seen on VISIBLE ground and draws it once the cell regresses to EXPLORED', () => {
    const store = new FogGhostStore();
    // While the house is watched it is remembered but not emitted: the live entity draws.
    const seen = store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    expect(seen).toEqual([]);
    // Once the ground regresses the memory draws, frozen at the captured reads.
    const fogged = store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(fogged).toHaveLength(1);
    expect(fogged[0]).toMatchObject({ ref: 1, kind: 'building', typeId: 7, tileX: 5, tileY: 4 });
  });

  it('keeps a DEAD static ghosted until re-sight, then forgets it', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 1));
    const fogged = store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(fogged.map((g) => g.ref)).toEqual([2]);
    expect(store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 3))).toEqual([]);
    expect(store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 4))).toEqual([]);
  });

  it('refreshes a LIVE static on re-sight (the ghost is the LAST-seen state, not the first)', () => {
    const site = (built: number) =>
      entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built, level: 0 }, UnderConstruction: {} });
    const store = new FogGhostStore();
    store.update(snapshotOf([site(0)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([site(ONE / 2)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 2));
    const fogged = store.update(
      snapshotOf([site(ONE / 2)]),
      viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 3),
    );
    expect(fogged[0]?.builtPct).toBe(50);
  });

  it('never draws a memory into UNEXPLORED black, and skips staticRefs (map-object-drawn) entities', () => {
    const store = new FogGhostStore();
    const bothVisible = new Map([
      [HOUSE_CELL, FOG_STATE.VISIBLE],
      [TREE_CELL, FOG_STATE.VISIBLE],
    ]);
    store.update(snapshotOf([HOUSE, TREE]), viewOf(bothVisible, 1), new Set([TREE.id]));
    // The house's ground fell out of the raw mask entirely; the tree's is explored but the tree is
    // static-layer drawn.
    const later = store.update(
      snapshotOf([HOUSE, TREE]),
      viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2),
      new Set([TREE.id]),
    );
    expect(later).toEqual([]);
  });

  it('a RECON map seeds natural resources and chests (never buildings) sight-unseen, once per known-terrain stretch', () => {
    const stump = entity(3, 11, 4, { Stump: { goodType: 3 } });
    const chest = entity(5, 15, 4, { Chest: { kind: 'wooden', contents: 20, gfxIndex: 845 } });
    const store = new FogGhostStore();
    // Nothing is visible, but the known-terrain view still knows where nature is.
    const seeded = store.update(
      snapshotOf([HOUSE, TREE, stump, chest]),
      viewOf(new Map(), 1, FOG_MODE.RECON),
    );
    expect(seeded.map((g) => g.ref).sort()).toEqual([2, 3, 5]);
    expect(seeded.every((g) => g.kind !== 'building')).toBe(true);
    expect(seeded.find((g) => g.ref === 5)).toMatchObject({ kind: 'chest', gfxIndex: 845 });
    // The seed is start-of-stretch knowledge, so a later spawn is not seeded retroactively, and the
    // stretch spans both RECON modes.
    const lateTree = entity(4, 13, 4, { Resource: { goodType: 3 } });
    const next = store.update(
      snapshotOf([HOUSE, TREE, stump, lateTree, chest]),
      viewOf(new Map(), 2, FOG_MODE.RECON_FOG_OF_WAR),
    );
    expect(next.map((g) => g.ref).sort()).toEqual([2, 3, 5]);
    // A CLASSIC map ends the stretch; the next RECON stretch seeds afresh.
    store.update(snapshotOf([HOUSE, TREE, stump, lateTree, chest]), viewOf(new Map(), 3, FOG_MODE.CLASSIC));
    const reseeded = store.update(
      snapshotOf([HOUSE, TREE, stump, lateTree, chest]),
      viewOf(new Map(), 4, FOG_MODE.RECON_FOG_OF_WAR),
    );
    expect(reseeded.map((g) => g.ref).sort()).toEqual([2, 3, 4, 5]);
  });

  it('remembers a goods heap at its last-seen fill, but never a delivery flag or an emptied pile', () => {
    const heap = (fill: number) => entity(6, 17, 4, { Stockpile: { amounts: [[30, fill]] } });
    const flag = entity(7, 19, 4, { Stockpile: { amounts: [] }, DeliveryFlag: {} });
    const empty = entity(8, 21, 4, { Stockpile: { amounts: [[30, 0]] } });
    const cells = new Map([
      ['17,4', FOG_STATE.VISIBLE],
      ['19,4', FOG_STATE.VISIBLE],
      ['21,4', FOG_STATE.VISIBLE],
    ]);
    const store = new FogGhostStore();
    store.update(snapshotOf([heap(3), flag, empty]), viewOf(cells, 1));
    const fogged = store.update(
      snapshotOf([heap(1), flag, empty]),
      viewOf(
        new Map([
          ['17,4', FOG_STATE.EXPLORED],
          ['19,4', FOG_STATE.EXPLORED],
          ['21,4', FOG_STATE.EXPLORED],
        ]),
        2,
      ),
    );
    expect(fogged).toEqual([{ ref: 6, kind: 'stockpile', tileX: 17, tileY: 4, goodType: 30, fill: 3 }]);
    // The memory draws the heap the viewer last saw, not the one the sim holds now.
    const scene = collectSpriteScene(snapshotOf([]), { ghosts: fogged });
    expect(scene.items[0]).toMatchObject({ ref: 6, kind: 'stockpile', ghost: true, goodType: 30, fill: 3 });
    // A RECON map seeds its heaps like its chests.
    const seeded = new FogGhostStore().update(
      snapshotOf([heap(2), flag]),
      viewOf(new Map(), 1, FOG_MODE.RECON_FOG_OF_WAR),
    );
    expect(seeded.map((g) => g.ref)).toEqual([6]);
  });

  it('draws an opened chest by its inert open graphics record', () => {
    const chest = entity(5, 15, 4, { OpenedChest: { gfxIndex: 846 } });
    const scene = collectSpriteScene(snapshotOf([chest]));
    expect(scene.items[0]).toMatchObject({ ref: 5, kind: 'chest', gfxIndex: 846 });
  });

  it('adopt() captures a ref sight-unseen on the next rebuild (the map handover seam)', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 1));
    expect(store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2))).toEqual(
      [],
    ); // never seen by the pool path, so nothing was remembered
    store.adopt(TREE.id);
    const adopted = store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(adopted.map((g) => g.ref)).toEqual([2]);
  });

  it('caches by (generation, mode) and clears on fog off', () => {
    const store = new FogGhostStore();
    const view = viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1);
    const a = store.update(snapshotOf([HOUSE]), view);
    expect(store.update(snapshotOf([HOUSE]), view)).toBe(a); // the same rebuild reuses the array
    const fogged = store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(fogged).toHaveLength(1);
    store.clear();
    expect(store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2))).toEqual(
      [],
    );
  });
});

describe('collectSpriteScene - ghost emission', () => {
  const GHOST = { ref: 9, kind: 'building', tileX: 5, tileY: 4, typeId: 7 } as const;

  it('emits a tagged ghost item for a ref absent from the snapshot, and keeps the ref live', () => {
    const scene = collectSpriteScene(snapshotOf([]), { ghosts: [GHOST] });
    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({ ref: 9, kind: 'building', ghost: true, typeId: 7 });
    // The pooled sprite of a dead but remembered entity must not be destroyed.
    expect(scene.liveRefs.has(9)).toBe(true);
    // An opened chest's memory draws by the record it was seen with.
    const chest = { ref: 10, kind: 'chest', tileX: 7, tileY: 4, gfxIndex: 845 } as const;
    const chestScene = collectSpriteScene(snapshotOf([]), { ghosts: [chest] });
    expect(chestScene.items[0]).toMatchObject({ ref: 10, kind: 'chest', ghost: true, gfxIndex: 845 });
  });

  it('viewport-culls a ghost like a live sprite, but its ref stays in liveRefs', () => {
    const anchor = tileToScreen(GHOST.tileX, GHOST.tileY);
    const elsewhere = {
      minX: anchor.x + 1000,
      maxX: anchor.x + 1100,
      minY: anchor.y,
      maxY: anchor.y + 100,
    };
    const scene = collectSpriteScene(snapshotOf([]), { viewport: elsewhere, ghosts: [GHOST] });
    expect(scene.items).toEqual([]);
    expect(scene.liveRefs.has(9)).toBe(true);
  });

  it('depth-sorts a ghost among live sprites by the same feet-anchor key', () => {
    // The settler is one row south of the ghost.
    const scene = collectSpriteScene(snapshotOf([entity(1, 5, 5, { Settler: { tribe: 0 } })]), {
      ghosts: [GHOST],
    });
    expect(scene.items.map((d) => d.ref)).toEqual([9, 1]);
  });

  it('remembers a deposit ladder shorter than its record, so the ghost draws the last-seen frame', () => {
    // A 4-unit deposit on its last unit, bound to a 5-frame record: the ladders differ, so the resolver
    // rescales, and a ghost that forgot `levels` would skip that and draw a frame lower.
    const GOOD = 3;
    const binding: ResourceTypeBinding = { byGood: { [GOOD]: [10, 20, 30, 40, 50] }, default: 0 };
    const deposit = entity(2, 9, 4, {
      Resource: { goodType: GOOD, remaining: 1 },
      MineDeposit: { initial: 4, levels: 4 },
    });
    const visible = new Map([[TREE_CELL, FOG_STATE.VISIBLE]]);

    const store = new FogGhostStore();
    const live = collectSpriteScene(snapshotOf([deposit]), {}).items[0];
    store.update(snapshotOf([deposit]), viewOf(visible, 1));
    const ghosts = store.update(snapshotOf([deposit]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2));
    const remembered = collectSpriteScene(snapshotOf([]), { ghosts }).items[0];

    if (live === undefined || remembered === undefined) throw new Error('missing draw item');
    // Level 1 of 4 rescales onto 5 frames as ceil(1·5/4) = 2, so bob 20. Pinned, so the pair cannot agree
    // by both falling through to `default`.
    expect(resolveResourceDraw(binding, live)?.bob).toBe(20);
    expect(resolveResourceDraw(binding, remembered)).toEqual(resolveResourceDraw(binding, live));
  });
});
