import { beforeEach, describe, expect, it } from 'vitest';
import type { AtomicEffect } from '../src/commands.js';
import { Building, Carrying, CurrentAtomic, Resource, Settler, Stockpile } from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { ONE, Simulation, fx } from '../src/index.js';
import { type SystemContext, atomicSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit + integration tests for the AtomicSystem — the executor half of the settler planner. It
 * advances a {@link CurrentAtomic}'s progress to ONE over `duration` ticks, and on completion applies
 * the typed {@link AtomicEffect} (harvest/pickup → Carrying, pileup → Stockpile, eat → hunger),
 * emits an `atomicCompleted` event, and removes the component. The fixture's goods are 1 = wood,
 * 2 = plank; the sawmill (buildingType 2) caps wood at 20.
 */

const WOOD = 1;
const PLANK = 2;
const SAWMILL = 2; // fixture buildingType: wood capacity 20

beforeEach(() => {
  CurrentAtomic.store.clear();
  Carrying.store.clear();
  Stockpile.store.clear();
  Building.store.clear();
  Settler.store.clear();
  Resource.store.clear();
});

/** Give an entity a CurrentAtomic with the given effect/duration (progress starts at 0). */
function startAtomic(sim: Simulation, e: Entity, effect: AtomicEffect, duration: number, atomicId = 1): void {
  sim.world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect,
    targetEntity: null,
    targetTile: null,
  });
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

describe('atomicSystem — progress + completion', () => {
  it('advances progress and completes on the duration-th tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 4);

    // Ticks 1..3: still running, progress climbing.
    for (let i = 0; i < 3; i++) {
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.has(e, CurrentAtomic)).toBe(true);
      expect(sim.world.get(e, CurrentAtomic).progress).toBeLessThan(ONE);
    }
    // Tick 4: reaches ONE, applies + removes.
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('completes on the exact tick even for a duration ONE does not divide evenly', () => {
    // Regression: ONE/3 truncates, so accumulating a fixed-point step would sum to < ONE after 3
    // ticks and hang. Integer `elapsed` makes completion exact. Try several odd durations.
    for (const duration of [3, 6, 7]) {
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 1, content: testContent() });
      const e = sim.world.create();
      startAtomic(sim, e, { kind: 'idle' }, duration);
      for (let i = 0; i < duration - 1; i++) {
        atomicSystem(sim.world, ctxOf(sim));
        expect(sim.world.has(e, CurrentAtomic)).toBe(true);
      }
      atomicSystem(sim.world, ctxOf(sim)); // duration-th tick
      expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    }
  });

  it('a zero/one-tick animation completes on the first tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    startAtomic(sim, e, { kind: 'idle' }, 0); // clamped to >= 1
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('emits an atomicCompleted event with the atomicId on completion', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.events.clear();
    startAtomic(sim, e, { kind: 'idle' }, 1, 24);
    atomicSystem(sim.world, ctxOf(sim));
    const evts = sim.events.current().filter((ev) => ev.kind === 'atomicCompleted');
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ kind: 'atomicCompleted', entity: e, atomicId: 24 });
  });
});

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

  it('harvest still grants the unit when the node entity is already gone', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    const resource = sim.world.create(); // never given a Resource component (e.g. consumed/destroyed)
    startAtomic(sim, e, { kind: 'harvest', resource, goodType: WOOD }, 1);
    atomicSystem(sim.world, ctxOf(sim)); // must not throw on the missing node
    expect(sim.world.get(e, Carrying)).toEqual({ goodType: WOOD, amount: 1 });
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

  it('eat clears the settler hunger', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    sim.world.add(settler, Settler, {
      tribe: 1,
      jobType: null,
      hunger: ONE,
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      experience: new Map(),
    });
    startAtomic(sim, settler, { kind: 'eat', goodType: WOOD }, 1);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Settler).hunger).toBe(0);
  });
});

describe('atomicSystem — end-to-end: harvest -> carry -> pileup', () => {
  it('a settler harvests wood then piles it up at a store via two atomics', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    const resource = sim.world.create();
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });

    // Atomic 1: harvest wood (2-tick animation).
    startAtomic(sim, settler, { kind: 'harvest', resource, goodType: WOOD }, 2, 24);
    atomicSystem(sim.world, ctxOf(sim)); // tick 1: progress 1/2
    expect(sim.world.has(settler, Carrying)).toBe(false);
    atomicSystem(sim.world, ctxOf(sim)); // tick 2: completes, +1 wood
    expect(sim.world.get(settler, Carrying)).toEqual({ goodType: WOOD, amount: 1 });

    // Atomic 2: pileup at the store.
    startAtomic(sim, settler, { kind: 'pileup', store }, 1, 23);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(1);
    expect(sim.world.has(settler, Carrying)).toBe(false);
  });
});

describe('atomicSystem — determinism', () => {
  it('two same-seed runs reach the same state hash', () => {
    const run = (): string => {
      CurrentAtomic.store.clear();
      Carrying.store.clear();
      Stockpile.store.clear();
      Building.store.clear();
      const sim = new Simulation({ seed: 5, content: testContent() });
      const settler = sim.world.create();
      const store = sim.world.create();
      sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
      sim.world.add(store, Stockpile, { amounts: new Map() });
      startAtomic(sim, settler, { kind: 'pickup', goodType: PLANK, amount: 4, from: null }, 3, 22);
      for (let i = 0; i < 3; i++) sim.step();
      startAtomic(sim, settler, { kind: 'pileup', store }, 2, 23);
      for (let i = 0; i < 2; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
