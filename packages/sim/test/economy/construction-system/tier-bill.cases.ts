import { describe, expect, it } from 'vitest';
import { Building, Stockpile, UnderConstruction } from '../../../src/components/index.js';
import { contentIndex } from '../../../src/core/content-index.js';
import { ONE, Simulation } from '../../../src/index.js';
import { constructionSystem, constructionTotalUnits, stockCapacity } from '../../../src/systems/index.js';

import {
  ctxOf,
  finishedEvents,
  fullyHammer,
  HOME_L0,
  HOME_L1,
  HOME_L2,
  levelChainContent,
  placeSite,
  STONE,
  WOOD,
} from './support.js';

/**
 * The FROM-SCRATCH construction bill of a home tier is CUMULATIVE — placing tier N directly costs
 * every chain stage 1..N (merged per good), never just tier N's own per-stage cost, so the direct
 * build is exactly as expensive (in materials, and — through the per-unit strike count — in builder
 * time) as building tier 1 and upgrading up. Source basis: the per-tier costs are extracted; the merge
 * is our design invariant — the original only upgrades homes, so pricing a direct tier-N placement at the
 * tier-1-then-upgrade total keeps it from undercutting that path. The chain fixture: L0 = 1 stone,
 * L1 = 2 stone, L2 = 1 wood — so L2 from scratch bills 3 stone + 1 wood.
 */
describe('constructionSystem — cumulative tier bill (a from-scratch home site pays every stage)', () => {
  it('merges the whole chain into the bill: tier N site sums stages 1..N per good, sorted', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const bills = contentIndex(sim.content).constructionBillByBuilding;
    expect(bills.get(HOME_L0)).toEqual([{ goodType: STONE, amount: 1 }]);
    expect(bills.get(HOME_L1)).toEqual([{ goodType: STONE, amount: 3 }]); // 1 + 2, merged
    expect(bills.get(HOME_L2)).toEqual([
      { goodType: STONE, amount: 3 },
      { goodType: WOOD, amount: 1 },
    ]);
  });

  it('a tier-1 site is NOT finished by its own per-stage cost — the base stage is still owed', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeSite(sim, HOME_L1, { [STONE]: 2 }); // tier 1's own cost — 1 stone short of the bill
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, UnderConstruction)).toBe(true); // still a site
    expect(finishedEvents(sim)).toHaveLength(0);
    // The bill's total units drive the strike count too — a tier-1 build takes 3 units of work, not 2.
    expect(constructionTotalUnits(sim.world, ctxOf(sim), e)).toBe(3);
  });

  it('a tier-1 site finishes on the cumulative bill and consumes all of it', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeSite(sim, HOME_L1, { [STONE]: 3 });
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0); // the whole chain's stone spent
  });

  it('a tier site advertises delivery room for the cumulative bill, not its own stage', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeSite(sim, HOME_L2);
    expect(stockCapacity(sim.world, ctxOf(sim), e, STONE)).toBe(3); // stages 1+2
    expect(stockCapacity(sim.world, ctxOf(sim), e, WOOD)).toBe(1); // stage 3
  });
});
