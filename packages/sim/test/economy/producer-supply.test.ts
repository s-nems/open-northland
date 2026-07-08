import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation, type TerrainMap, fx } from '../../src/index.js';
import { type SystemContext, aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The PRODUCER SELF-SERVICE + PORTER drives (packages/sim/src/systems/agents/ai-supply.ts): a worker
 * bound to a recipe workshop fetches the inputs it lacks from a store that holds them and hauls its own
 * finished output out, and a porter bound to a store collects loose ground piles into it. Fixture: good
 * 1 = wood, good 2 = plank, job 1 = woodcutter (harvest 24), job 2 = carpenter (no atomics — the mill's
 * operator), job 36 = carrier, building 1 = HQ (storage, wood+plank slots), building 2 = sawmill (recipe
 * 1 wood → 1 plank, employs the carpenter). Planner-level checks (one `aiSystem` pass) pin each decision
 * in isolation; an end-to-end run proves the loop closes.
 */

const GRASS = 0;
const WOOD = 1;
const PLANK = 2;
const WOODCUTTER = 1;
const CARPENTER = 2;
const CARRIER = 36;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const VIKING = 1;
const PICKUP_ATOMIC = 22;

beforeEach(() => {
  for (const c of [
    Position,
    Settler,
    Resource,
    Building,
    Stockpile,
    Carrying,
    CurrentAtomic,
    MoveGoal,
    PathFollow,
    PathRequest,
    Production,
    JobAssignment,
  ]) {
    c.store.clear();
  }
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
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

function settlerAt(sim: Simulation, x: number, y: number, jobType: number, boundTo?: Entity): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

/** A building store/workplace with an optional preset stockpile. */
function buildingAt(
  sim: Simulation,
  buildingType: number,
  x: number,
  y: number,
  goods: Array<[number, number]> = [],
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  return e;
}

/** A bare ground pile / flag: a positioned stockpile with NO building. */
function pileAt(sim: Simulation, x: number, y: number, goods: Array<[number, number]> = []): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  return e;
}

function cell(sim: Simulation, x: number, y: number): number {
  return sim.terrain?.cellAt(x, y) as number;
}

describe('producer self-service — fetching a missing recipe input', () => {
  it('walks to a separate store that holds a missing input', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0); // empty: needs wood for its 1 wood → 1 plank recipe
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // the warehouse holding the wood
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill); // on its mill, but the mill has no wood

    aiSystem(sim.world, ctxOf(sim));

    // Can't produce (no wood), nothing to haul out — so it heads for the store that holds the input.
    expect(sim.world.has(smith, MoveGoal)).toBe(true);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('picks up exactly the shortfall when standing on the source store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill); // standing on the warehouse (the source)

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    // Recipe needs 1 wood and the mill has 0 → fetch the shortfall of 1, out of the HQ.
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WOOD, amount: 1, from: hq });
  });

  it('delivers a fetched input to its workshop, not back to the nearer store it came from', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 5, 0); // the workshop, far
    buildingAt(sim, HEADQUARTERS, 1, 0, [[WOOD, 3]]); // a NEARER store
    const smith = settlerAt(sim, 2, 0, CARPENTER, mill);
    sim.world.add(smith, Carrying, { goodType: WOOD, amount: 1 }); // already carrying a fetched input

    aiSystem(sim.world, ctxOf(sim));

    // The carried input routes to the bound workshop (cell 5), NOT the nearer HQ at cell 1.
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('stays on the station while a cycle is already running (does not wander off to fetch)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    sim.world.add(mill, Production, { elapsed: 2, duration: 20 }); // a cycle in flight
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // wood is available elsewhere…
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    // …but the mill is producing, so the operator holds the tile (worker-presence gate) rather than
    // leaving to fetch more.
    expect(sim.world.has(smith, MoveGoal)).toBe(false);
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
  });
});

describe('producer self-service — hauling the finished output', () => {
  it('carries its finished output out when it cannot produce', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0, [[PLANK, 1]]); // a finished plank, but no wood to make more
    buildingAt(sim, HEADQUARTERS, 5, 0); // a store that can take the plank
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });
});

describe('porter — collecting loose ground piles into a warehouse', () => {
  it('walks to the nearest loose ground pile', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 5, 0);
    pileAt(sim, 2, 0, [[WOOD, 2]]); // a heap gatherers dropped at a flag
    const porter = settlerAt(sim, 0, 0, CARRIER, hq); // bound to the warehouse

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 2, 0));
  });

  it('picks up the pile when standing on it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 5, 0);
    const pile = pileAt(sim, 2, 0, [[WOOD, 2]]);
    const porter = settlerAt(sim, 2, 0, CARRIER, hq);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: WOOD, from: pile });
  });

  it('delivers a collected load to ITS warehouse, not the nearest store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(7, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 6, 0); // its bound warehouse, far
    buildingAt(sim, HEADQUARTERS, 1, 0); // a NEARER warehouse it is NOT bound to
    const porter = settlerAt(sim, 2, 0, CARRIER, hq);
    sim.world.add(porter, Carrying, { goodType: WOOD, amount: 2 });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(porter, MoveGoal).cell).toBe(cell(sim, 6, 0)); // its own HQ, not the nearer one
  });
});

describe('gatherer flag-drop — deliver harvested goods to a bound store', () => {
  it('a gatherer delivers to its bound flag pile rather than the nearest store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(7, 1) });
    const flag = pileAt(sim, 6, 0); // its assigned drop flag (a bare ground pile), far
    buildingAt(sim, HEADQUARTERS, 1, 0); // a NEARER store it is not assigned to
    const cutter = settlerAt(sim, 3, 0, WOODCUTTER, flag);
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, MoveGoal).cell).toBe(cell(sim, 6, 0)); // the flag, not the nearer HQ
  });

  it('an UNBOUND hauler still routes to the nearest store (the default, unchanged)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    buildingAt(sim, HEADQUARTERS, 4, 0);
    const cutter = settlerAt(sim, 0, 0, WOODCUTTER); // no JobAssignment
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, MoveGoal).cell).toBe(cell(sim, 4, 0));
  });
});

describe('producer self-service — end to end', () => {
  it('a smith drains a warehouse of inputs, forges the product, and returns it', () => {
    // 1-row strip: sawmill at 1, HQ at 3 holding 2 wood. A woodcutter is alive (tech-unlocks PLANK
    // production) but has no tree, so it never competes for the wood; the smith self-supplies from the HQ.
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(5, 1) });
    const mill = buildingAt(sim, SAWMILL, 1, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 2]]);
    settlerAt(sim, 1, 0, CARPENTER, mill); // the smith, on its mill
    settlerAt(sim, 4, 0, WOODCUTTER); // alive → unlocks PLANK; no tree → idles, never touches the wood

    let produced = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'goodProduced') produced += ev.amount;
    }

    // The 2 warehouse-stored wood became planks — the smith fetched every unit and forged it.
    expect(produced).toBe(2);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0).toBe(0); // warehouse wood fully drained
    // Every plank ends up in a store (the mill hauled its output to the HQ), none stranded on the smith.
    const planksInStores =
      (sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0) +
      (sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0);
    expect(planksInStores).toBe(2);
  });
});
