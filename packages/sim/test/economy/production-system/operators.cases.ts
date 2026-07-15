import { describe, expect, it } from 'vitest';
import { Building, Position, Production, Settler, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { CARPENTER, CYCLE_TICKS, ctxOf, PLANK, sawmill, spawnSettler, WOOD, WOODCUTTER } from './support.js';

describe('productionSystem — worker-presence gate', () => {
  it('does not start a cycle on an unstaffed workplace (no worker present)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Inputs present, output room free — but no carpenter stands on the mill, so it must not produce.
    const { mill } = sawmill(sim, [[WOOD, 5]], false);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // never started
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5); // input untouched (no waste)
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // nothing produced
  });

  it('does not count a settler with a non-matching job as the worker', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 5]], false);
    // A woodcutter (job 1) — NOT the carpenter (2) the sawmill employs — stands on the mill's tile.
    const wrong = sim.world.create();
    sim.world.add(wrong, Settler, {
      tribe: 1,
      jobType: 1,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(wrong, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // wrong job: still unstaffed
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5);
  });

  it('pauses an in-flight cycle when the worker leaves, holding elapsed, and resumes on return', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');

    // Run a few ticks with the worker present so a cycle starts and partially advances.
    for (let t = 0; t < 5; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(true);
    const elapsedAtPause = sim.world.get(mill, Production).cycles[0]?.elapsed; // 4 (tick 1 starts, 2..5 advance)

    // Worker walks away — move it off the mill's tile. The cycle must freeze (no advance).
    sim.world.get(worker, Position).x = fx.fromInt(3);
    for (let t = 0; t < CYCLE_TICKS * 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).cycles[0]?.elapsed).toBe(elapsedAtPause); // held, not advanced
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // produced nothing while idle

    // Worker returns — the held cycle resumes and completes.
    sim.world.get(worker, Position).x = fx.fromInt(0);
    for (let t = 0; t < CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // resumed and finished
  });
});

describe('productionSystem — parallel operators (the twin mill)', () => {
  const TWIN_MILL = 8; // fixture: 2 carpenter operator slots + 1 carrier slot, same wood→plank recipe
  const CARRIER = 36;

  /** A twin mill at (0,0) with the PLANK tech-gate opened (a woodcutter in the tribe). */
  function twinMill(sim: Simulation, amounts: Iterable<[number, number]>): Entity {
    spawnSettler(sim, WOODCUTTER, 9, 9);
    const mill = sim.world.create();
    sim.world.add(mill, Building, { buildingType: TWIN_MILL, tribe: 1, built: ONE, level: 0 });
    sim.world.add(mill, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(mill, Stockpile, { amounts: new Map(amounts) });
    return mill;
  }

  it('two operators run two INDEPENDENT batches in parallel (two inputs in, two outputs out)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = twinMill(sim, [[WOOD, 2]]);
    spawnSettler(sim, CARPENTER, 0, 0);
    spawnSettler(sim, CARPENTER, 0, 0);
    // Tick 1 starts BOTH batches (one per present operator), each consuming its own input.
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).cycles).toHaveLength(2);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(0); // both inputs reserved
    // Both batches advance every tick (two operators) and complete together — two planks in ONE
    // cycle length, the "dwóch młynarzy = dwie mąki naraz" model.
    for (let t = 0; t < CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(2);
  });

  it('with fewer operators than batches, the youngest batch WAITS (FIFO — one worker, one batch)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = twinMill(sim, [[WOOD, 2]]);
    spawnSettler(sim, CARPENTER, 0, 0);
    const second = spawnSettler(sim, CARPENTER, 0, 0);
    productionSystem(sim.world, ctxOf(sim)); // two batches start
    productionSystem(sim.world, ctxOf(sim)); // both advance once
    // One operator walks away — batches are anonymous (no owning worker), so with one operator left
    // only the OLDEST batch keeps grinding; the youngest holds its elapsed until a worker frees up.
    sim.world.get(second, Position).x = fx.fromInt(3);
    productionSystem(sim.world, ctxOf(sim));
    const cycles = sim.world.get(mill, Production).cycles;
    expect(cycles[0]?.elapsed).toBe(2);
    expect(cycles[1]?.elapsed).toBe(1); // paused — short one worker this tick
  });

  it('caps the batch count at the declared operator headcount (a third stacked operator adds nothing)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = twinMill(sim, [[WOOD, 3]]);
    for (let i = 0; i < 3; i++) spawnSettler(sim, CARPENTER, 0, 0); // 3 on a 2-slot craft
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).cycles).toHaveLength(2); // 2 slots → 2 batches, never 3
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(1); // only 2 inputs consumed
  });

  it('never over-books the output slot: in-flight batches reserve their room', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Plank slot at 19/20 — room for exactly ONE deposit, so only one of the two ready operators may
    // start a batch (a second would overflow the slot at completion).
    const mill = twinMill(sim, [
      [WOOD, 2],
      [PLANK, 19],
    ]);
    spawnSettler(sim, CARPENTER, 0, 0);
    spawnSettler(sim, CARPENTER, 0, 0);
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).cycles).toHaveLength(1);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(1); // the second input untouched
  });

  it('a carrier at the door neither runs nor mans a batch (transport is not an operator)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = twinMill(sim, [[WOOD, 2]]);
    spawnSettler(sim, CARRIER, 0, 0); // ONLY the carrier stands on the mill
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // never started — no operator present

    // An operator joins: exactly ONE batch runs (the carrier mans none).
    spawnSettler(sim, CARPENTER, 0, 0);
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).cycles).toHaveLength(1);
  });
});
