import { halfCellMapFromCells, Simulation, TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import { GOOD_MUD, GOOD_STONE, GOOD_WOOD, JOB_COLLECTOR } from '../src/game/sandbox/ids/index.js';
import { resourceCommand } from '../src/game/sandbox/place/index.js';

const MIN_HARVEST_TICKS = 20 * TICKS_PER_SECOND;
const MAX_HARVEST_TICKS = 25 * TICKS_PER_SECOND;

function firstYield(good: number): { readonly ticks: number; readonly units: number } {
  const terrain = grassTerrain(8, 8);
  const sim = new Simulation({
    seed: 1,
    content: sandboxContent(terrain),
    map: halfCellMapFromCells(terrain),
  });
  const resource = resourceCommand(good, 8, 8);
  if (resource === null) throw new Error(`missing gatherer for good ${good}`);
  sim.enqueue(resource);
  sim.enqueue({
    kind: 'spawnSettler',
    jobType: JOB_COLLECTOR,
    x: 8,
    y: 8,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });

  for (let ticks = 1; ticks <= MAX_HARVEST_TICKS * 3; ticks++) {
    sim.step();
    for (const event of sim.events.current()) {
      if (event.kind === 'resourceFelled' && event.goodType === good) return { ticks, units: event.amount };
      if (event.kind === 'resourceMined' && event.goodType === good) return { ticks, units: 1 };
    }
  }
  throw new Error(`good ${good} produced no yield within ${MAX_HARVEST_TICKS * 3} ticks`);
}

describe('resource harvest cadence at 1x', () => {
  it.each([
    ['wood', GOOD_WOOD],
    ['stone', GOOD_STONE],
    ['clay', GOOD_MUD],
  ] as const)('%s averages 20–25 seconds of work per yielded unit', (_name, good) => {
    const yieldResult = firstYield(good);
    const ticksPerUnit = yieldResult.ticks / yieldResult.units;
    expect(ticksPerUnit).toBeGreaterThanOrEqual(MIN_HARVEST_TICKS);
    expect(ticksPerUnit).toBeLessThanOrEqual(MAX_HARVEST_TICKS);
  });
});
