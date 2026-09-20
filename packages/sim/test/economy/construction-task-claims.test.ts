import { describe, expect, it, vi } from 'vitest';
import { Owner, Stockpile } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import * as construction from '../../src/systems/economy/construction.js';
import { ConstructionTaskClaims } from '../../src/systems/settlers/drives/economy/construction-task-claims.js';
import { PlannerSpacing } from '../../src/systems/settlers/planner/spacing.js';
import { plannerSystem } from '../../src/systems/settlers/planner/system.js';
import * as targets from '../../src/systems/settlers/targets/index.js';
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
  WOOD,
} from './construction-system/support.js';

describe('construction task claims', () => {
  it('reads a site hammer budget once per planner pass', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(12, 4) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    const demandReads = vi.spyOn(construction, 'remainingConstructionStrikes');
    const claims = new ConstructionTaskClaims(
      sim.world,
      ctxOf(sim),
      PlannerSpacing.forTick(sim.world, ctxOf(sim), terrain),
    );

    for (let i = 0; i < 32; i++) expect(claims.hasHammerWork(site)).toBe(true);

    expect(demandReads).toHaveBeenCalledTimes(1);
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
