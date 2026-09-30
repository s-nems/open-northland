import { expect, it } from 'vitest';
import { ResourceFootprint, Stockpile } from '../../src/components/index.js';
import { positionedStanceCells, resourceStanceCells } from '../../src/systems/footprint/interaction.js';
import { CLAY, CLAY_ATOMIC, STONE } from './resource-footprint/content.js';
import { ctxOf, mappedSim, placeGroundDrop, placeResource, terrainOf } from './resource-footprint/support.js';

it('selects the smallest positive stocked good and falls back to the drop good', () => {
  const sim = mappedSim();
  const terrain = terrainOf(sim);
  const resource = placeResource(sim, CLAY, CLAY_ATOMIC, 8, 4);
  sim.world.add(resource, ResourceFootprint, {
    walk: [],
    build: [],
    work: [{ dx: 2, dy: 0 }],
  });
  const target = placeGroundDrop(sim, CLAY, 1, 8, 4);
  const resourcePool = resourceStanceCells(sim.world, ctxOf(sim), terrain, resource);
  expect(resourcePool).toEqual([terrain.nodeAt(10, 4)]);
  sim.world.mut(target, Stockpile).amounts = new Map([
    [CLAY, 1],
    [STONE, 1],
  ]);
  const minimum = positionedStanceCells(sim.world, ctxOf(sim), terrain, target);
  expect(minimum).toEqual([terrain.nodeAt(8, 4)]);
  sim.world.mut(target, Stockpile).amounts = new Map([
    [STONE, 1],
    [CLAY, 1],
  ]);
  expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(minimum);
  for (const stoneAmount of [0, -1]) {
    sim.world.mut(target, Stockpile).amounts = new Map([
      [STONE, stoneAmount],
      [CLAY, 1],
    ]);
    expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(resourcePool);
  }
  sim.world.mut(target, Stockpile).amounts = new Map([
    [STONE, -1],
    [CLAY, 0],
  ]);
  expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(resourcePool);
  sim.world.mut(target, Stockpile).amounts.clear();
  expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(resourcePool);
  sim.world.remove(target, Stockpile);
  expect(positionedStanceCells(sim.world, ctxOf(sim), terrain, target)).toEqual(resourcePool);
  expect(sim.world.verifyCaches()).toEqual([]);
});
