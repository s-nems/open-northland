import { RESOURCE_YIELD_GOODS } from '@open-northland/data';
import { components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { GATHERERS } from '../../../src/game/sandbox/ids/index.js';
import { hasRealIr } from '../helpers.js';
import { realMapSessionWorld } from '../real-map-world.js';

/** A map that places every good the two rules cover: trees, mushrooms, clay, stone, iron and gold. */
const SEARCH = 'map=specjalna_forteca&player=4&missions=off&seed=7';
const BASIC_FACTOR = 2;
const ORE_FACTOR = 3;

/** The stock of the good's nodes the map itself places, by their placement join. */
function placedStock(sim: Simulation, good: string): number {
  const type = sim.content.goods.find((g) => g.id === good)?.typeId;
  if (type === undefined) throw new Error(`no good ${good}`);
  let total = 0;
  for (const e of sim.world.query(components.Resource, components.LandscapeResource)) {
    const resource = sim.world.get(e, components.Resource);
    if (resource.goodType === type) total += resource.remaining;
  }
  return total;
}

describe.runIf(hasRealIr())('the resource richness rules', () => {
  it('cover only goods a map deposit spawns as', () => {
    const gathered = new Set(GATHERERS.map((g) => g.id));
    const covered = [...RESOURCE_YIELD_GOODS.basic, ...RESOURCE_YIELD_GOODS.ore];
    expect(covered.filter((good) => !gathered.has(good))).toEqual([]);
  });

  it('start every map-placed node of a covered good at its group factor', async () => {
    const [authored, richer] = await Promise.all([
      realMapSessionWorld(`?${SEARCH}`),
      realMapSessionWorld(`?${SEARCH}&basicyield=${BASIC_FACTOR}&oreyield=${ORE_FACTOR}`),
    ]);
    const groups = [
      [RESOURCE_YIELD_GOODS.basic, BASIC_FACTOR],
      [RESOURCE_YIELD_GOODS.ore, ORE_FACTOR],
    ] as const;
    for (const [goods, factor] of groups) {
      for (const good of goods) {
        expect(placedStock(authored, good), good).toBeGreaterThan(0);
        expect(placedStock(richer, good), good).toBe(placedStock(authored, good) * factor);
      }
    }
  });
});
