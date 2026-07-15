import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import {
  CurrentAtomic,
  GroundDrop,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Resource,
} from '../../src/components/index.js';
import { findPath, positionOfNode } from '../../src/index.js';
import {
  aiSystem,
  canPlaceBuilding,
  dynamicBlockedCells,
  resourceBlockedCells,
  resourceFootprintForGood,
  resourceWorkCell,
  stampResourceFootprint,
  unstampResourceFootprint,
} from '../../src/systems/index.js';
import {
  CLAY,
  CLAY_ATOMIC,
  CLAY_DIGGER,
  content,
  MUSHROOM,
  MUSHROOM_ATOMIC,
  STONE,
  STONE_ATOMIC,
  STONE_GFX,
  STONE_VARIANT_GFX,
  TEST_HUT,
  TREE_GFX,
  VIKING,
  WOOD,
  WOOD_ATOMIC,
} from './resource-footprint/content.js';
import {
  coords,
  ctxOf,
  grassMap,
  mappedSim,
  placeGroundDrop,
  placeResource,
  placeSettler,
  placeWoodcutter,
  terrainOf,
} from './resource-footprint/support.js';

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
    expect(blocked.has(terrain.nodeAt(4, 1))).toBe(true);
    expect(blocked.has(terrain.nodeAt(1, 1))).toBe(false);
  });

  it('walk-blocks stamped resource bodies and updates the overlay incrementally after add/remove', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const tree = placeResource(sim, WOOD, WOOD_ATOMIC, 3, 1);

    const blocked = resourceBlockedCells(sim.world, terrain);
    expect(blocked.has(terrain.nodeAt(3, 1))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    placeResource(sim, WOOD, WOOD_ATOMIC, 5, 1);
    expect(resourceBlockedCells(sim.world, terrain)).toBe(blocked);
    expect(blocked.has(terrain.nodeAt(5, 1))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    unstampResourceFootprint(sim.world, tree);
    sim.world.destroy(tree);
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(resourceBlockedCells(sim.world, terrain)).toBe(blocked);
    expect(blocked.has(terrain.nodeAt(3, 1))).toBe(false);
    expect(blocked.has(terrain.nodeAt(5, 1))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('feeds the dynamic pathfinding overlay so routes avoid standing trees', () => {
    const sim = mappedSim(grassMap(5, 3));
    const terrain = terrainOf(sim);
    placeResource(sim, WOOD, WOOD_ATOMIC, 2, 1);

    const path = findPath(
      terrain,
      terrain.nodeAt(0, 1),
      terrain.nodeAt(4, 1),
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

    expect(blocked.has(terrain.nodeAt(2, 1))).toBe(false);
    expect(resourceWorkCell(sim.world, terrain, mushroom, terrain.nodeAt(0, 1))).toBe(terrain.nodeAt(2, 1));
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
    expect(sim.world.get(worker, MoveGoal).cell).toBe(terrain.nodeAt(1, 1));

    sim.world.remove(worker, MoveGoal);
    sim.world.remove(worker, PathRequest);
    Object.assign(sim.world.get(worker, Position), positionOfNode(1, 1)); // standing on the work node
    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(worker, MoveGoal)).toBe(false);
    expect(sim.world.get(worker, CurrentAtomic).targetEntity).toBe(tree);
  });

  it('sends a unit ORDERED onto a resource to the nearest reachable node instead of stalling it', () => {
    // The reported bug: accidentally right-clicking a tree left the unit standing still, because the
    // resource walk body makes its anchor an unreachable goal (findPath rejects an occupied goal).
    // moveUnit must snap such a goal to the nearest standable node so the unit walks to the tree's edge.
    const sim = mappedSim(grassMap(8, 5));
    const terrain = terrainOf(sim);
    const worker = placeWoodcutter(sim, 0, 2);
    sim.world.add(worker, Owner, { player: VIKING });
    placeResource(sim, WOOD, WOOD_ATOMIC, 4, 2); // walk cell = its own anchor node (4,2)
    const treeNode = terrain.nodeAt(4, 2);
    const startX = sim.world.get(worker, Position).x;

    sim.enqueue({ kind: 'moveUnit', entity: worker, x: 4, y: 2 }); // right on the tree body
    sim.step();

    const goal = sim.world.get(worker, MoveGoal).cell;
    expect(goal).not.toBe(treeNode); // snapped off the blocked anchor
    expect(terrain.isWalkable(goal)).toBe(true);
    expect(dynamicBlockedCells(sim.world, ctxOf(sim), terrain).has(goal)).toBe(false);
    expect(terrain.neighbours(treeNode)).toContain(goal); // the nearest node — a neighbour of the tree
    expect(sim.world.has(worker, PlayerOrder)).toBe(true); // the order took (was not refused)

    sim.run(30);
    expect(sim.world.get(worker, Position).x).toBeGreaterThan(startX); // walked toward the tree, not frozen
  });

  it('leaves an ordered goal on open ground exactly where the player clicked (no snap)', () => {
    const sim = mappedSim(grassMap(8, 5));
    const terrain = terrainOf(sim);
    const worker = placeWoodcutter(sim, 0, 2);
    sim.world.add(worker, Owner, { player: VIKING });

    sim.enqueue({ kind: 'moveUnit', entity: worker, x: 5, y: 2 }); // open grass
    sim.step();

    expect(sim.world.get(worker, MoveGoal).cell).toBe(terrain.nodeAt(5, 2)); // untouched — fast path
  });

  it('collects a drop under a non-blocking deposit before starting another harvest', () => {
    const sim = mappedSim(grassMap(5, 3));
    // The digger stands ON the clay anchor — a walkable deposit that lists its own anchor as a work
    // cell is worked from the anchor (the original's clay digger squarely on the pit), so the work
    // cell resolves to the anchor even for a settler approaching from the side.
    const worker = placeSettler(sim, CLAY_DIGGER, 2, 1);
    const node = placeResource(sim, CLAY, CLAY_ATOMIC, 2, 1);
    const drop = placeGroundDrop(sim, CLAY, 1, 2, 1);

    expect(resourceWorkCell(sim.world, terrainOf(sim), node, terrainOf(sim).nodeAt(1, 1))).toBe(
      terrainOf(sim).nodeAt(2, 1),
    );

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(worker, CurrentAtomic);
    expect(atomic.atomicId).toBe(22);
    expect(atomic.targetEntity).toBe(drop);
    expect(atomic.effect.kind).toBe('pickup');
  });

  it('routes a ground drop under a resource by the stocked pickup good even if its marker diverges', () => {
    const sim = mappedSim(grassMap(5, 3));
    const worker = placeSettler(sim, CLAY_DIGGER, 2, 1);
    const node = placeResource(sim, CLAY, CLAY_ATOMIC, 2, 1);
    const drop = placeGroundDrop(sim, CLAY, 1, 2, 1);
    sim.world.get(drop, GroundDrop).goodType = STONE;

    expect(resourceWorkCell(sim.world, terrainOf(sim), node, terrainOf(sim).nodeAt(1, 1))).toBe(
      terrainOf(sim).nodeAt(2, 1),
    );

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(worker, CurrentAtomic);
    expect(atomic.atomicId).toBe(22);
    expect(atomic.targetEntity).toBe(drop);
    expect(atomic.effect.kind).toBe('pickup');
  });
});
