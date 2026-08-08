import { describe, expect, it } from 'vitest';
import { Residence } from '../../../src/components/family.js';
import {
  Building,
  DefenceMode,
  Owner,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { housingCapacity } from '../../../src/simulation/hud.js';
import { constructionSystem, stockCapacity } from '../../../src/systems/index.js';

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
  WOOD,
} from './support.js';

/**
 * The MANUAL upgrade lifecycle (the `upgradeBuilding` command): a built chained building re-opens as a
 * construction site - inventory stashed into `Upgrading.savedStock` except bill goods, which seed the
 * build hold (see the `Upgrading` component doc for the why) - is delivered + hammered at the TARGET
 * tier's own cost (the level difference), and finishes by adopting the target tier, restoring the
 * stash, and emitting `buildingUpgraded`. Source basis: observed original behavior (upgrade re-opens
 * the building as a site with its own build store; occupants keep their bindings); own goods counting
 * toward the upgrade is a named approximation.
 */
describe('constructionSystem - manual upgrade lifecycle', () => {
  it('takes a raised alarm down with the roof', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
    sim.world.add(e, Owner, { player: 1 }); // only an owned building takes the order
    sim.enqueueSetup({ kind: 'setDefenceMode', building: e, enabled: true });
    sim.step();
    expect(sim.world.has(e, DefenceMode)).toBe(true);

    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();

    // A site shelters nobody, and the panel drops the defence window for one: an alarm left standing
    // could be neither seen nor lowered, and would call the garrison back when the upgrade finished.
    expect(sim.world.has(e, UnderConstruction)).toBe(true);
    expect(sim.world.has(e, DefenceMode)).toBe(false);
  });

  it('re-opens a built home as a site, seeding held bill goods into the hold and stashing the rest', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // 3 stone + 1 wood of household inventory; the L0->L1 bill is 2 stone.
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 3, [WOOD]: 1 });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();

    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L0); // still the old tier while the site rises
    expect(b.built).toBe(0); // a site again - production/housing suspended
    expect(sim.world.has(e, UnderConstruction)).toBe(true);
    // Bill goods seed the hold up to the bill amount; the surplus and non-bill goods are stashed.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(2);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    expect(sim.world.get(e, Upgrading).savedStock.get(STONE)).toBe(1);
    expect(sim.world.get(e, Upgrading).savedStock.get(WOOD)).toBe(1);
    expect(sim.world.get(e, Upgrading).seeded.get(STONE)).toBe(2); // recorded for cancel refund
  });

  it('an upgrade site bills only the DIFFERENCE - the target tier own cost, not the cumulative bill', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();
    // L1's own cost is 2 stone; the cumulative from-scratch L1 bill would be 3. The site advertises 2.
    expect(stockCapacity(sim.world, ctxOf(sim), e, STONE)).toBe(2);
  });

  it('suspends housing while upgrading and completes into the target tier, restoring the stash', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // 1 stone (seeds the hold, spent into the upgrade) + 1 wood (stashed household inventory).
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1, [WOOD]: 1 });
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(1); // L0 shelters 1
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(0); // a site shelters no one

    // Deliver the outstanding stone (the seeded one covers half of L1's 2) and hammer the site out.
    const hold = sim.world.mut(e, Stockpile).amounts;
    hold.set(STONE, (hold.get(STONE) ?? 0) + 1);
    sim.world.mut(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));

    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L1); // adopted the target tier
    expect(b.level).toBe(1);
    expect(b.built).toBe(ONE);
    expect(sim.world.has(e, UnderConstruction)).toBe(false);
    expect(sim.world.has(e, Upgrading)).toBe(false);
    // The 2-stone cost (seeded + delivered) was consumed; the stashed household wood came back.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2
    expect(upgradedEvents(sim)).toEqual([{ kind: 'buildingUpgraded', entity: e, level: 1 }]);
  });

  it('completes with no external delivery when the building already holds the whole bill', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // The settlement's only 2 stone sit inside the home being upgraded (the reported stall).
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();
    sim.world.mut(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0); // spent into the upgrade
    expect(upgradedEvents(sim)).toEqual([{ kind: 'buildingUpgraded', entity: e, level: 1 }]);
  });

  it('residents keep their Residence through the whole upgrade - occupants are not evicted from the books', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0);
    const resident = sim.world.create();
    sim.world.add(resident, Residence, { home: e });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();
    expect(sim.world.get(resident, Residence).home).toBe(e); // kept while the site rises
    sim.world.mut(e, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resident, Residence).home).toBe(e); // and after completion
  });

  it('skips a top-tier home, an unbuilt site, and a double-upgrade - recoverable no-ops', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // Top tier: no upgradeTarget - nothing to rise into.
    const top = placeBuiltHome(sim, HOME_L2, 2, { [STONE]: 9 });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: top });
    // An unbuilt from-scratch site: not a built building yet.
    const site = sim.world.create();
    sim.world.add(site, Building, { buildingType: HOME_L0, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, Stockpile, { amounts: new Map<number, number>() });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: site });
    // A double-upgrade: the second command lands on an already-open upgrade site.
    const home = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });
    sim.step();

    expect(sim.world.has(top, Upgrading)).toBe(false);
    expect(sim.world.get(top, Stockpile).amounts.get(STONE)).toBe(9); // inventory untouched
    expect(sim.world.has(site, Upgrading)).toBe(false);
    // The double-upgrade opened ONE site; its stone seeded the hold exactly once.
    expect(sim.world.get(home, Upgrading).savedStock.get(STONE) ?? 0).toBe(0);
    expect(sim.world.get(home, Stockpile).amounts.get(STONE)).toBe(1);
  });

  it('advances one tier per completed upgrade - reaching L2 takes a second command', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();
    sim.world.mut(e, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(e, UnderConstruction).labor = ONE;
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // finished - not rolling into L2 by itself
    expect(sim.world.get(e, Building).built).toBe(ONE);
  });

  it('cancelUpgrade restores the previous level: stash + seeded goods back, deliveries lost', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // 1 stone (seeds the hold) + 1 wood (stashed) of household inventory.
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1, [WOOD]: 1 });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
    sim.step();
    const hold = sim.world.mut(e, Stockpile).amounts;
    hold.set(STONE, (hold.get(STONE) ?? 0) + 1); // a partial delivery on top of the seeded stone
    sim.enqueueSetup({ kind: 'cancelUpgrade', building: e });
    sim.step();

    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L0); // the previous level stands again…
    expect(b.level).toBe(0);
    expect(b.built).toBe(ONE);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // …with both site markers off
    expect(sim.world.has(e, Upgrading)).toBe(false);
    // The household inventory came back whole (stash + the seeded stone); the DELIVERED site
    // stone is lost (user decision).
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(1); // L0 shelters again
    expect(upgradedEvents(sim)).toEqual([]); // an abort upgrades nothing
  });

  it('cancelUpgrade skips a from-scratch site and a built building - recoverable no-ops', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // A from-scratch construction site: no previous level to fall back to.
    const site = sim.world.create();
    sim.world.add(site, Building, { buildingType: HOME_L0, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, Stockpile, { amounts: new Map<number, number>() });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    // A plain built home: nothing to abort.
    const home = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
    sim.enqueueSetup({ kind: 'cancelUpgrade', building: site });
    sim.enqueueSetup({ kind: 'cancelUpgrade', building: home });
    sim.step();

    expect(sim.world.has(site, UnderConstruction)).toBe(true); // the site keeps rising
    expect(sim.world.get(site, Building).built).toBe(0);
    expect(sim.world.get(home, Stockpile).amounts.get(STONE)).toBe(2); // inventory untouched
  });

  it('is deterministic - two same-seed upgrade runs reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 5, content: levelChainContent() });
      const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 });
      sim.enqueueSetup({ kind: 'upgradeBuilding', building: e });
      sim.step();
      sim.world.mut(e, Stockpile).amounts.set(STONE, 2);
      sim.world.mut(e, UnderConstruction).labor = ONE;
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
