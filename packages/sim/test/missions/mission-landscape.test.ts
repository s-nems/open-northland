import { describe, expect, it } from 'vitest';
import { LandscapeResource, Resource, ResourceFootprint, Stockpile } from '../../src/components/index.js';
import { landscapeEditState } from '../../src/components/landscape.js';
import { exportSaveGame, findPath, parseSaveGame, restoreSimulation, Simulation } from '../../src/index.js';
import { dynamicBlockOverlay, placementProbe, routeRegions } from '../../src/systems/footprint/index.js';
import { placementGridRebuilds } from '../../src/systems/footprint/placement/blocker-grid.js';
import { createResourceNode } from '../../src/systems/footprint/resources.js';
import {
  removeLandscapes,
  setBuildForbidden,
  setLandscape,
  setVertexColors,
} from '../../src/systems/landscape/edits.js';
import { landscapeBlocks, landscapesWithin } from '../../src/systems/landscape/view.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { ctxOf } from '../fixtures/context.js';
import { fresh, map, POINT, terrainOf, WALL } from './landscape-support.js';
import { HUT, houseContent, LOAD_PASS, missionSim } from './support.js';

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
    expect(placementProbe(sim.world, sim.content, terrain, HUT, []).canPlace(10, 8)).toBe(false);
    expect(setLandscape(sim.world, ctx, { hx: 7, hy: 8 }, 1, 0)).toBe(true);
    const doubled = landscapeBlocks(sim.world, terrain);
    expect(doubled.walk.has(shared)).toBe(true);
    removeLandscapes(sim.world, terrain, POINT, 0);
    const halved = landscapeBlocks(sim.world, terrain);
    expect(halved.walk.has(shared)).toBe(true);
    expect(halved.walk.has(terrain.nodeAt(9, 8))).toBe(false);
    removeLandscapes(sim.world, terrain, { hx: 7, hy: 8 }, 0);
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
    expect(placementProbe(sim.world, sim.content, terrain, HUT, []).canPlace(10, 8)).toBe(true);
    expect(placementGridRebuilds(sim.world)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('catches the grid up over edits it never read, and re-reads once the chain is let go', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const probe = () => placementProbe(sim.world, sim.content, terrain, HUT, []);
    expect(probe().canPlace(10, 8)).toBe(false);
    // Three edits with no read of the layer between them: one catch-up carries all of them.
    removeLandscapes(sim.world, terrain, POINT, 0);
    expect(setLandscape(sim.world, ctx, { hx: 3, hy: 3 }, 1, 0)).toBe(true);
    expect(setLandscape(sim.world, ctx, { hx: 12, hy: 12 }, 1, 0)).toBe(true);
    expect(probe().canPlace(10, 8)).toBe(true);
    expect(probe().canPlace(5, 3)).toBe(false);
    expect(placementGridRebuilds(sim.world)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
    // Far more edits than the layer keeps linked: the grid's chain breaks and it re-reads the layer.
    for (let i = 0; i < 300; i++) {
      removeLandscapes(sim.world, terrain, { hx: 12, hy: 12 }, 0);
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
    removeLandscapes(sim.world, terrain, { hx: 5, hy: 5 }, 0);
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
    expect(placementProbe(sim.world, sim.content, terrain, HUT, []).canPlace(10, 8)).toBe(false);
    removeLandscapes(sim.world, terrain, POINT, 0);
    expect(dynamicBlockOverlay(sim.world, ctx, terrain).has(node)).toBe(false);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, []).canPlace(10, 8)).toBe(true);
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
    removeLandscapes(sim.world, terrain, { hx: 8, hy: 4 }, 0);
    expect(regions.unroutable(from, to)).toBe(false);
    expect(findPath(terrain, from, to, dynamicBlockOverlay(sim.world, ctx, terrain))).not.toBeNull();
  });

  it('replaces all objects at an anchor and filters removals by the catalog group', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    removeLandscapes(sim.world, terrain, POINT, 100, 'smoke');
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
    expect(placementProbe(sim.world, sim.content, terrain, HUT, []).canPlace(3, 3)).toBe(false);
    setBuildForbidden(sim.world, terrain, { hx: 3, hy: 3 }, 3, false);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, []).canPlace(3, 3)).toBe(true);
    setVertexColors(sim.world, terrain, POINT, 1_000_000_000, 100, false);
    setVertexColors(sim.world, terrain, POINT, 1_000_000_000, 200, true);
    expect(sim.landscapeEdits().tints).toHaveLength(256);
    expect(sim.landscapeEdits().tints.every((t) => t.value === (t.hx < 8 ? 200 : 100))).toBe(true);
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
    const probe = () => placementProbe(restored.world, restored.content, restoredTerrain, HUT, []);
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
    removeLandscapes(sim.world, terrainOf(sim), POINT, 0, undefined, (entity) => removed.push(entity));
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
