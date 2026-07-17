import { describe, expect, it } from 'vitest';
import { Residence } from '../../../src/components/family.js';
import { Building, Stockpile, UnderConstruction, Upgrading } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { constructionSystem, housingCapacity, stockCapacity } from '../../../src/systems/index.js';

import {
  ctxOf,
  HOME_L0,
  HOME_L1,
  HOME_L2,
  levelChainContent,
  placeBuiltHome,
  STONE,
  upgradedEvents,
  VIKING,
} from './support.js';

/**
 * The MANUAL upgrade lifecycle (the `upgradeBuilding` command): a built chained building re-opens as a
 * construction site — inventory stashed into `Upgrading.savedStock`, the emptied stockpile a separate
 * build hold, `built` back to 0 (housing/production suspend) — is delivered + hammered at the TARGET
 * tier's own cost (the level difference), and finishes by adopting the target tier, restoring the
 * stash, and emitting `buildingUpgraded`. Source basis: observed original behavior (upgrade re-opens
 * the building as a site with its own build store; occupants keep their bindings).
 */
describe('constructionSystem — manual upgrade lifecycle', () => {
  it('the upgrade command re-opens a built home as a site, stashing its inventory into a separate hold', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 }); // 1 stone of household inventory
    sim.enqueue({ kind: 'upgradeBuilding', building: e });
    sim.step();

    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L0); // still the old tier while the site rises
    expect(b.built).toBe(0); // a site again — production/housing suspended
    expect(sim.world.has(e, UnderConstruction)).toBe(true);
    // The pre-upgrade inventory is stashed; the stockpile is a fresh, empty build hold.
    expect(sim.world.get(e, Upgrading).savedStock.get(STONE)).toBe(1);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
  });

  it('an upgrade site bills only the DIFFERENCE — the target tier own cost, not the cumulative bill', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0);
    sim.enqueue({ kind: 'upgradeBuilding', building: e });
    sim.step();
    // L1's own cost is 2 stone; the cumulative from-scratch L1 bill would be 3. The site advertises 2.
    expect(stockCapacity(sim.world, ctxOf(sim), e, STONE)).toBe(2);
  });

  it('suspends housing while upgrading and completes into the target tier, restoring the stash', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 }); // household inventory to stash
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(1); // L0 shelters 1
    sim.enqueue({ kind: 'upgradeBuilding', building: e });
    sim.step();
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(0); // a site shelters no one

    // Deliver the difference (L1's 2 stone) and hammer the site out by hand.
    sim.world.get(e, Stockpile).amounts.set(STONE, 2);
    sim.world.get(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));

    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L1); // adopted the target tier
    expect(b.level).toBe(1);
    expect(b.built).toBe(ONE);
    expect(sim.world.has(e, UnderConstruction)).toBe(false);
    expect(sim.world.has(e, Upgrading)).toBe(false);
    // The 2-stone cost was consumed; the stashed household stone came back.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2
    expect(upgradedEvents(sim)).toEqual([{ kind: 'buildingUpgraded', entity: e, level: 1 }]);
  });

  it('residents keep their Residence through the whole upgrade — occupants are not evicted from the books', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0);
    const resident = sim.world.create();
    sim.world.add(resident, Residence, { home: e });
    sim.enqueue({ kind: 'upgradeBuilding', building: e });
    sim.step();
    expect(sim.world.get(resident, Residence).home).toBe(e); // kept while the site rises
    sim.world.get(e, Stockpile).amounts.set(STONE, 2);
    sim.world.get(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resident, Residence).home).toBe(e); // and after completion
  });

  it('skips a top-tier home, an unbuilt site, and a double-upgrade — recoverable no-ops', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // Top tier: no upgradeTarget — nothing to rise into.
    const top = placeBuiltHome(sim, HOME_L2, 2, { [STONE]: 9 });
    sim.enqueue({ kind: 'upgradeBuilding', building: top });
    // An unbuilt from-scratch site: not a built building yet.
    const site = sim.world.create();
    sim.world.add(site, Building, { buildingType: HOME_L0, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, Stockpile, { amounts: new Map<number, number>() });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.enqueue({ kind: 'upgradeBuilding', building: site });
    // A double-upgrade: the second command lands on an already-open upgrade site.
    const home = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 });
    sim.enqueue({ kind: 'upgradeBuilding', building: home });
    sim.enqueue({ kind: 'upgradeBuilding', building: home });
    sim.step();

    expect(sim.world.has(top, Upgrading)).toBe(false);
    expect(sim.world.get(top, Stockpile).amounts.get(STONE)).toBe(9); // inventory untouched
    expect(sim.world.has(site, Upgrading)).toBe(false);
    // The double-upgrade opened ONE site; the stash still holds exactly the pre-upgrade inventory.
    expect(sim.world.get(home, Upgrading).savedStock.get(STONE)).toBe(1);
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
  });

  it('advances one tier per completed upgrade — reaching L2 takes a second command', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0);
    sim.enqueue({ kind: 'upgradeBuilding', building: e });
    sim.step();
    sim.world.get(e, Stockpile).amounts.set(STONE, 2);
    sim.world.get(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // finished — not rolling into L2 by itself
    expect(sim.world.get(e, Building).built).toBe(ONE);
  });

  it('is deterministic — two same-seed upgrade runs reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 5, content: levelChainContent() });
      const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 });
      sim.enqueue({ kind: 'upgradeBuilding', building: e });
      sim.step();
      sim.world.get(e, Stockpile).amounts.set(STONE, 2);
      sim.world.get(e, UnderConstruction).labor = ONE;
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
