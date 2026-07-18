import { describe, expect, it } from 'vitest';
import { Building, Health, Stockpile, UnderConstruction } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';

import { constructionContent, fullyHammer, HOUSE, HOUSE_MAX_HP, STONE, VIKING, WOOD } from './support.js';

describe('placeBuilding underConstruction (CommandSystem)', () => {
  it('starts a building at built=0 with an empty hold + a foundation Health + marker, then builds once hammered', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HOUSE,
      x: 0,
      y: 0,
      tribe: VIKING,
      underConstruction: true,
    });
    sim.step(); // commandSystem places the under-construction site
    const e = [...sim.world.query(Building)][0];
    if (e === undefined) throw new Error('building was not placed');
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0)); // under construction
    expect(sim.world.has(e, UnderConstruction)).toBe(true); // the builder-work marker
    expect(sim.world.get(e, Stockpile).amounts.size).toBe(0); // empty hold — accumulates deliveries
    // The foundation carries a Health pool floored at 1 (never a 0-HP corpse the CleanupSystem reaps).
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: 1, max: HOUSE_MAX_HP });

    // Stock the site (the carrier-delivery, done by hand here) and hammer it (the builder work, likewise),
    // then step: the constructionSystem finishes it. Material alone is not enough — labor is required.
    const stock = sim.world.get(e, Stockpile).amounts;
    stock.set(STONE, 2);
    stock.set(WOOD, 1);
    sim.step();
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0)); // stocked but un-hammered — still 0
    fullyHammer(sim, e);
    sim.step();
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // finished — marker gone
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP); // full life
  });

  it('places an already-built building (default) seeded from its stock initials, with no site marker', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOUSE, x: 0, y: 0, tribe: VIKING }); // no flag
    sim.step();
    const e = [...sim.world.query(Building)][0];
    if (e === undefined) throw new Error('building was not placed');
    expect(sim.world.get(e, Building).built).toBe(ONE); // immediately built — the slice path
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // not a site
    // A built placement of a type WITH hitpoints now arrives at a FULL life pool, so it can be besieged
    // (a type with no hitpoints still carries none). The under-construction path instead ramps from 1.
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: HOUSE_MAX_HP, max: HOUSE_MAX_HP });
  });
});
