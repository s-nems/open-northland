import { describe, expect, it } from 'vitest';
import { Building, Carrying, Health, Resource, Settler, Stockpile } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { atomicSystem, EAT_HUNGER_RESTORE } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, PLANK, SAWMILL, startAtomic, WOOD } from './support.js';

describe('atomicSystem — effects', () => {
  it('harvest grants one unit onto the settler AND depletes the node by one', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    const resource = sim.world.create();
    sim.world.add(resource, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
    startAtomic(sim, e, { kind: 'harvest', resource, goodType: WOOD }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Carrying)).toEqual({ goodType: WOOD, amount: 1 });
    expect(sim.world.get(resource, Resource).remaining).toBe(4); // node lost exactly what was taken
  });

  it('harvest never depletes a node below zero (clamped)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    const resource = sim.world.create();
    sim.world.add(resource, Resource, { goodType: WOOD, remaining: 0, harvestAtomic: 24 });
    startAtomic(sim, e, { kind: 'harvest', resource, goodType: WOOD }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resource, Resource).remaining).toBe(0); // stays at floor, no negative
  });

  it('harvest on an already-gone node yields NOTHING (the swing struck air — goods conserved)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    const resource = sim.world.create(); // never given a Resource component (felled/destroyed already)
    startAtomic(sim, e, { kind: 'harvest', resource, goodType: WOOD }, 1);
    atomicSystem(sim.world, ctxOf(sim)); // must not throw on the missing node
    // A vanished node means the swing hit nothing — no unit is conjured onto the back (a chop that
    // landed after another collector already felled the tree carries nothing).
    expect(sim.world.has(e, Carrying)).toBe(false);
  });

  it('pickup adds the amount, merging with an existing same-good load', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.world.add(e, Carrying, { goodType: WOOD, amount: 2 });
    startAtomic(sim, e, { kind: 'pickup', goodType: WOOD, amount: 3, from: null }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Carrying)).toEqual({ goodType: WOOD, amount: 5 });
  });

  it('refuses to pick up a different good while already loaded (goods conservation)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.world.add(e, Carrying, { goodType: WOOD, amount: 2 });
    startAtomic(sim, e, { kind: 'pickup', goodType: PLANK, amount: 1, from: null }, 1);
    // Overwriting the load would destroy the carried wood — that's a planner bug, so it throws.
    expect(() => atomicSystem(sim.world, ctxOf(sim))).toThrow(/already carries good/);
  });

  it('pileup deposits the carried load into the store stockpile and unloads the settler', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    const store = sim.world.create();
    sim.world.add(settler, Carrying, { goodType: WOOD, amount: 5 });
    sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map([[WOOD, 0]]) });
    startAtomic(sim, settler, { kind: 'pileup', store }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(5);
    expect(sim.world.has(settler, Carrying)).toBe(false); // fully unloaded
  });

  it('pileup respects capacity — overflow stays on the settler', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    const store = sim.world.create();
    // Sawmill caps wood at 20; pre-fill to 18 so only 2 fit.
    sim.world.add(settler, Carrying, { goodType: WOOD, amount: 5 });
    sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map([[WOOD, 18]]) });
    startAtomic(sim, settler, { kind: 'pileup', store }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(20); // capped
    expect(sim.world.get(settler, Carrying).amount).toBe(3); // 3 still carried, not dropped
  });

  it('pileup is a no-op when the store has no room (good not in its stock slots)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    const store = sim.world.create();
    // Headquarters (buildingType 1) declares no plank slot in... actually it does; use a good with
    // no slot: the sawmill has no slot for goodType 0 (none). Carry goodType 0 → capacity 0.
    sim.world.add(settler, Carrying, { goodType: 0, amount: 5 });
    sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });
    startAtomic(sim, settler, { kind: 'pileup', store }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(store, Stockpile).amounts.get(0)).toBeUndefined();
    expect(sim.world.get(settler, Carrying).amount).toBe(5); // nothing moved
  });

  it('eat takes one meal off the settler hunger, not the whole bar', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    sim.world.add(settler, Settler, {
      tribe: 1,
      jobType: null,
      hunger: ONE,
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    startAtomic(sim, settler, { kind: 'eat', goodType: WOOD, from: null }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(ONE, EAT_HUNGER_RESTORE));
  });

  it('enjoy clears the settler enjoyment (no goods consumed)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    sim.world.add(settler, Settler, {
      tribe: 1,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: ONE, // fully due for recreation
      experience: new Map(),
    });
    startAtomic(sim, settler, { kind: 'enjoy' }, 1, 17); // atomic 17 = the original's enjoy slot
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Settler).enjoyment).toBe(0); // leisure reset
    expect(sim.world.has(settler, Carrying)).toBe(false); // nothing consumed/produced
  });

  it('make_love clears the settler enjoyment (same leisure channel as enjoy, no goods consumed)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    sim.world.add(settler, Settler, {
      tribe: 1,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: ONE, // fully due for recreation
      experience: new Map(),
    });
    startAtomic(sim, settler, { kind: 'make_love' }, 1, 78); // atomic 78 = the original's make_love slot
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Settler).enjoyment).toBe(0); // leisure reset (channel 3, like enjoy)
    expect(sim.world.has(settler, Carrying)).toBe(false); // nothing consumed/produced
  });

  it('attack drains the resolved net damage from the target hitpoints', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Health, { hitpoints: 1000, max: 1000 });
    // 35 = a resolved net-damage value (e.g. combatDamage sword vs class-3 armor: raw 40 - block 5).
    startAtomic(sim, attacker, { kind: 'attack', target, damage: 35 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(965); // 1000 - 35
    expect(sim.world.get(target, Health).max).toBe(1000); // pool ceiling untouched
  });

  it('attack never drives hitpoints below zero (clamped — a hit never heals)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Health, { hitpoints: 20, max: 1000 });
    startAtomic(sim, attacker, { kind: 'attack', target, damage: 100 }, 1, 81); // overkill
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(0); // floored at 0, not negative
  });

  it('attack is a no-op when the target has no Health (struck air / already gone)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create(); // never given a Health component
    startAtomic(sim, attacker, { kind: 'attack', target, damage: 50 }, 1, 81);
    expect(() => atomicSystem(sim.world, ctxOf(sim))).not.toThrow(); // missing target must not throw
    expect(sim.world.has(target, Health)).toBe(false);
  });

  it('attack with zero net damage (armor fully absorbed) leaves the target untouched', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    startAtomic(sim, attacker, { kind: 'attack', target, damage: 0 }, 1, 81); // combatDamage clamped net to 0
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(500); // no harm
  });
});
