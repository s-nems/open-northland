import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import {
  CurrentAtomic,
  GroundDrop,
  MoveGoal,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  Simulation,
  type TerrainMap,
  findPath,
  fx,
  halfCellMapFromCells,
  positionOfNode,
} from '../../src/index.js';
import type { CellId, TerrainGraph } from '../../src/nav/terrain.js';
import {
  type SystemContext,
  aiSystem,
  canPlaceBuilding,
  dynamicBlockedCells,
  resourceBlockedCells,
  resourceFootprintForGood,
  resourceWorkCell,
  stampResourceFootprint,
  unstampResourceFootprint,
} from '../../src/systems/index.js';

const GRASS = 0;
const WATER = 1;
const VIKING = 1;
const WOOD = 1;
const STONE = 4;
const MUSHROOM = 5;
const CLAY = 6;
const WOODCUTTER = 1;
const CLAY_DIGGER = 2;
const WOOD_ATOMIC = 24;
const STONE_ATOMIC = 25;
const MUSHROOM_ATOMIC = 32;
const CLAY_ATOMIC = 26;
const TREE_LOGIC = 100;
const STONE_LOGIC = 101;
const MUSHROOM_LOGIC = 102;
const CLAY_LOGIC = 103;
const TREE_GFX = 10;
const STONE_GFX = 11;
const MUSHROOM_GFX = 12;
const CLAY_GFX = 13;
const STONE_VARIANT_GFX = 14;
const TEST_HUT = 99;

const HUT_FOOTPRINT = {
  blocked: [{ dx: 0, dy: 0 }],
  familyBody: [{ dx: 0, dy: 0 }],
  reserved: [{ dx: 0, dy: 0 }],
  door: { dx: 0, dy: 1 },
};

function content(): ContentSet {
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'synthetic-resource-footprint-test' },
      locale: 'eng',
    },
    goods: [
      { typeId: 0, id: 'none' },
      {
        typeId: WOOD,
        id: 'wood',
        weight: 1,
        atomics: { harvest: WOOD_ATOMIC },
        gathering: { bioLandscape: true },
      },
      {
        typeId: STONE,
        id: 'stone',
        weight: 1,
        atomics: { harvest: STONE_ATOMIC },
        gathering: { bioLandscape: false },
      },
      {
        typeId: MUSHROOM,
        id: 'mushroom',
        weight: 1,
        atomics: { harvest: MUSHROOM_ATOMIC },
        gathering: { bioLandscape: true },
      },
      {
        typeId: CLAY,
        id: 'mud',
        weight: 1,
        atomics: { harvest: CLAY_ATOMIC },
        gathering: { bioLandscape: false },
      },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [WOOD_ATOMIC] },
      { typeId: CLAY_DIGGER, id: 'clay_digger', allowedAtomics: [CLAY_ATOMIC] },
    ],
    buildings: [{ typeId: TEST_HUT, id: 'test_hut', kind: 'house', footprint: HUT_FOOTPRINT }],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
      { typeId: TREE_LOGIC, id: 'tree_logic', walkable: true, buildable: true },
      { typeId: STONE_LOGIC, id: 'stone_logic', walkable: true, buildable: true },
      { typeId: MUSHROOM_LOGIC, id: 'mushroom_logic', walkable: true, buildable: true },
      { typeId: CLAY_LOGIC, id: 'clay_logic', walkable: true, buildable: true },
    ],
    landscapeGfx: [
      {
        index: TREE_GFX,
        editName: 'test tree',
        logicType: TREE_LOGIC,
        maxValency: 3,
        isWorkable: true,
        walkBlockAreas: [
          [1, 9, 9, 1],
          [3, 0, 0, 1],
        ],
        buildBlockAreas: [
          [1, 9, 9, 1],
          [3, -1, 0, 1],
          [3, 0, 0, 1],
          [3, 1, 0, 1],
        ],
        workAreas: [
          [3, -1, 0, 1],
          [3, 1, 0, 1],
        ],
      },
      {
        index: STONE_GFX,
        editName: 'test stone',
        logicType: STONE_LOGIC,
        maxValency: 4,
        isWorkable: true,
        walkBlockAreas: [[4, -1, 0, 3]],
        buildBlockAreas: [
          [4, -1, 0, 1],
          [4, 0, 0, 1],
          [4, 1, 0, 1],
        ],
        workAreas: [
          [4, -1, 0, 1],
          [4, 1, 0, 1],
        ],
      },
      {
        index: STONE_VARIANT_GFX,
        editName: 'test stone variant',
        logicType: STONE_LOGIC,
        maxValency: 4,
        isWorkable: true,
        walkBlockAreas: [[4, 2, 0, 1]],
        buildBlockAreas: [[4, 2, 0, 1]],
        workAreas: [[4, 2, 0, 1]],
      },
      {
        index: MUSHROOM_GFX,
        editName: 'test mushroom',
        logicType: MUSHROOM_LOGIC,
        maxValency: 1,
        isWorkable: true,
        walkBlockAreas: [],
        buildBlockAreas: [],
        workAreas: [[1, 0, 0, 1]],
      },
      {
        index: CLAY_GFX,
        editName: 'test clay',
        logicType: CLAY_LOGIC,
        maxValency: 2,
        isWorkable: true,
        walkBlockAreas: [],
        buildBlockAreas: [],
        workAreas: [
          [2, -1, 0, 1],
          [2, 0, 0, 1],
          [2, 1, 0, 1],
        ],
      },
    ],
    gatheringPipeline: [
      { goodType: WOOD, goodId: 'wood', harvest: { landscapeType: TREE_LOGIC, gfxIndices: [TREE_GFX] } },
      {
        goodType: STONE,
        goodId: 'stone',
        harvest: { landscapeType: STONE_LOGIC, gfxIndices: [STONE_GFX, STONE_VARIANT_GFX] },
      },
      {
        goodType: MUSHROOM,
        goodId: 'mushroom',
        harvest: { landscapeType: MUSHROOM_LOGIC, gfxIndices: [MUSHROOM_GFX] },
      },
      { goodType: CLAY, goodId: 'mud', harvest: { landscapeType: CLAY_LOGIC, gfxIndices: [CLAY_GFX] } },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: WOODCUTTER, atomicId: WOOD_ATOMIC, animation: 'viking_chop' },
          { jobType: CLAY_DIGGER, atomicId: CLAY_ATOMIC, animation: 'viking_dig' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'viking_chop', name: 'viking_chop', length: 3 },
      { id: 'viking_dig', name: 'viking_dig', length: 3 },
    ],
  });
}

function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) c.store.clear();
  }
}

beforeEach(clearStores);

function grassMap(width: number, height: number): TerrainMap {
  // Cell-dims signature; the sim's graph is the upsampled 2W×2H half-cell lattice. All scenario
  // coordinates below are NODE coords on that lattice (the LandscapeGfx area offsets always were —
  // the source's LogicWalkBlockArea/LogicBuildBlockArea address the original's 2W×2H grid).
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

function mappedSim(map: TerrainMap = grassMap(10, 5)): Simulation {
  return new Simulation({ seed: 1, content: content(), map });
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('mapped sim expected');
  return sim.terrain;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** A stamped resource node anchored at half-cell NODE (x,y). */
function placeResource(
  sim: Simulation,
  goodType: number,
  harvestAtomic: number,
  x: number,
  y: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Resource, { goodType, remaining: 3, harvestAtomic });
  expect(stampResourceFootprint(sim.world, sim.content, e, goodType)).toBe(true);
  return e;
}

/** A settler standing exactly on half-cell NODE (x,y). */
function placeSettler(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

function placeWoodcutter(sim: Simulation, x: number, y: number): Entity {
  return placeSettler(sim, WOODCUTTER, x, y);
}

/** A loose ground drop lying on half-cell NODE (x,y). */
function placeGroundDrop(sim: Simulation, goodType: number, amount: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, amount]]) });
  sim.world.add(e, GroundDrop, { goodType });
  return e;
}

function coords(terrain: TerrainGraph, path: readonly CellId[] | null): Array<{ x: number; y: number }> {
  if (path === null) return [];
  return path.map((cell) => terrain.coordsOf(cell));
}

describe('resource footprints', () => {
  it('derives walk/build/work cells from the harvest-stage LandscapeGfx full state', () => {
    const fp = resourceFootprintForGood(content(), WOOD);

    expect(fp?.sourceGfxIndex).toBe(TREE_GFX);
    expect(fp?.walk).toEqual([{ dx: 0, dy: 0 }]);
    expect(fp?.build).toEqual([
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
    expect(fp?.work).toEqual([
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
  });

  it('expands LandscapeGfx area runs along +x when deriving resource footprints', () => {
    const fp = resourceFootprintForGood(content(), STONE);

    expect(fp?.sourceGfxIndex).toBe(STONE_GFX);
    expect(fp?.walk).toEqual([
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
  });

  it('can stamp the specific LandscapeGfx variant used by a placed resource', () => {
    const sim = mappedSim(grassMap(7, 3));
    const terrain = terrainOf(sim);
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(2, 1)); // anchored at node (2,1)
    sim.world.add(e, Resource, { goodType: STONE, remaining: 3, harvestAtomic: STONE_ATOMIC });

    expect(stampResourceFootprint(sim.world, sim.content, e, STONE, STONE_VARIANT_GFX)).toBe(true);

    expect(sim.world.get(e, components.ResourceFootprint).sourceGfxIndex).toBe(STONE_VARIANT_GFX);
    const blocked = resourceBlockedCells(sim.world, terrain);
    expect(blocked.has(terrain.cellAt(4, 1))).toBe(true);
    expect(blocked.has(terrain.cellAt(1, 1))).toBe(false);
  });

  it('walk-blocks stamped resource bodies and updates the overlay incrementally after add/remove', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const tree = placeResource(sim, WOOD, WOOD_ATOMIC, 3, 1);

    const blocked = resourceBlockedCells(sim.world, terrain);
    expect(blocked.has(terrain.cellAt(3, 1))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    placeResource(sim, WOOD, WOOD_ATOMIC, 5, 1);
    expect(resourceBlockedCells(sim.world, terrain)).toBe(blocked);
    expect(blocked.has(terrain.cellAt(5, 1))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    unstampResourceFootprint(sim.world, tree);
    sim.world.destroy(tree);
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(resourceBlockedCells(sim.world, terrain)).toBe(blocked);
    expect(blocked.has(terrain.cellAt(3, 1))).toBe(false);
    expect(blocked.has(terrain.cellAt(5, 1))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('feeds the dynamic pathfinding overlay so routes avoid standing trees', () => {
    const sim = mappedSim(grassMap(5, 3));
    const terrain = terrainOf(sim);
    placeResource(sim, WOOD, WOOD_ATOMIC, 2, 1);

    const path = findPath(
      terrain,
      terrain.cellAt(0, 1),
      terrain.cellAt(4, 1),
      dynamicBlockedCells(sim.world, ctxOf(sim), terrain),
    );

    expect(path).not.toBeNull();
    expect(coords(terrain, path)).not.toContainEqual({ x: 2, y: 1 });
  });

  it('keeps non-blocking harvest patches traversable and workable on their anchor', () => {
    const sim = mappedSim(grassMap(5, 3));
    const terrain = terrainOf(sim);
    const mushroom = placeResource(sim, MUSHROOM, MUSHROOM_ATOMIC, 2, 1);

    const blocked = dynamicBlockedCells(sim.world, ctxOf(sim), terrain);

    expect(blocked.has(terrain.cellAt(2, 1))).toBe(false);
    expect(resourceWorkCell(sim.world, terrain, mushroom, terrain.cellAt(0, 1))).toBe(terrain.cellAt(2, 1));
  });

  it('keeps building bodies out of a resource build zone while allowing footprint-empty patches', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    placeResource(sim, WOOD, WOOD_ATOMIC, 5, 2);

    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, TEST_HUT, 4, 2)).toBe(false);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, TEST_HUT, 1, 2)).toBe(true);

    const patchSim = mappedSim();
    placeResource(patchSim, MUSHROOM, MUSHROOM_ATOMIC, 4, 2);
    expect(canPlaceBuilding(patchSim.world, ctxOf(patchSim), terrainOf(patchSim), TEST_HUT, 4, 2)).toBe(true);
  });

  it('targets the resource work cell in the planner instead of the blocked resource anchor', () => {
    const sim = mappedSim(grassMap(5, 3));
    const terrain = terrainOf(sim);
    const worker = placeWoodcutter(sim, 0, 1);
    const tree = placeResource(sim, WOOD, WOOD_ATOMIC, 2, 1);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(worker, CurrentAtomic)).toBe(false);
    expect(sim.world.get(worker, MoveGoal).cell).toBe(terrain.cellAt(1, 1));

    sim.world.remove(worker, MoveGoal);
    sim.world.remove(worker, PathRequest);
    Object.assign(sim.world.get(worker, Position), positionOfNode(1, 1)); // standing on the work node
    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(worker, MoveGoal)).toBe(false);
    expect(sim.world.get(worker, CurrentAtomic).targetEntity).toBe(tree);
  });

  it('collects a drop under a non-blocking deposit before starting another harvest', () => {
    const sim = mappedSim(grassMap(5, 3));
    const worker = placeSettler(sim, CLAY_DIGGER, 1, 1);
    const node = placeResource(sim, CLAY, CLAY_ATOMIC, 2, 1);
    const drop = placeGroundDrop(sim, CLAY, 1, 2, 1);

    expect(resourceWorkCell(sim.world, terrainOf(sim), node, terrainOf(sim).cellAt(1, 1))).toBe(
      terrainOf(sim).cellAt(1, 1),
    );

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(worker, CurrentAtomic);
    expect(atomic.atomicId).toBe(22);
    expect(atomic.targetEntity).toBe(drop);
    expect(atomic.effect.kind).toBe('pickup');
  });

  it('routes a ground drop under a resource by the stocked pickup good even if its marker diverges', () => {
    const sim = mappedSim(grassMap(5, 3));
    const worker = placeSettler(sim, CLAY_DIGGER, 1, 1);
    const node = placeResource(sim, CLAY, CLAY_ATOMIC, 2, 1);
    const drop = placeGroundDrop(sim, CLAY, 1, 2, 1);
    sim.world.get(drop, GroundDrop).goodType = STONE;

    expect(resourceWorkCell(sim.world, terrainOf(sim), node, terrainOf(sim).cellAt(1, 1))).toBe(
      terrainOf(sim).cellAt(1, 1),
    );

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(worker, CurrentAtomic);
    expect(atomic.atomicId).toBe(22);
    expect(atomic.targetEntity).toBe(drop);
    expect(atomic.effect.kind).toBe('pickup');
  });
});
