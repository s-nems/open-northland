import { GROUND_VOID, GROUND_WATER } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { LandscapeResource, Resource, ResourceFootprint, Stockpile } from '../../../src/components/index.js';
import { landscapeEditState } from '../../../src/components/landscape.js';
import {
  exportSaveGame,
  findPath,
  parseSaveGame,
  restoreSimulation,
  Simulation,
} from '../../../src/index.js';
import { cellOfNode, hexDistanceBetween } from '../../../src/nav/halfcell.js';
import { dynamicBlockOverlay, placementProbe, routeRegions } from '../../../src/systems/footprint/index.js';
import { placementGridRebuilds } from '../../../src/systems/footprint/placement/blocker-grid.js';
import { createResourceNode } from '../../../src/systems/footprint/resources.js';
import {
  removeLandscapes,
  setBuildForbidden,
  setLandscape,
  setVertexColors,
} from '../../../src/systems/landscape/edits.js';
import {
  landscapeBlocks,
  landscapeResources,
  landscapesWithin,
} from '../../../src/systems/landscape/view.js';
import { SUCCESSFUL_IF } from '../../../src/systems/missions/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from '../../fixtures/context.js';
import { HUT, houseContent, LOAD_PASS, missionSim } from '../missions/support.js';
import { fresh, map, POINT, terrainOf, WALL } from './support.js';

/** The 16x16 node fixture's cells per side. */
const CELLS = 8;

describe('script landscape state and blockers', () => {
  it('does not invalidate collision views for tints or mutate repeated identical writes', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const before = landscapeBlocks(sim.world, terrain);
    setVertexColors(sim.world, terrain, POINT, 2, 100, false);
    expect(landscapeBlocks(sim.world, terrain)).toBe(before);
    const version = sim.world.mutationVersion;
    setVertexColors(sim.world, terrain, POINT, 2, 100, false);
    expect(sim.world.mutationVersion).toBe(version);
    setBuildForbidden(sim.world, terrain, POINT, 1, true);
    expect(landscapeBlocks(sim.world, terrain)).toBe(before);
  });

  it('keeps a cell blocked while another placement still holds it and frees it with the last', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    // The authored wall at POINT covers (8,8) and (9,8); a wall one point left covers (7,8) and (8,8).
    const shared = terrain.nodeAt(8, 8);
    // Built now, so the verifier at the end proves the grid replayed every change below.
    expect(placementProbe(sim.world, sim.content, terrain, HUT, undefined).canPlace(10, 8)).toBe(false);
    expect(setLandscape(sim.world, ctx, { hx: 7, hy: 8 }, 1, 0)).toBe(true);
    const doubled = landscapeBlocks(sim.world, terrain);
    expect(doubled.walk.has(shared)).toBe(true);
    removeLandscapes(sim.world, ctxOf(sim), terrain, POINT, 0);
    const halved = landscapeBlocks(sim.world, terrain);
    expect(halved.walk.has(shared)).toBe(true);
    expect(halved.walk.has(terrain.nodeAt(9, 8))).toBe(false);
    removeLandscapes(sim.world, ctxOf(sim), terrain, { hx: 7, hy: 8 }, 0);
    const cleared = landscapeBlocks(sim.world, terrain);
    expect(cleared.walk.has(shared)).toBe(false);
    // Each edit mints a view naming only the cells whose blocking changed, chained from the one before.
    expect(doubled.next).toBe(halved);
    expect(halved.next).toBe(cleared);
    expect(halved.changes.filter((c) => c.channel === 'walk')).toEqual([
      { node: terrain.nodeAt(9, 8), channel: 'walk', entered: false },
    ]);
    expect(cleared.changes.filter((c) => c.channel === 'walk')).toEqual([
      { node: terrain.nodeAt(7, 8), channel: 'walk', entered: false },
      { node: shared, channel: 'walk', entered: false },
    ]);
    expect(dynamicBlockOverlay(sim.world, ctx, terrain).has(shared)).toBe(false);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, undefined).canPlace(10, 8)).toBe(true);
    expect(placementGridRebuilds(sim.world)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('catches the grid up over edits it never read, and re-reads once the chain is let go', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const probe = () => placementProbe(sim.world, sim.content, terrain, HUT, undefined);
    expect(probe().canPlace(10, 8)).toBe(false);
    // Three edits with no read of the layer between them: one catch-up carries all of them.
    removeLandscapes(sim.world, ctxOf(sim), terrain, POINT, 0);
    expect(setLandscape(sim.world, ctx, { hx: 3, hy: 3 }, 1, 0)).toBe(true);
    expect(setLandscape(sim.world, ctx, { hx: 12, hy: 12 }, 1, 0)).toBe(true);
    expect(probe().canPlace(10, 8)).toBe(true);
    expect(probe().canPlace(5, 3)).toBe(false);
    expect(placementGridRebuilds(sim.world)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
    // Far more edits than the layer keeps linked: the grid's chain breaks and it re-reads the layer.
    for (let i = 0; i < 300; i++) {
      removeLandscapes(sim.world, ctxOf(sim), terrain, { hx: 12, hy: 12 }, 0);
      expect(setLandscape(sim.world, ctx, { hx: 12, hy: 12 }, 1, 0)).toBe(true);
      landscapeBlocks(sim.world, terrain);
    }
    expect(probe().canPlace(5, 3)).toBe(false);
    expect(placementGridRebuilds(sim.world)).toBe(2);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('finds placements by area in file order and the script additions after them', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    expect(landscapesWithin(sim.world, terrain, POINT, 0).map((p) => p.id)).toEqual([0]);
    expect(landscapesWithin(sim.world, terrain, POINT, 100).map((p) => p.id)).toEqual([0, 1]);
    expect(landscapesWithin(sim.world, terrain, { hx: 5, hy: 5 }, 2).map((p) => p.id)).toEqual([1]);
    expect(setLandscape(sim.world, ctxOf(sim), { hx: 6, hy: 6 }, 2, 0)).toBe(true);
    expect(landscapesWithin(sim.world, terrain, POINT, 100).map((p) => p.id)).toEqual([0, 1, 2]);
    removeLandscapes(sim.world, ctxOf(sim), terrain, { hx: 5, hy: 5 }, 0);
    expect(landscapesWithin(sim.world, terrain, POINT, 100).map((p) => p.id)).toEqual([0, 2]);
    expect(landscapesWithin(sim.world, terrain, POINT, -1)).toEqual([]);
  });

  it('rejects a saved map restored against different landscape inputs', () => {
    const sim = fresh();
    const saved = exportSaveGame(sim);
    const changed = map();
    expect(() =>
      restoreSimulation(saved, {
        content: sim.content,
        map: { ...changed, landscapes: { types: [], placements: [] } },
      }),
    ).toThrow(/mapFingerprint/);
  });

  it('removes authored full-body collision and margins from cached navigation and placement', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const node = terrain.nodeAt(9, 8);
    expect(dynamicBlockOverlay(sim.world, ctx, terrain).has(node)).toBe(true);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, undefined).canPlace(10, 8)).toBe(false);
    removeLandscapes(sim.world, ctxOf(sim), terrain, POINT, 0);
    expect(dynamicBlockOverlay(sim.world, ctx, terrain).has(node)).toBe(false);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, undefined).canPlace(10, 8)).toBe(true);
    expect(sim.landscapeEdits().removed).toEqual([0]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('reopens a pocket after removing a landscape wall', () => {
    const walls = Array.from({ length: 16 }, (_, hy) => ({ id: hy, typeId: 1, hx: 8, hy, level: 0 }));
    const source = map();
    const sim = new Simulation({
      seed: 1,
      content: houseContent(),
      map: { ...source, landscapes: { types: [WALL], placements: walls } },
    });
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const from = terrain.nodeAt(4, 4);
    const to = terrain.nodeAt(12, 4);
    const regions = routeRegions(sim.world, ctx, terrain);
    expect(regions.unroutable(from, to)).toBe(true);
    expect(findPath(terrain, from, to, dynamicBlockOverlay(sim.world, ctx, terrain))).toBeNull();
    removeLandscapes(sim.world, ctx, terrain, { hx: 8, hy: 4 }, 0);
    expect(regions.unroutable(from, to)).toBe(false);
    expect(findPath(terrain, from, to, dynamicBlockOverlay(sim.world, ctx, terrain))).not.toBeNull();
  });

  it('replaces all objects at an anchor and filters removals by the catalog group', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    removeLandscapes(sim.world, ctxOf(sim), terrain, POINT, 100, 'smoke');
    expect(sim.landscapeEdits().removed).toEqual([1]);
    expect(setLandscape(sim.world, ctxOf(sim), POINT, 2, 3)).toBe(true);
    expect(sim.landscapeEdits().removed).toEqual([0, 1]);
    expect(sim.landscapeEdits().added).toEqual([{ id: 2, typeId: 2, ...POINT, level: 3 }]);
    expect(setLandscape(sim.world, ctxOf(sim), POINT, 999, 0)).toBe(false);
    expect(sim.landscapeEdits().added).toHaveLength(1);
  });

  it('updates overlapping bans and sparse land-only tints with bounded area work', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    setBuildForbidden(sim.world, terrain, POINT, 1_000_000_000, true);
    expect(landscapeEditState(sim.world).forbidden.size).toBe(256);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, undefined).canPlace(3, 3)).toBe(false);
    setBuildForbidden(sim.world, terrain, { hx: 3, hy: 3 }, 3, false);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, undefined).canPlace(3, 3)).toBe(true);
    setVertexColors(sim.world, terrain, POINT, 1_000_000_000, 100, false);
    setVertexColors(sim.world, terrain, POINT, 1_000_000_000, 200, true);
    // The fixture's west half is land; an OnLand write skips the two-cell map border and any cell
    // whose anchor node is water.
    const expected = new Uint8Array(CELLS * CELLS);
    for (let cy = 0; cy < CELLS; cy++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const border = cx < 2 || cy < 2 || cx >= CELLS - 2 || cy >= CELLS - 2;
        expected[cy * CELLS + cx] = !border && 2 * cx + (cy & 1) < 8 ? 200 : 100;
      }
    }
    expect(sim.landscapeEdits().tints).toEqual(expected);
  });

  it('paints only land with an OnLand write, not void ground, and keeps the low byte of the index', () => {
    const kinds = map().groundKinds;
    if (kinds === undefined) throw new Error('fixture carries ground kinds');
    const groundKinds = kinds.map((kind) => (kind === GROUND_WATER ? GROUND_VOID : kind));
    const sim = new Simulation({ seed: 1, content: houseContent(), map: { ...map(), groundKinds } });
    const terrain = terrainOf(sim);
    setVertexColors(sim.world, terrain, POINT, 1_000_000_000, 300, true);
    const tints = sim.landscapeEdits().tints;
    expect(tints[2 * CELLS + 2]).toBe(300 & 0xff);
    expect(tints[2 * CELLS + 5]).toBe(0);
  });

  it("paints a tint as cells: the point's cell plus range/2 less one rings, clamped to the map", () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const tinted = () => sim.landscapeEdits().tints.filter((value) => value !== 0).length;
    // Every range under 4 is the centre cell alone.
    setVertexColors(sim.world, terrain, POINT, 3, 100, false);
    expect(tinted()).toBe(1);
    // Range 6: two rings, 1 + 6 + 12 cells.
    setVertexColors(sim.world, terrain, POINT, 6, 100, false);
    expect(tinted()).toBe(19);
    // A point off the map paints the part of its disc that lies on the map, here all of it.
    setVertexColors(sim.world, terrain, { hx: -40, hy: 8 }, 900, 100, false);
    expect(tinted()).toBe(CELLS * CELLS);
  });

  it('paints every cell within the radius, at the edges and on odd cell rows alike', () => {
    for (const [point, range] of [
      [{ hx: 15, hy: 15 }, 8],
      [{ hx: 0, hy: 0 }, 6],
      [{ hx: 5, hy: 6 }, 4],
      [{ hx: 20, hy: 7 }, 10],
    ] as const) {
      const sim = fresh();
      const terrain = terrainOf(sim);
      setVertexColors(sim.world, terrain, point, range, 100, false);
      const centre = cellOfNode(point.hx, point.hy);
      const radius = (range >> 1) - 1;
      const expected = new Uint8Array(CELLS * CELLS);
      for (let cy = 0; cy < CELLS; cy++) {
        for (let cx = 0; cx < CELLS; cx++) {
          if (hexDistanceBetween(cx, cy, centre.cx, centre.cy) <= radius) expected[cy * CELLS + cx] = 100;
        }
      }
      expect(sim.landscapeEdits().tints).toEqual(expected);
    }
  });

  it("starts every cell from the author's tint, which a script write replaces and a save keeps", () => {
    // An 8x8 cell lane under the 16x16 node fixture: the top cell rows dark, the rest neutral.
    const DARK = 58;
    const tints = Array.from({ length: CELLS * CELLS }, (_, cell) => (cell < 2 * CELLS ? DARK : 0));
    const sim = new Simulation({ seed: 1, content: houseContent(), map: { ...map(), tints } });
    const terrain = terrainOf(sim);
    expect(sim.landscapeEdits().tints).toEqual(Uint8Array.from(tints));
    expect(sim.landscapeEdits().tintColumns).toBe(CELLS);
    expect(landscapeEditState(sim.world).tints.size).toBe(0);
    // Writing the author's own index changes nothing; a reset over it is a real write.
    const version = sim.world.mutationVersion;
    setVertexColors(sim.world, terrain, { hx: 2, hy: 2 }, 3, DARK, false);
    expect(sim.world.mutationVersion).toBe(version);
    setVertexColors(sim.world, terrain, { hx: 2, hy: 2 }, 3, 0, false);
    expect(landscapeEditState(sim.world).tints.size).toBe(1);
    const written = cellOfNode(2, 2);
    expect(sim.landscapeEdits().tints[written.cy * CELLS + written.cx]).toBe(0);
    expect(sim.landscapeEdits().tints[1]).toBe(DARK);
    const saved = parseSaveGame(JSON.parse(JSON.stringify(exportSaveGame(sim))));
    const restored = restoreSimulation(saved, { content: sim.content, map: { ...map(), tints } });
    expect(restored.landscapeEdits().tints).toEqual(sim.landscapeEdits().tints);
    expect(() => restoreSimulation(saved, { content: sim.content, map: map() })).toThrow(/mapFingerprint/);
  });

  it('applies a scripted tint whose point lies off the map', () => {
    const sim = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [],
          results: [{ opcode: 'SetVertexColor', point: { hx: 255, hy: 255 }, range: 900, amount: 5 }],
        },
      ],
      houseContent(),
      map(),
    );
    sim.run(LOAD_PASS);
    expect(sim.landscapeEdits().tints.every((value) => value === 5)).toBe(true);
    expect(sim.events.current().some((event) => event.kind === 'missionVertexColor')).toBe(true);
  });

  it('saves sparse edits and restores identical collision and detached presentation', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    setLandscape(sim.world, ctxOf(sim), POINT, 2, 1);
    setBuildForbidden(sim.world, terrain, POINT, 2, true);
    setVertexColors(sim.world, terrain, POINT, 2, 90, false);
    const saved = parseSaveGame(JSON.parse(JSON.stringify(exportSaveGame(sim))));
    const restored = restoreSimulation(saved, { content: sim.content, map: map() });
    expect(restored.hashState()).toBe(sim.hashState());
    const { revision: _a, ...before } = sim.landscapeEdits();
    const { revision: _b, ...after } = restored.landscapeEdits();
    expect(after).toEqual(before);
    expect(
      dynamicBlockOverlay(restored.world, ctxOf(restored), terrainOf(restored)).has(
        terrainOf(restored).nodeAt(8, 8),
      ),
    ).toBe(false);
    // The restored world's layer and grid start from the saved edits and keep taking new ones.
    const restoredTerrain = terrainOf(restored);
    const probe = () => placementProbe(restored.world, restored.content, restoredTerrain, HUT, undefined);
    expect(probe().canPlace(5, 3)).toBe(true);
    expect(setLandscape(restored.world, ctxOf(restored), { hx: 3, hy: 3 }, 1, 0)).toBe(true);
    expect(probe().canPlace(5, 3)).toBe(false);
    expect(placementGridRebuilds(restored.world)).toBe(1);
    expect(restored.world.verifyCaches()).toEqual([]);
  });

  it('never resurrects a resource-backed initial placement after its resource is depleted', () => {
    const source = map();
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: {
        ...source,
        landscapes: {
          types: [WALL],
          placements: [{ id: 0, typeId: 1, ...POINT, level: 0, resourceBacked: true }],
        },
      },
    });
    const resource = createResourceNode(sim.world, sim.content, {
      good: 1,
      x: 8,
      y: 8,
      remaining: 5,
      harvestAtomic: 24,
      landscapeId: 0,
    });
    if (resource === null) throw new Error('fixture resource');
    expect(sim.world.has(resource, LandscapeResource)).toBe(true);
    expect(sim.world.has(resource, Resource)).toBe(true);
    expect(landscapesWithin(sim.world, terrainOf(sim), POINT, 0)).toHaveLength(1);
    sim.world.destroy(resource);
    expect(landscapesWithin(sim.world, terrainOf(sim), POINT, 0)).toHaveLength(0);
    expect(sim.landscapeEdits().removed).toEqual([0]);
  });

  it('patches the resource index per felled resource and re-reads a shared bucket in store order', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: map() });
    const spawn = (landscapeId: number) => {
      const node = createResourceNode(sim.world, sim.content, {
        good: 1,
        x: 8,
        y: 8,
        remaining: 5,
        harvestAtomic: 24,
        landscapeId,
      });
      if (node === null) throw new Error('fixture resource');
      return node;
    };
    const lone = spawn(0);
    const first = spawn(1);
    const second = spawn(1);
    const index = landscapeResources(sim.world);
    expect(index.entitiesOf(1)).toEqual([first, second]);
    sim.world.destroy(lone);
    const replacement = spawn(2);
    expect(landscapeResources(sim.world)).toBe(index);
    expect(index.has(0)).toBe(false);
    expect(index.entitiesOf(2)).toEqual([replacement]);
    sim.world.destroy(first);
    expect(landscapeResources(sim.world).entitiesOf(1)).toEqual([second]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('counts animals globally through the same wild-player ownership seam as area goals', () => {
    const sim = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [],
          results: [
            { opcode: 'SetAnimal', player: 20, tribe: 9, job: 0, point: POINT, objectId: 1, behaviour: 0 },
          ],
        },
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [{ opcode: 'NumberOfAnimals', player: 20, tribe: 9, amount: 1 }],
          results: [{ opcode: 'Exit' }],
        },
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [{ opcode: 'NumberOfAnimals', player: 0, tribe: 9, amount: 1 }],
          results: [{ opcode: 'Exit' }],
        },
      ],
      houseContent(),
      map(),
    );
    sim.run(LOAD_PASS);
    expect(sim.events.current().filter((event) => event.kind === 'missionExit')).toEqual([
      { kind: 'missionExit', mission: 1 },
    ]);
  });

  it('blocks an authored object only up to its level, and a scripted one at the level it is laid', () => {
    const heap = {
      typeId: 5,
      walk: [],
      build: [],
      groups: [],
      blockAreas: {
        walk: [
          [1, 0, 0, 1],
          [3, 1, 0, 1],
        ] as [number, number, number, number][],
        build: [],
      },
    };
    const sim = new Simulation({
      seed: 1,
      content: houseContent(),
      map: {
        ...map(),
        landscapes: { types: [heap], placements: [{ id: 0, typeId: 5, hx: 4, hy: 4, level: 1 }] },
      },
    });
    const terrain = terrainOf(sim);
    const walk = () => landscapeBlocks(sim.world, terrain).walk;
    expect(walk().has(terrain.nodeAt(4, 4))).toBe(true);
    expect(walk().has(terrain.nodeAt(5, 4))).toBe(false);
    expect(setLandscape(sim.world, ctxOf(sim), { hx: 10, hy: 10 }, 5, 3)).toBe(true);
    expect(walk().has(terrain.nodeAt(10, 10))).toBe(true);
    expect(walk().has(terrain.nodeAt(11, 10))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('spawns mine stock at the requested level and removes linked resources without spill', () => {
    const source = map();
    const mine = {
      typeId: 3,
      walk: WALL.walk,
      build: WALL.build,
      groups: [],
      resource: {
        good: 4,
        remaining: 10,
        harvestAtomic: 25,
        deposit: { initial: 10, levels: 10 },
      },
    };
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { ...source, landscapes: { types: [WALL, mine], placements: [] } },
    });
    expect(setLandscape(sim.world, ctxOf(sim), POINT, 3, 3)).toBe(true);
    const [resource] = [...sim.world.query(Resource)];
    if (resource === undefined) throw new Error('mine spawned');
    expect(sim.world.get(resource, Resource).remaining).toBe(3);
    const removed: number[] = [];
    removeLandscapes(sim.world, ctxOf(sim), terrainOf(sim), POINT, 0, undefined, (entity) =>
      removed.push(entity),
    );
    expect(removed).toEqual([resource]);
    expect(sim.world.isAlive(resource)).toBe(false);
    expect(sim.landscapeEdits().added).toEqual([]);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrainOf(sim)).size).toBe(0);
  });

  it('lays a goods heap of the requested level for a good landscape and removes it as a resource', () => {
    const source = map();
    const shoes = { typeId: 3, walk: [], build: [], groups: [], good: { goodId: 'tool_wooden' } };
    const unknown = { typeId: 4, walk: [], build: [], groups: [], good: { goodId: 'unobtainium' } };
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { ...source, landscapes: { types: [WALL, shoes, unknown], placements: [] } },
    });
    const toolWooden = sim.content.goods.find((good) => good.id === 'tool_wooden')?.typeId;
    if (toolWooden === undefined) throw new Error('fixture good');
    expect(setLandscape(sim.world, ctxOf(sim), POINT, 3, 3)).toBe(true);
    const [heap] = [...sim.world.query(Stockpile, LandscapeResource)];
    if (heap === undefined) throw new Error('heap laid');
    expect([...sim.world.get(heap, Stockpile).amounts]).toEqual([[toolWooden, 3]]);
    expect(sim.world.has(heap, ResourceFootprint)).toBe(false);
    expect(sim.landscapeEdits().added).toEqual([
      { id: 0, typeId: 3, ...POINT, level: 3, resourceBacked: true },
    ]);
    // The heap owns the placement: reaping it after the last pickup retires the placement with it.
    sim.world.destroy(heap);
    expect(sim.landscapeEdits().added).toEqual([]);
    // A good the world's content lacks cannot be laid, and leaves the world as it was.
    expect(setLandscape(sim.world, ctxOf(sim), POINT, 4, 1)).toBe(false);
    expect([...sim.world.query(Stockpile)]).toEqual([]);
  });

  it('evaluates landscape presence after a preceding mission removes the object', () => {
    const sim = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [],
          results: [{ opcode: 'RemoveLandscape', point: POINT }],
        },
        {
          active: true,
          visible: false,
          successfullIf: 3,
          goals: [{ opcode: 'IsAnyLandscapeOnPoint', point: POINT }],
          results: [{ opcode: 'Exit' }],
        },
      ],
      houseContent(),
      map(),
    );
    sim.run(LOAD_PASS);
    expect(sim.events.current().some((e) => e.kind === 'missionExit')).toBe(true);
  });
});
