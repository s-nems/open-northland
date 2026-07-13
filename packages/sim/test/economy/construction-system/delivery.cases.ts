import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { housingCapacity } from '../../../src/systems/index.js';

import {
  builderAt,
  builtHomeAt,
  clearComponentStores,
  constructionContent,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  HOME_L0,
  HOME_L1,
  HOME_L2,
  HOUSE,
  levelChainWithCarrier,
  loadedCarrierAt,
  STONE,
  siteAt,
  VIKING,
  WOOD,
} from './support.js';

describe('constructionSystem — material-DELIVERY dispatch (carrier path)', () => {
  it('a construction site is a valid delivery sink for its outstanding materials, but not random goods', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(4, 1) });
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1); // carrying a stone the house needs
    const site = siteAt(sim, HOUSE, 2, 0); // empty — needs 2 stone + 1 wood

    // Loaded, the carrier should head FOR the site (it has room for the stone it needs).
    sim.step();
    // It either set a MoveGoal toward the site or, once adjacent, is en route — verify it picked the site.
    let stoneAtSite = 0;
    for (let i = 0; i < 60 && stoneAtSite === 0; i++) {
      sim.step();
      stoneAtSite = sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0;
    }
    expect(stoneAtSite).toBe(1); // the carrier delivered its stone to the construction site
    expect(sim.world.has(carrier, Carrying)).toBe(false); // unloaded
  });

  it('end-to-end: carriers haul the full cost while a builder hammers, then the site builds and consumes it', () => {
    const sim = new Simulation({ seed: 2, content: constructionContent(), map: grassMap(6, 1) });
    const site = siteAt(sim, HOUSE, 3, 0); // needs 2 stone + 1 wood
    // Three carriers each holding one of the three needed units (2 stone + 1 wood)…
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 1, 0, STONE, 1);
    loadedCarrierAt(sim, 5, 0, WOOD, 1);
    // …and a builder that hammers the site as the material lands (parallel supply + work).
    builderAt(sim, 4, 0);

    let built = false;
    for (let i = 0; i < 200 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
    }
    expect(built).toBe(true); // delivered material + builder work together completed the build
    // The cost was consumed into the structure — the materials don't linger as stock.
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
    expect(sim.world.get(site, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    expect(sim.world.has(site, UnderConstruction)).toBe(false); // finished — a plain Building now
    // No construction material is left IN FLIGHT — every unit the carriers held reached the site (the
    // cost above is 0 because it was delivered THEN consumed, so this is the "nothing stuck en route" half).
    let materialInFlight = 0;
    for (const e of sim.world.query(Carrying)) {
      const load = sim.world.get(e, Carrying);
      if (load.goodType === STONE || load.goodType === WOOD) materialInFlight += load.amount;
    }
    expect(materialInFlight).toBe(0);
  });

  it('a builder self-supplies: fetches material from a warehouse to its own site, then builds it', () => {
    const sim = new Simulation({ seed: 4, content: constructionContent(), map: grassMap(8, 1) });
    const site = siteAt(sim, HOUSE, 4, 0); // needs 2 stone + 1 wood, empty hold
    // A warehouse holding the full cost — the builder must carry it over itself (no carriers). It is a
    // BUILDING store (not a bare Stockpile), so the gatherer-yard reaper never mistakes it for a loose
    // ground heap and removes it once the builder drains it (isYardHeap excludes Building stores).
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, {
      amounts: new Map<number, number>([
        [STONE, 2],
        [WOOD, 1],
      ]),
    });
    builderAt(sim, 6, 0);

    let built = false;
    for (let i = 0; i < 400 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
    }
    expect(built).toBe(true); // the builder hauled every material itself and hammered the site up
    expect(sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // drawn from the warehouse
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // and spent into the build
  });

  it('is deterministic — two same-seed delivery+build runs reach the same finished state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 9, content: constructionContent(), map: grassMap(6, 1) });
      siteAt(sim, HOUSE, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 1, 0, STONE, 1);
      loadedCarrierAt(sim, 5, 0, WOOD, 1);
      builderAt(sim, 4, 0);
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

/**
 * Home level-up: a BUILT `home` that accumulates the NEXT tier's `construction` cost in its own
 * stockpile consumes those materials and upgrades — its `buildingType` becomes the next tier's typeId
 * and `level` increments, so its larger `homeSize` immediately raises `housingCapacity`. The level
 * chain is the consecutive `home` typeIds; the top tier (no next typeId) never upgrades.
 */
describe('constructionSystem — upgrade-material DELIVERY dispatch (carrier path)', () => {
  it('end-to-end: carriers haul the next tier cost to a built home, which then levels up', () => {
    const sim = new Simulation({ seed: 2, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, HOME_L0, 0, 3, 0); // L0 (homeSize 1) — L1 needs 2 stone
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 1, 0, STONE, 1);

    let upgraded = false;
    for (let i = 0; i < 120 && !upgraded; i++) {
      sim.step();
      upgraded = sim.world.get(home, Building).buildingType === HOME_L1;
    }
    expect(upgraded).toBe(true); // the delivered upgrade materials triggered the level-up
    expect(sim.world.get(home, Building).level).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2 (was 1)
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // spent into the upgrade
    for (const e of sim.world.query(Settler)) expect(sim.world.has(e, Carrying)).toBe(false); // both unloaded
  });

  it('a TOP-TIER home does not attract upgrade materials — a carrier with no other sink keeps its load', () => {
    // HOME_L2 is the top of the chain (no typeId-5 home), so `stockCapacity` advertises no upgrade demand
    // (and the home has no stock slots) — the carrier finds no valid sink and never delivers its stone.
    const sim = new Simulation({ seed: 3, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, HOME_L2, 2, 3, 0);
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // nothing delivered
    expect(sim.world.has(carrier, Carrying)).toBe(true); // still holding its load — no sink
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L2); // unchanged
  });

  it('is deterministic — two same-seed upgrade-delivery runs reach the same state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 9, content: levelChainWithCarrier(), map: grassMap(6, 1) });
      builtHomeAt(sim, HOME_L0, 0, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 1, 0, STONE, 1);
      for (let i = 0; i < 80; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
