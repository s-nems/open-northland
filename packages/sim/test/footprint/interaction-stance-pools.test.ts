import { describe, expect, it, vi } from 'vitest';
import {
  Building,
  GroundDrop,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
} from '../../src/components/index.js';
import { writeLandscapeEdits } from '../../src/components/landscape.js';
import { fx, ONE, positionOfNode } from '../../src/index.js';
import { positionedStanceCells, resourceStanceCells } from '../../src/systems/footprint/interaction.js';
import { stampResourceFootprint, unstampResourceFootprint } from '../../src/systems/footprint/resources.js';
import { CLAY, STONE, STONE_ATOMIC, TEST_HUT, VIKING } from './resource-footprint/content.js';
import { ctxOf, mappedSim, placeGroundDrop, placeResource, terrainOf } from './resource-footprint/support.js';

describe('interaction stance pools', () => {
  it('rechecks moved or covered positioned targets', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const target = placeGroundDrop(sim, CLAY, 2, 6, 4);
    const pool = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(pool);
    sim.world.mut(target, Stockpile).amounts.set(CLAY, 1);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(pool);
    const position = sim.world.mut(target, Position);
    Object.assign(position, positionOfNode(8, 4));
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual([terrain.nodeAt(8, 4)]);
    const building = sim.world.create();
    sim.world.add(building, Position, positionOfNode(8, 4));
    sim.world.add(building, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual([]);
    sim.world.destroy(building);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual([terrain.nodeAt(8, 4)]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps held pools unchanged across overlay invalidation and target removal', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const target = placeGroundDrop(sim, CLAY, 2, 6, 4);
    const held = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(held).toEqual([terrain.nodeAt(6, 4)]);
    const building = sim.world.create();
    sim.world.add(building, Position, positionOfNode(6, 4));
    sim.world.add(building, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual([]);
    expect(held).toEqual([terrain.nodeAt(6, 4)]);
    sim.world.destroy(building);
    const other = placeGroundDrop(sim, CLAY, 1, 8, 4);
    positionedStanceCells(sim.world, ctxOf(sim), terrain, other);
    expect(sim.world.verifyCaches()).toEqual([]);
    const uncovered = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(uncovered).toEqual([terrain.nodeAt(6, 4)]);
    expect(uncovered).not.toBe(held);
    sim.world.destroy(target);
    const replacement = placeGroundDrop(sim, CLAY, 1, 10, 4);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, replacement)).toEqual([
      terrain.nodeAt(10, 4),
    ]);
    expect(held).toEqual([terrain.nodeAt(6, 4)]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('refreshes a drop when its good changes and its resource footprint disappears', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const resource = placeResource(sim, STONE, STONE_ATOMIC, 8, 4);
    const target = placeGroundDrop(sim, STONE, 1, 8, 4);
    const resourcePool = resourceStanceCells(sim.world, ctxOf(sim), terrain, resource);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(resourcePool);
    sim.world.mut(target, GroundDrop).goodType = CLAY;
    sim.world.mut(target, Stockpile).amounts = new Map([[CLAY, 1]]);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).not.toBe(resourcePool);
    unstampResourceFootprint(sim.world, resource);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual([terrain.nodeAt(8, 4)]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('rejoins a co-tile drop after its resource membership changes with the same footprint', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const resource = placeResource(sim, STONE, STONE_ATOMIC, 8, 4);
    const target = placeGroundDrop(sim, STONE, 1, 8, 4);
    const pool = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    sim.world.remove(resource, Resource);
    const without = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(without).not.toBe(pool);
    sim.world.add(resource, Resource, { goodType: STONE, remaining: 3, harvestAtomic: STONE_ATOMIC });
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(pool);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

describe('stance validation work', () => {
  it('shares a resource pool while a drop keeps its selected good', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const resource = placeResource(sim, STONE, STONE_ATOMIC, 8, 4);
    const target = placeGroundDrop(sim, STONE, 2, 8, 4);
    const pool = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toBe(pool);
    sim.world.mut(target, Stockpile).amounts.set(STONE, 1);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toBe(pool);
    sim.world.mut(target, Stockpile).amounts.set(STONE, 0);
    sim.world.mut(target, GroundDrop).goodType = CLAY;
    const changed = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(changed).not.toBe(pool);
    expect(pool).toEqual(resourceStanceCells(sim.world, ctxOf(sim), terrain, resource));
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('preserves resource arrays through unrelated drop writes and refreshes footprint writes', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const resource = placeResource(sim, STONE, STONE_ATOMIC, 8, 4);
    const held = resourceStanceCells(sim.world, ctxOf(sim), terrain, resource);
    const before = [...held];
    sim.world.add(resource, GroundDrop, { goodType: CLAY });
    sim.world.add(resource, Stockpile, { amounts: new Map([[CLAY, 1]]) });
    expect(resourceStanceCells(sim.world, ctxOf(sim), terrain, resource)).toBe(held);
    sim.world.add(resource, ResourceFootprint, {
      ...sim.world.get(resource, ResourceFootprint),
      work: [{ dx: 4, dy: 0 }],
    });
    expect(sim.world.verifyCaches()).toEqual([]);
    const updated = resourceStanceCells(sim.world, ctxOf(sim), terrain, resource);
    expect(updated).not.toBe(held);
    expect(updated).toEqual([terrain.nodeAt(12, 4)]);
    expect(held).toEqual(before);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('retains pools through construction progress and refreshes topology changes', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const target = placeResource(sim, STONE, STONE_ATOMIC, 8, 4);
    const building = sim.world.create();
    sim.world.add(building, Position, positionOfNode(14, 4));
    sim.world.add(building, Building, {
      buildingType: TEST_HUT,
      tribe: VIKING,
      built: fx.fromInt(0),
      level: 0,
    });
    const held = resourceStanceCells(sim.world, ctxOf(sim), terrain, target);
    sim.world.mut(building, Building).built = ONE;
    expect(resourceStanceCells(sim.world, ctxOf(sim), terrain, target)).toBe(held);
    writeLandscapeEdits(sim.world, (state) => {
      state.topologyRevision++;
    });
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(resourceStanceCells(sim.world, ctxOf(sim), terrain, target)).not.toBe(held);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('reuses the removal subscription across terrain and content changes', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const target = placeResource(sim, STONE, STONE_ATOMIC, 8, 4);
    const watches = vi.spyOn(sim.world, 'watchChanges');
    resourceStanceCells(sim.world, ctxOf(sim), terrain, target);
    const other = mappedSim();
    resourceStanceCells(sim.world, ctxOf(other), terrainOf(other), target);
    resourceStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(watches.mock.calls.filter(([members]) => members.includes(Position))).toHaveLength(1);
    watches.mockRestore();
    const held = resourceStanceCells(sim.world, ctxOf(sim), terrain, target);
    const before = [...held];
    unstampResourceFootprint(sim.world, target);
    sim.world.remove(target, Position);
    expect(sim.world.verifyCaches()).toEqual([]);
    sim.world.add(target, Position, positionOfNode(10, 4));
    expect(stampResourceFootprint(sim.world, sim.content, target, STONE)).toBe(true);
    const moved = resourceStanceCells(sim.world, ctxOf(sim), terrain, target);
    expect(moved).not.toBe(held);
    expect(moved).not.toEqual(before);
    expect(held).toEqual(before);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
