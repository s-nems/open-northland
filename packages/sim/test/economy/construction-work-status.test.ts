import { describe, expect, it } from 'vitest';
import { Owner, Stockpile } from '../../src/components/index.js';
import { fx, Simulation } from '../../src/index.js';
import { dropGroundPile } from '../../src/systems/settlers/atomics/effects/goods/piles.js';
import {
  builderAt,
  builtBuildingAt,
  constructionContent,
  grassMap,
  HEADQUARTERS,
  HOUSE,
  STONE,
  siteAt,
  WOOD,
} from './construction-system/support.js';

const LOCAL = 0;

function owned(sim: Simulation, e: number): number {
  sim.world.add(e, Owner, { player: LOCAL });
  return e;
}

describe('Simulation.workStatus - a builder', () => {
  it('names no site at all, then the goods the sites wait for that no own store holds', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(40, 4) });
    const builder = owned(sim, builderAt(sim, 4, 2));
    expect(sim.workStatus(builder)).toEqual({ kind: 'noConstructionSite' });

    const site = owned(sim, siteAt(sim, HOUSE, 8, 1));
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    // A neutral trunk lying far off is nobody's store.
    dropGroundPile(sim.world, fx.fromInt(36), fx.fromInt(2), WOOD, 3);
    expect(sim.workStatus(builder)).toEqual({ kind: 'constructionShort', goodTypes: [WOOD] });
    expect(sim.constructionSupply(site)).toEqual({
      kind: 'short',
      shortfalls: [{ goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false }],
    });

    owned(sim, builtBuildingAt(sim, HEADQUARTERS, 0, 1, [[WOOD, 5]]));
    expect(sim.workStatus(builder)).toEqual({ kind: 'unknown', reason: 'constructionSearch' });
  });
});
