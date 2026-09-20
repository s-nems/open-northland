import { describe, expect, it, vi } from 'vitest';
import { Owner, Stockpile, UnderConstruction } from '../../src/components/index.js';
import { type Fixed, Simulation } from '../../src/index.js';
import { ConstructionTaskClaims } from '../../src/systems/settlers/drives/economy/construction-task-claims.js';
import { plannerSystem } from '../../src/systems/settlers/planner/system.js';
import * as targets from '../../src/systems/settlers/targets/index.js';
import { deliveredConstructionFraction } from '../../src/systems/stores/index.js';
import {
  builderAt,
  builtBuildingAt,
  constructionContent,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  HOUSE,
  STONE,
  siteAt,
} from './construction-system/support.js';

describe('construction task claims', () => {
  it('hands out no more hammer strikes than the delivered material can absorb', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(12, 4) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    const delivered = deliveredConstructionFraction(sim.world, ctxOf(sim), site);
    // One quantum short of the delivered cap leaves exactly one strike.
    sim.world.mut(site, UnderConstruction).labor = (delivered - 1) as Fixed;
    const claims = new ConstructionTaskClaims(sim.world, ctxOf(sim));

    expect(claims.hasHammerClaim(site)).toBe(false);
    expect(claims.claimHammer(site)).toBe(true);
    expect(claims.hasHammerClaim(site)).toBe(true);
    expect(claims.hasHammerWork(site)).toBe(false);
    expect(claims.claimHammer(site)).toBe(false);
  });

  it('searches a material source once per good while rejecting many sites with no eligible source', () => {
    const sim = new Simulation({ seed: 2, content: constructionContent(), map: grassMap(36, 16) });
    for (let i = 0; i < 24; i++) siteAt(sim, HOUSE, 3 + (i % 8) * 4, 2 + Math.floor(i / 8) * 5);
    const enemyStore = builtBuildingAt(sim, HEADQUARTERS, 34, 14, [[STONE, 10]]);
    sim.world.add(enemyStore, Owner, { player: 1 });
    const builder = builderAt(sim, 1, 1);
    sim.world.add(builder, Owner, { player: 0 });
    const sourceSearches = vi.spyOn(targets, 'nearestStoreHolding');

    plannerSystem(sim.world, ctxOf(sim));

    expect(sourceSearches).toHaveBeenCalledTimes(1);
  });
});
