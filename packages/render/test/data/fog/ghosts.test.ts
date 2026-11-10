import { FOG_MODE, FOG_STATE, fogViewOfMask, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { startBuildingGhosts } from '../../../src/data/fog/ghosts.js';
import { FogGhostStore } from '../../../src/data/fog/index.js';
import { fogCellOfTile } from '../../../src/data/fog/mask.js';
import { isVisible } from '../../../src/data/projection/index.js';
import { collectSpriteScene, type SpriteDrawItem } from '../../../src/data/scene/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { SpriteSceneCache } from '../../../src/gpu/sprite-pool/scene-cache.js';
import { ONE, type ResourceTypeBinding, resolveResourceDraw, tileToScreen } from '../../../src/index.js';
import {
  drawableGhosts as drawn,
  entity,
  ghostSourceOf,
  snapshotOf,
  fogViewOf as viewOf,
} from '../../support/fixtures.js';

// All fixtures sit on even rows, where the stagger is 0 and cell (cx, cy) = (⌊tileX⌋, tileY).
const HOUSE = entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 } });
const TREE = entity(2, 9, 4, { Resource: { goodType: 3 } });
const HOUSE_CELL = '5,4';
const TREE_CELL = '9,4';

describe('FogGhostStore', () => {
  it('captures a static seen on VISIBLE ground and draws it once the cell regresses to EXPLORED', () => {
    const store = new FogGhostStore();
    // While the house is watched nothing is emitted: the live entity draws.
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    expect(drawn(store)).toEqual([]);
    // Once the ground regresses the memory draws, frozen at the captured reads.
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    const fogged = drawn(store);
    expect(fogged).toHaveLength(1);
    expect(fogged[0]).toMatchObject({ ref: 1, kind: 'building', typeId: 7, tileX: 5, tileY: 4 });
  });

  it('projects last-seen damage through the ghost scene without observing hidden repair', () => {
    const store = new FogGhostStore();
    const house = (hp: number) =>
      entity(1, 5, 4, {
        Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 },
        Health: { hitpoints: hp, max: 1000 },
      });
    store.update(snapshotOf([house(250)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([house(250)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    store.update(snapshotOf([house(1000)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 3));
    const ghost = collectSpriteScene(snapshotOf([]), { ghosts: store }).items.find((item) => item.ref === 1);
    expect(ghost).toMatchObject({ ghost: true, hpFrac: 0.25 });
    store.update(snapshotOf([house(1000)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 4));
    expect(collectSpriteScene(snapshotOf([house(1000)]), { ghosts: store }).items[0]?.hpFrac).toBeUndefined();
  });

  it('keeps a DEAD static ghosted until re-sight, then forgets it', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2));
    // Felled out of sight: the memory still shows the tree.
    store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 3));
    expect(drawn(store).map((g) => g.ref)).toEqual([2]);
    store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 4));
    expect(drawn(store)).toEqual([]);
    store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 5));
    expect(drawn(store)).toEqual([]);
  });

  it('freezes the memory at the update that loses sight, never a static that died in sight', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(drawn(store)).toEqual([]);
  });

  it('refreshes a LIVE static on re-sight (the ghost is the LAST-seen state, not the first)', () => {
    const site = (built: number) =>
      entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built, level: 0 }, UnderConstruction: {} });
    const store = new FogGhostStore();
    store.update(snapshotOf([site(0)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([site(0)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(drawn(store)[0]?.builtPct).toBe(0);
    store.update(snapshotOf([site(0)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 3));
    store.update(snapshotOf([site(ONE / 2)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 4));
    store.update(snapshotOf([site(ONE / 2)]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 5));
    expect(drawn(store)[0]?.builtPct).toBe(50);
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
    store.update(
      snapshotOf([HOUSE, TREE]),
      viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2),
      new Set([TREE.id]),
    );
    expect(drawn(store)).toEqual([]);
    // The house is still remembered, only held in the black: explored again, it draws.
    store.update(snapshotOf([]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 3), new Set([TREE.id]));
    expect(drawn(store).map((g) => g.ref)).toEqual([HOUSE.id]);
  });

  it('kept beside other seats, remembers a map-layer node and draws it once the layer lets it go', () => {
    const store = new FogGhostStore();
    store.recordStatics();
    const layer = new Set([TREE.id]);
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 1), layer);
    const explored = viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2);
    store.update(snapshotOf([TREE]), explored, layer);
    expect(drawn(store)).toEqual([]); // the layer's quad draws it
    // Another seat saw the tree worked: the layer hands it over, and this seat's last sight shows.
    layer.delete(TREE.id);
    store.update(snapshotOf([]), explored, layer);
    expect(drawn(store).map((g) => g.ref)).toEqual([TREE.id]);
  });

  it('a RECON map seeds natural resources and chests (never buildings) sight-unseen, once per known-terrain stretch', () => {
    const stump = entity(3, 11, 4, { Stump: { goodType: 3 } });
    const chest = entity(5, 15, 4, { Chest: { kind: 'wooden', contents: 20, gfxIndex: 845 } });
    const store = new FogGhostStore();
    // Nothing is visible, but the known-terrain view still knows where nature is.
    store.update(snapshotOf([HOUSE, TREE, stump, chest]), viewOf(new Map(), 1, FOG_MODE.RECON));
    const seeded = drawn(store);
    expect(seeded.map((g) => g.ref)).toEqual([2, 3, 5]);
    expect(seeded.every((g) => g.kind !== 'building')).toBe(true);
    expect(seeded.find((g) => g.ref === 5)).toMatchObject({ kind: 'chest', gfxIndex: 845 });
    // The seed is start-of-stretch knowledge, so a later spawn is not seeded retroactively, and the
    // stretch spans both RECON modes: no memory changes, so the version holds.
    const version = store.version;
    const lateTree = entity(4, 13, 4, { Resource: { goodType: 3 } });
    store.update(
      snapshotOf([HOUSE, TREE, stump, lateTree, chest]),
      viewOf(new Map(), 2, FOG_MODE.RECON_FOG_OF_WAR),
    );
    expect(drawn(store).map((g) => g.ref)).toEqual([2, 3, 5]);
    expect(store.version).toBe(version);
    // A CLASSIC map ends the stretch; the next RECON stretch seeds afresh.
    store.update(snapshotOf([HOUSE, TREE, stump, lateTree, chest]), viewOf(new Map(), 3, FOG_MODE.CLASSIC));
    expect(drawn(store)).toEqual([]);
    store.update(
      snapshotOf([HOUSE, TREE, stump, lateTree, chest]),
      viewOf(new Map(), 4, FOG_MODE.RECON_FOG_OF_WAR),
    );
    expect(drawn(store).map((g) => g.ref)).toEqual([2, 3, 4, 5]);
  });

  it("knows a multiplayer start's buildings and walls on known terrain, once, at the first view", () => {
    const wall = entity(6, 13, 4, { Palisade: {}, Owner: { player: 2 } });
    const foeHouse = entity(1, 5, 4, {
      Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 },
      Owner: { player: 2 },
    });
    const start = snapshotOf([foeHouse, TREE, wall]);
    const store = new FogGhostStore();
    store.knowStartBuildings(startBuildingGhosts(start));
    store.update(start, viewOf(new Map(), 1, FOG_MODE.RECON));
    expect(drawn(store).map((g) => g.ref)).toEqual([1, 2, 6]);
    expect(drawn(store).find((g) => g.ref === 1)).toMatchObject({ kind: 'building', owner: 2 });
    // The minimap marks the remembered building alone, never the wall or the nature beside it.
    expect(store.markers([]).map((g) => g.ref)).toEqual([1]);
    // Spent: a building raised later stays intel to see, even across a new known-terrain stretch.
    const late = entity(7, 15, 4, { Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 } });
    store.update(snapshotOf([foeHouse, TREE, wall, late]), viewOf(new Map(), 2, FOG_MODE.CLASSIC));
    store.update(snapshotOf([foeHouse, TREE, wall, late]), viewOf(new Map(), 3, FOG_MODE.RECON));
    expect(drawn(store).map((g) => g.ref)).toEqual([1, 2, 6]);
  });

  it('spends the start knowledge on a black map without remembering a building', () => {
    const store = new FogGhostStore();
    store.knowStartBuildings(startBuildingGhosts(snapshotOf([HOUSE])));
    store.update(snapshotOf([HOUSE]), viewOf(new Map(), 1, FOG_MODE.CLASSIC));
    store.update(snapshotOf([HOUSE]), viewOf(new Map(), 2, FOG_MODE.RECON));
    expect(drawn(store)).toEqual([]);
  });

  it("restores a saved memory into its own seat's first view, and nothing into another seat's", () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    const saved = store.memory();
    if (saved === null) throw new Error('expected a memory after a view');
    expect(saved.ghosts.map((g) => g.ref)).toEqual([HOUSE.id]);

    // The house burnt down out of sight before the save: the loaded memory still shows it.
    const restored = new FogGhostStore();
    restored.restore(saved);
    restored.update(snapshotOf([]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 1));
    expect(drawn(restored).map((g) => g.ref)).toEqual([HOUSE.id]);

    const otherSeat = new FogGhostStore();
    otherSeat.restore(saved);
    otherSeat.update(snapshotOf([]), {
      ...viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 1),
      player: 1,
    });
    expect(drawn(otherSeat)).toEqual([]);
  });

  it('seeds nothing on watched ground: the live entity draws there', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([TREE]), viewOf(new Map([[TREE_CELL, FOG_STATE.VISIBLE]]), 1, FOG_MODE.RECON));
    expect(store.has(TREE.id)).toBe(false);
    // Losing sight captures it like any other static.
    store.update(snapshotOf([TREE]), viewOf(new Map(), 2, FOG_MODE.RECON));
    expect(drawn(store).map((g) => g.ref)).toEqual([TREE.id]);
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
    const exploredCells = new Map([
      ['17,4', FOG_STATE.EXPLORED],
      ['19,4', FOG_STATE.EXPLORED],
      ['21,4', FOG_STATE.EXPLORED],
    ]);
    const store = new FogGhostStore();
    store.update(snapshotOf([heap(3), flag, empty]), viewOf(cells, 1));
    store.update(snapshotOf([heap(3), flag, empty]), viewOf(exploredCells, 2));
    store.update(snapshotOf([heap(1), flag, empty]), viewOf(exploredCells, 3));
    const fogged = drawn(store);
    expect(fogged).toEqual([{ ref: 6, kind: 'stockpile', tileX: 17, tileY: 4, goodType: 30, fill: 3 }]);
    // The memory draws the heap the viewer last saw, not the one the sim holds now.
    const scene = collectSpriteScene(snapshotOf([]), { ghosts: store });
    expect(scene.items[0]).toMatchObject({ ref: 6, kind: 'stockpile', ghost: true, goodType: 30, fill: 3 });
    // A RECON map seeds its heaps like its chests.
    const seeded = new FogGhostStore();
    seeded.update(snapshotOf([heap(2), flag]), viewOf(new Map(), 1, FOG_MODE.RECON_FOG_OF_WAR));
    expect(drawn(seeded).map((g) => g.ref)).toEqual([6]);
  });

  it('remembers walls, gates and wall sites drawn as they last stood, posts and shifts included', () => {
    const row = 10;
    const columnX = 20;
    const columnRows = [9, 10, 11, 12];
    const tileOf = (hx: number, hy = row) => {
      const { x, y } = positionOfNode(hx, hy);
      return { x: x / ONE, y: y / ONE };
    };
    const wall = (id: number, hx: number, marker: Record<string, unknown> = {}, hy = row) =>
      entity(id, tileOf(hx, hy).x, tileOf(hx, hy).y, {
        Palisade: { gfxIndex: 691, tribe: 1, built: ONE },
        ...marker,
      });
    const column = columnRows.map((hy, i) => wall(7 + i, columnX, {}, hy));
    const nodes = [
      ...[6, 7, 8, 10, 12, 16].map((hx) => tileOf(hx)),
      ...columnRows.map((hy) => tileOf(columnX, hy)),
    ];
    const cellsIn = (state: number) =>
      new Map(
        nodes.map(({ x, y }) => {
          const { cx, cy } = fogCellOfTile(x, y);
          return [`${cx},${cy}`, state] as const;
        }),
      );
    const gate = wall(4, 10, {
      Palisade: {
        gfxIndex: 697,
        tribe: 1,
        built: ONE,
        walk: [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 })),
        gate: { open: false, counterpartGfxIndex: 701 },
      },
    });
    const site = wall(6, 16, {
      Palisade: { gfxIndex: 691, tribe: 1, built: 0, reservation: 9 },
      UnderConstruction: {},
    });
    const snapshot = snapshotOf([wall(1, 6), wall(2, 7), wall(3, 8), gate, wall(5, 12), site, ...column]);
    const store = new FogGhostStore();
    store.update(snapshot, viewOf(cellsIn(FOG_STATE.VISIBLE), 1));
    store.update(snapshot, viewOf(cellsIn(FOG_STATE.EXPLORED), 2));
    expect(drawn(store).map((g) => g.kind)).toEqual(Array(10).fill('palisade'));

    const drawnFields = (items: readonly SpriteDrawItem[]) =>
      items.map(({ ref, x, y, gfxIndex, palisadePosts, palisadeSite }) => ({
        ref,
        x,
        y,
        gfxIndex,
        palisadePosts,
        palisadeSite,
      }));
    const live = drawnFields(collectSpriteScene(snapshot).items);
    expect(drawnFields(collectSpriteScene(snapshotOf([]), { ghosts: store }).items)).toEqual(live);
    // The comparison covers what a bare post would lose.
    expect(live.some((item) => (item.palisadePosts?.length ?? 0) > 0)).toBe(true);
    expect(live.find((item) => item.ref === 4)?.x).toBe(tileToScreen(tileOf(10).x, tileOf(10).y).x);
    // A column wall draws shifted off its node, and its ghost with it.
    const columnTop = tileOf(columnX, columnRows[0]);
    expect(live.find((item) => item.ref === 7)?.x).not.toBe(tileToScreen(columnTop.x, columnTop.y).x);
    expect(live.find((item) => item.ref === 6)?.palisadeSite).toBe('claimed');
  });

  it('draws an opened chest by its inert open graphics record', () => {
    const chest = entity(5, 15, 4, { OpenedChest: { gfxIndex: 846 } });
    const scene = collectSpriteScene(snapshotOf([chest]));
    expect(scene.items[0]).toMatchObject({ ref: 5, kind: 'chest', gfxIndex: 846 });
  });

  it('forgets one seat’s memory when the view changes seat', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    const explored = viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2);
    store.update(snapshotOf([HOUSE]), explored);
    expect(drawn(store)).toHaveLength(1);
    store.update(snapshotOf([HOUSE]), { ...explored, player: 1 });
    expect(drawn(store)).toEqual([]);
  });

  it('captures for the new seat under one generation even when the last seat remembered nothing', () => {
    const store = new FogGhostStore();
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.UNEXPLORED]]), 1));
    expect(drawn(store)).toEqual([]);
    store.update(snapshotOf([HOUSE]), {
      ...viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1),
      player: 1,
    });
    expect(drawn(store)).toEqual([]);
    const explored = { ...viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2), player: 1 };
    store.update(snapshotOf([HOUSE]), explored);
    expect(drawn(store).map((g) => g.ref)).toEqual([HOUSE.id]);
  });

  it('bumps its version only when what it draws changed', () => {
    const store = new FogGhostStore();
    const view = viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1);
    store.update(snapshotOf([HOUSE]), view);
    const steady = store.version;
    store.update(snapshotOf([HOUSE]), view);
    expect(store.version).toBe(steady);
    // A mask rebuild that changed no cell leaves the memory as it was.
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 2));
    expect(store.version).toBe(steady);
    store.update(snapshotOf([HOUSE]), viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 3));
    expect(store.version).not.toBe(steady);
    expect(drawn(store)).toHaveLength(1);
  });

  it('diffs a view carrying its mask bytes exactly as one read cell by cell', () => {
    const cellsWide = 13;
    const cellsHigh = 6;
    const statics = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      entity(
        10 + i,
        (i * 5) % cellsWide,
        2 * (i % 3),
        i % 2 === 0
          ? { Resource: { goodType: 3 } }
          : {
              Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 },
            },
      ),
    );
    const snapshot = snapshotOf(statics);
    const byBytes = new FogGhostStore();
    const byCells = new FogGhostStore();
    const states = [FOG_STATE.UNEXPLORED, FOG_STATE.EXPLORED, FOG_STATE.VISIBLE];
    let seed = 7;
    for (let generation = 1; generation <= 12; generation++) {
      const mask = new Uint8Array(cellsWide * cellsHigh);
      for (let i = 0; i < mask.length; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        mask[i] = states[seed % states.length] ?? FOG_STATE.UNEXPLORED;
      }
      const answer = { player: 0, mode: FOG_MODE.CLASSIC_FOG_OF_WAR, cellsWide, cellsHigh, generation, mask };
      const view = fogViewOfMask(answer);
      expect(view.cells).toBe(mask);
      const { cells: _cells, ...cellByCell } = view;
      byBytes.update(snapshot, view);
      byCells.update(snapshot, cellByCell);
      expect(drawn(byBytes)).toEqual(drawn(byCells));
    }
    expect(drawn(byBytes).length).toBeGreaterThan(0);
  });

  it('a cell leaving sight captures only the statics standing in it', () => {
    // An odd-row neighbour: the half-tile stagger puts tile (5.9, 5) in cell (6, 5), not (5, 5).
    const shifted = entity(3, 5.9, 5, { Stump: { goodType: 3 } });
    const beside = entity(4, 6, 4, { Stump: { goodType: 3 } });
    const settler = entity(5, 5.5, 4, { Settler: { tribe: 0 } });
    const world = snapshotOf([HOUSE, shifted, beside, settler]);
    expect(fogCellOfTile(5.9, 5)).toEqual({ cx: 6, cy: 5 });
    const watched = new Map([
      [HOUSE_CELL, FOG_STATE.VISIBLE],
      ['6,4', FOG_STATE.VISIBLE],
      ['6,5', FOG_STATE.VISIBLE],
    ]);
    const store = new FogGhostStore();
    store.update(world, viewOf(watched, 1));
    // Only the house's cell loses sight; the settler shares it but is no static.
    store.update(world, viewOf(new Map([...watched, [HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(drawn(store).map((g) => g.ref)).toEqual([HOUSE.id]);
    // The odd-row cell follows: its stump alone joins.
    store.update(
      world,
      viewOf(new Map([...watched, [HOUSE_CELL, FOG_STATE.EXPLORED], ['6,5', FOG_STATE.EXPLORED]]), 3),
    );
    expect(drawn(store).map((g) => g.ref)).toEqual([HOUSE.id, shifted.id]);
    // Re-sighting the house's cell drops its record and nothing else.
    const before = store.version;
    store.update(world, viewOf(new Map([...watched, ['6,5', FOG_STATE.EXPLORED]]), 4));
    expect(store.version).not.toBe(before);
    expect(drawn(store).map((g) => g.ref)).toEqual([shifted.id]);
    expect(store.has(HOUSE.id)).toBe(false);
    expect(store.has(shifted.id)).toBe(true);
  });

  it('forgets a vehicle remembered on explored ground once the live one is sighted elsewhere', () => {
    const ship = (tileX: number) => entity(3, tileX, 6, { Vehicle: { vehicleType: 0, tribe: 1 } });
    const lastSeen = '5,6';
    const elsewhere = '20,6';
    const store = new FogGhostStore();
    store.update(snapshotOf([ship(5)]), viewOf(new Map([[lastSeen, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshotOf([ship(5)]), viewOf(new Map([[lastSeen, FOG_STATE.EXPLORED]]), 2));
    expect(drawn(store).map((g) => g.ref)).toEqual([3]);
    // Sailing on under fog, the memory holds where it was last seen.
    store.update(
      snapshotOf([ship(20)]),
      viewOf(
        new Map([
          [lastSeen, FOG_STATE.EXPLORED],
          [elsewhere, FOG_STATE.EXPLORED],
        ]),
        3,
      ),
    );
    expect(drawn(store).map((g) => g.ref)).toEqual([3]);
    // In sight at another cell, the live vehicle draws there and the memory goes.
    store.update(
      snapshotOf([ship(20)]),
      viewOf(
        new Map([
          [lastSeen, FOG_STATE.EXPLORED],
          [elsewhere, FOG_STATE.VISIBLE],
        ]),
        4,
      ),
    );
    expect(drawn(store)).toEqual([]);
    expect(store.has(3)).toBe(false);
  });

  it('answers a box query with the drawable ghosts under it', () => {
    const near = entity(3, 2, 2, { Stump: { goodType: 3 } });
    const far = entity(4, 40, 40, { Stump: { goodType: 3 } });
    const dark = entity(5, 3, 2, { Stump: { goodType: 3 } });
    const world = snapshotOf([near, far, dark]);
    const cells = (state: number) =>
      new Map([
        ['2,2', state],
        ['40,40', state],
        ['3,2', state === FOG_STATE.VISIBLE ? state : FOG_STATE.UNEXPLORED],
      ]);
    const store = new FogGhostStore();
    store.update(world, viewOf(cells(FOG_STATE.VISIBLE), 1));
    store.update(world, viewOf(cells(FOG_STATE.EXPLORED), 2));
    const box = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    // The far stump lies outside the box and the dark one under unexplored black.
    expect(store.within(box, []).map((g) => g.ref)).toEqual([near.id]);
    expect(drawn(store).map((g) => g.ref)).toEqual([near.id, far.id]);
    expect(store.has(far.id)).toBe(true);
    expect(store.has(dark.id)).toBe(false);
  });
});

describe('SpriteSceneCache - ghost key', () => {
  const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };

  it('reuses a build while the ghost source holds its version, and rebuilds once it moves', () => {
    const store = new FogGhostStore();
    const snapshot = snapshotOf([HOUSE]);
    const frame = {
      snapshot,
      viewport: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      elevation: FLAT,
      ghosts: store,
    };
    const cache = new SpriteSceneCache();
    const scene = collectSpriteScene(snapshot, frame);
    cache.store(frame, scene);
    expect(cache.lookup(frame)).toBe(scene);
    store.update(snapshot, viewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 1));
    store.update(snapshot, viewOf(new Map([[HOUSE_CELL, FOG_STATE.EXPLORED]]), 2));
    expect(cache.lookup(frame)).toBeNull();
  });
});

describe('collectSpriteScene - ghost emission', () => {
  const GHOST = { ref: 9, kind: 'building', tileX: 5, tileY: 4, typeId: 7 } as const;

  it('emits a tagged ghost item for a ref absent from the snapshot, and keeps the ref live', () => {
    const scene = collectSpriteScene(snapshotOf([]), { ghosts: ghostSourceOf([GHOST]) });
    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({ ref: 9, kind: 'building', ghost: true, typeId: 7 });
    // The pooled sprite of a dead but remembered entity must not be destroyed.
    expect(scene.liveRefs.has(9)).toBe(true);
    // An opened chest's memory draws by the record it was seen with.
    const chest = { ref: 10, kind: 'chest', tileX: 7, tileY: 4, gfxIndex: 845 } as const;
    const chestScene = collectSpriteScene(snapshotOf([]), { ghosts: ghostSourceOf([chest]) });
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
    const scene = collectSpriteScene(snapshotOf([]), { viewport: elsewhere, ghosts: ghostSourceOf([GHOST]) });
    expect(scene.items).toEqual([]);
    expect(scene.liveRefs.has(9)).toBe(true);
  });

  it('depth-sorts a ghost among live sprites by the same feet-anchor key', () => {
    // The settler is one row south of the ghost.
    const scene = collectSpriteScene(snapshotOf([entity(1, 5, 5, { Settler: { tribe: 0 } })]), {
      ghosts: ghostSourceOf([GHOST]),
    });
    expect(scene.items.map((d) => d.ref)).toEqual([9, 1]);
  });

  it('draws from the store exactly what the whole ghost list culled by the viewport draws', () => {
    // Scattered across several tile buckets on both row parities, all captured off a fogging map.
    const SPREAD_X = 7;
    const SPREAD_Y = 11;
    const MAP_TILES = 48;
    const COUNT = 120;
    const statics = Array.from({ length: COUNT }, (_, i) =>
      entity(i + 1, ((i * SPREAD_X) % MAP_TILES) + (i % 3) / 3, (i * SPREAD_Y) % MAP_TILES, {
        Stump: { goodType: 3 },
      }),
    );
    const world = snapshotOf(statics);
    const cells = (state: number) =>
      new Map(
        statics.map((e) => {
          const pos = e.components.Position as { x: number; y: number };
          const { cx, cy } = fogCellOfTile(pos.x / ONE, pos.y / ONE);
          return [`${cx},${cy}`, state] as const;
        }),
      );
    const store = new FogGhostStore();
    store.update(world, viewOf(cells(FOG_STATE.VISIBLE), 1));
    store.update(world, viewOf(cells(FOG_STATE.EXPLORED), 2));
    // The scenes below build over an empty world: the statics died after sight was lost.
    const list = ghostSourceOf(drawn(store));
    expect(drawn(store)).toHaveLength(COUNT);
    const corner = tileToScreen(10, 10);
    const far = tileToScreen(30, 30);
    const viewport = { minX: corner.x, minY: corner.y, maxX: far.x, maxY: far.y };
    const fromStore = collectSpriteScene(snapshotOf([]), { viewport, ghosts: store });
    const fromList = collectSpriteScene(snapshotOf([]), { viewport, ghosts: list });
    expect(fromStore.items).toEqual(fromList.items);
    expect(fromStore.items.length).toBeGreaterThan(0);
    expect(fromStore.items.length).toBeLessThan(COUNT);
    expect(fromStore.items.every((item) => isVisible(viewport, item.x, item.y))).toBe(true);
    // Every remembered ref stays live, framed or not.
    expect(statics.every((e) => fromStore.liveRefs.has(e.id))).toBe(true);
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
    store.update(snapshotOf([deposit]), viewOf(new Map([[TREE_CELL, FOG_STATE.EXPLORED]]), 2));
    const remembered = collectSpriteScene(snapshotOf([]), { ghosts: store }).items[0];

    if (live === undefined || remembered === undefined) throw new Error('missing draw item');
    // Level 1 of 4 rescales onto 5 frames as ceil(1·5/4) = 2, so bob 20. Pinned, so the pair cannot agree
    // by both falling through to `default`.
    expect(resolveResourceDraw(binding, live)?.bob).toBe(20);
    expect(resolveResourceDraw(binding, remembered)).toEqual(resolveResourceDraw(binding, live));
  });
});
