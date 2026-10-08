import { describe, expect, it } from 'vitest';
import { IdleStand, Owner, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { dropGroundPile } from '../../src/systems/settlers/atomics/effects/goods/piles.js';
import { grassCellMap } from '../fixtures/terrain.js';
import {
  builderAt,
  builtBuildingAt,
  constructionContent,
  HEADQUARTERS,
  HOUSE,
  STONE,
  siteAt,
  WOOD,
} from './construction-system/support.js';

const LOCAL = 0;
/** Past a builder's walk range from the site's door, with no signpost to stretch it. */
const BEYOND_REACH_X = 50;

function owned(sim: Simulation, e: Entity): Entity {
  sim.world.add(e, Owner, { player: LOCAL });
  return e;
}

describe('Simulation.workStatus - a builder', () => {
  it('names no site at all, then the goods the sites wait for that no own store holds', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassCellMap(64, 4) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const builder = owned(sim, builderAt(sim, 4, 2));
    // A busy builder is not diagnosed: it has a site.
    expect(sim.workStatus(builder)).toEqual({ kind: 'unknown', reason: 'constructionSearch' });
    sim.world.add(builder, IdleStand, { standing: true });
    expect(sim.workStatus(builder)).toEqual({ kind: 'noConstructionSite' });

    const site = owned(sim, siteAt(sim, HOUSE, 8, 1));
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    // A neutral trunk beyond the site's signpost reach is no source a builder would fetch from.
    dropGroundPile(sim.world, fx.fromInt(BEYOND_REACH_X), fx.fromInt(2), WOOD, 3);
    expect(sim.workStatus(builder)).toEqual({ kind: 'constructionShort', goodTypes: [WOOD] });
    expect(sim.constructionSupply(site)).toEqual({
      kind: 'short',
      shortfalls: [{ goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false }],
    });

    owned(sim, builtBuildingAt(sim, HEADQUARTERS, 0, 1, [[WOOD, 5]]));
    expect(sim.workStatus(builder)).toEqual({ kind: 'unknown', reason: 'constructionSearch' });
  });
});
