import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Position,
  Production,
  Settler,
  Stockpile,
} from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { ONE, Simulation, fx } from '../src/index.js';
import { type SystemContext, productionSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit + integration tests for the ProductionSystem — a workplace consumes its recipe inputs and
 * produces outputs over `recipe.ticks`, enforcing per-good stock capacity on the output side AND a
 * **worker-presence gate** (a cycle only starts/advances while a settler whose job matches the
 * building type's `workers` slot stands on the workplace's tile). The fixture's sawmill (buildingType
 * 2) has recipe wood(1)×1 → plank(2)×1 over 20 ticks, both goods capped at 20, and a `workers` slot
 * for the carpenter job (2); the headquarters (buildingType 1) carries no recipe (not a workplace).
 */

const WOOD = 1;
const PLANK = 2;
const SAWMILL = 2; // fixture buildingType: recipe wood->plank, both capped at 20, worker = carpenter(2)
const HEADQUARTERS = 1; // fixture buildingType: no recipe
const CARPENTER = 2; // the sawmill's `workers` jobType — its operator
const CYCLE_TICKS = 20; // the sawmill recipe's `ticks`

beforeEach(() => {
  Production.store.clear();
  Stockpile.store.clear();
  Building.store.clear();
  Settler.store.clear();
  Position.store.clear();
  JobAssignment.store.clear();
});

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

const WOODCUTTER = 1; // the job whose presence tech-unlocks PLANK production (jobEnablesGood 1 2)

/** Spawn a settler of `jobType` in tribe 1 at the given tile. */
function spawnSettler(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Settler, {
    tribe: 1,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  return e;
}

/**
 * Build a sawmill workplace at tile (0,0) with the given starting stock amounts. Unless overridden it
 * places its carpenter worker on that same tile (the worker-presence gate) AND a woodcutter elsewhere
 * in the tribe (the PLANK `jobEnablesGood` tech-gate), so most cases test the cycle mechanics with both
 * gates already open. `staffed: false` omits the worker; `enablerPresent: false` omits the woodcutter.
 */
function sawmill(
  sim: Simulation,
  amounts: Iterable<[number, number]>,
  staffed = true,
  enablerPresent = true,
): { mill: Entity; worker: Entity | null } {
  // The woodcutter that unlocks PLANK production sits off the mill's tile (its presence in the tribe
  // is what the gate reads — a pure membership query, not a worker-on-tile check).
  if (enablerPresent) spawnSettler(sim, WOODCUTTER, 9, 9);
  const mill = sim.world.create();
  sim.world.add(mill, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
  sim.world.add(mill, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(mill, Stockpile, { amounts: new Map(amounts) });
  const worker = staffed ? spawnSettler(sim, CARPENTER, 0, 0) : null;
  return { mill, worker };
}

describe('productionSystem — cycle lifecycle', () => {
  it('consumes the input at cycle start and produces the output on the duration-th tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [
      [WOOD, 3],
      [PLANK, 0],
    ]);

    // Tick 1: starts a cycle — input consumed immediately, no Production-advance yet (begins next tick).
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(2); // one wood reserved/consumed
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(0); // no output until completion
    expect(sim.world.has(mill, Production)).toBe(true);

    // Ticks 2..CYCLE_TICKS: the cycle advances (elapsed 1..CYCLE_TICKS-1) — still producing.
    for (let t = 2; t <= CYCLE_TICKS; t++) {
      productionSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(0); // no output mid-cycle
    }
    // Tick CYCLE_TICKS+1: the CYCLE_TICKS-th advance completes (elapsed reaches duration) — +1 plank,
    // Production removed; then — wood still available — a fresh cycle starts the same tick.
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(1); // 2nd cycle consumed another
    expect(sim.world.has(mill, Production)).toBe(true); // new cycle running
  });

  it('three input units yield exactly three outputs over three cycles (goods accounting)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [
      [WOOD, 3],
      [PLANK, 0],
    ]);
    // Run long enough for all three cycles to finish.
    for (let t = 0; t < CYCLE_TICKS * 3 + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(0); // all consumed
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(3); // all produced
    expect(sim.world.has(mill, Production)).toBe(false); // idle: nothing left to produce
  });

  it('emits a goodProduced event for the output on completion', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 1]]);
    let produced: { building: Entity; goodType: number; amount: number } | undefined;
    for (let t = 0; t <= CYCLE_TICKS; t++) {
      sim.events.clear();
      productionSystem(sim.world, ctxOf(sim));
      const evt = sim.events.current().find((e) => e.kind === 'goodProduced');
      if (evt !== undefined && evt.kind === 'goodProduced') produced = evt;
    }
    expect(produced).toMatchObject({ building: mill, goodType: PLANK, amount: 1 });
  });
});

describe('productionSystem — gating', () => {
  it('does not start a cycle when the input good is missing', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 0]]);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // never started
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // nothing produced
  });

  it('enforces per-good output capacity: no cycle starts when the output is full', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Plank already at its cap (20) — no room for the +1 output, so production must not start
    // (and so must not consume the input either). This is the capacity enforcement.
    const { mill } = sawmill(sim, [
      [WOOD, 5],
      [PLANK, 20],
    ]);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5); // input untouched (no waste)
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // never exceeds capacity
  });

  it('resumes producing once the full output makes room again', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [
      [WOOD, 5],
      [PLANK, 20],
    ]);
    // Blocked while full.
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    // Make room (e.g. a carrier hauled a plank away), then a cycle can start.
    sim.world.get(mill, Stockpile).amounts.set(PLANK, 19);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // produced exactly to the cap
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(4); // one input consumed
  });

  it('does not start a cycle when the output good is gated-out (jobEnablesGood, no enabling settler)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Inputs present, output room free, carpenter operator on the tile — but NO woodcutter exists in
    // the tribe, and PLANK is gated by `jobEnablesGood 1 2`. So the tech-graph gate blocks production.
    const { mill } = sawmill(sim, [[WOOD, 5]], true, false);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // gated out — never started
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5); // input untouched (no waste)
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // nothing produced
  });

  it('starts producing once the enabling-job settler appears (gate opens mid-run)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 5]], true, false); // staffed, but PLANK gated-out
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // blocked while the woodcutter is absent

    // A woodcutter joins the tribe — the jobEnablesGood gate for PLANK now opens.
    spawnSettler(sim, WOODCUTTER, 9, 9);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // produced once unlocked
    // The first cycle completes on the CYCLE_TICKS+1-th tick and a second starts the same tick, so two
    // wood are consumed by the end of the loop (5 → 3) while only the first cycle's plank is out yet.
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(3);
  });

  it('ignores a building whose type carries no recipe (not a workplace)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = sim.world.create();
    sim.world.add(hq, Building, { buildingType: HEADQUARTERS, tribe: 1, built: ONE, level: 0 });
    sim.world.add(hq, Stockpile, { amounts: new Map([[WOOD, 10]]) });
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hq, Production)).toBe(false);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10); // untouched
  });
});

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
    const elapsedAtPause = sim.world.get(mill, Production).elapsed; // 4 (tick 1 starts, 2..5 advance)

    // Worker walks away — move it off the mill's tile. The cycle must freeze (no advance).
    sim.world.get(worker, Position).x = fx.fromInt(3);
    for (let t = 0; t < CYCLE_TICKS * 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).elapsed).toBe(elapsedAtPause); // held, not advanced
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // produced nothing while idle

    // Worker returns — the held cycle resumes and completes.
    sim.world.get(worker, Position).x = fx.fromInt(0);
    for (let t = 0; t < CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // resumed and finished
  });
});

describe('productionSystem — determinism', () => {
  it('two same-seed runs reach the same state hash through the full schedule', () => {
    const run = (): string => {
      Production.store.clear();
      Stockpile.store.clear();
      Building.store.clear();
      Settler.store.clear();
      Position.store.clear();
      JobAssignment.store.clear();
      const sim = new Simulation({ seed: 7, content: testContent() });
      sawmill(sim, [
        [WOOD, 4],
        [PLANK, 0],
      ]);
      for (let t = 0; t < CYCLE_TICKS * 2 + 5; t++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
