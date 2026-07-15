import { describe, expect, it } from 'vitest';
import { Building, Stockpile } from '../../../src/components/index.js';
import { ONE, Simulation } from '../../../src/index.js';
import { constructionSystem, housingCapacity } from '../../../src/systems/index.js';

import {
  constructionContent,
  ctxOf,
  HEADQUARTERS,
  HOME_L0,
  HOME_L1,
  HOME_L2,
  levelChainContent,
  placeBuiltHome,
  STONE,
  upgradedEvents,
  VIKING,
  WOOD,
} from './support.js';

describe('constructionSystem — home level-up', () => {
  it('does NOT upgrade a built home missing the next tier cost', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 }); // L1 needs 2 stone; only 1 present
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L0); // unchanged
    expect(sim.world.get(e, Building).level).toBe(0);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1); // materials untouched
    expect(upgradedEvents(sim)).toHaveLength(0);
  });

  it('upgrades a built home once the next tier cost is present, consuming the materials', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 }); // L1 needs 2 stone
    constructionSystem(sim.world, ctxOf(sim));
    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L1); // adopted the larger tier
    expect(b.level).toBe(1);
    expect(b.built).toBe(ONE); // still built (it was already built; only the tier changed)
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0); // spent into the upgrade
    expect(upgradedEvents(sim)).toEqual([{ kind: 'buildingUpgraded', entity: e, level: 1 }]);
  });

  it('raises the tribe housing capacity by the new tier homeSize', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(1); // L0 shelters 1
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2
  });

  it('upgrades at most ONE tier per tick — the new tier cost is not present after the jump', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // Hold both L1's cost (2 stone) AND L2's cost (1 wood). One tick should advance exactly one tier:
    // after L0→L1 the stone is spent, and L2's cost (wood) is what L1 would need — present, so a SECOND
    // tick advances L1→L2. This guards against a within-tick double-upgrade (query yields each id once).
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2, [WOOD]: 1 });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1); // exactly one tier this tick
    expect(sim.world.get(e, Building).level).toBe(1);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L2); // second tick advances again
    expect(sim.world.get(e, Building).level).toBe(2);
  });

  it('never upgrades the top-tier home (no next typeId in the chain)', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // HOME_L2 is the top; even holding a pile of every good, there is no tier to upgrade into.
    const e = placeBuiltHome(sim, HOME_L2, 2, { [STONE]: 9, [WOOD]: 9 });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L2); // unchanged
    expect(sim.world.get(e, Building).level).toBe(2);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(9); // nothing consumed
    expect(upgradedEvents(sim)).toHaveLength(0);
  });

  it('does NOT upgrade a non-home built building even if it holds matching goods', () => {
    // A built workplace whose typeId+1 happens to be a home must NOT be treated as a home upgrade.
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeBuiltHome(sim, HEADQUARTERS, 0, { [STONE]: 9, [WOOD]: 9 }); // typeId 1, kind headquarters
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HEADQUARTERS); // unchanged — not a home
    expect(upgradedEvents(sim)).toHaveLength(0);
  });

  it('is deterministic — two same-seed upgrade runs reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 5, content: levelChainContent() });
      placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
