import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  Health,
  MoveGoal,
  Stance,
  Stockpile,
} from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { boundProducerOutputToHaul } from '../../../src/systems/agents/economy/haul-targets.js';
import { SinkAvailability } from '../../../src/systems/agents/targets/stores/sinks.js';
import { aiSystem } from '../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  buildingAt,
  CARRIER,
  cell,
  ctxOf,
  FARM,
  FARMER,
  GRANARY,
  grassMap,
  HEADQUARTERS,
  PICKUP_ATOMIC,
  pileAt,
  settlerAt,
  VIKING,
  WHEAT,
  WOOD,
} from './support.js';

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

describe('carrier at a PRODUCING building — hauls the finished output OUT to a warehouse', () => {
  // The rule: a carrier stationed at a warehouse/HQ only brings goods IN (the porter above); a carrier
  // stationed at a PRODUCING building (a farm — produces a good but carries no recipe) also carries its
  // finished output OUT to a warehouse. The farm's output was previously stranded: `nearestWorkplaceOutput`
  // only recognises recipe workplaces, so a no-recipe farm's wheat was never hauled.
  it('picks up the farm’s produced good when a warehouse can take it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const farm = buildingAt(sim, FARM, 2, 0, [[WHEAT, 20]]); // a farm holding reaped wheat
    buildingAt(sim, GRANARY, 6, 0); // a warehouse that accepts wheat
    const carrier = settlerAt(sim, 2, 0, CARRIER, farm); // stationed AT the farm

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(carrier, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: WHEAT, from: farm });
  });

  it('routes the hauled output to the warehouse, never back into the farm it came from', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const farm = buildingAt(sim, FARM, 2, 0, [[WHEAT, 20]]);
    buildingAt(sim, GRANARY, 6, 0);
    const carrier = settlerAt(sim, 3, 0, CARRIER, farm);
    sim.world.add(carrier, Carrying, { goodType: WHEAT, amount: 1 }); // already carrying the farm's wheat

    aiSystem(sim.world, ctxOf(sim));

    // The load heads for the granary (cell 6), NOT back to the farm (cell 2) it was lifted from.
    expect(sim.world.get(carrier, MoveGoal).cell).toBe(cell(sim, 6, 0));
  });

  it('routes the load past a NEARER sibling farm to real storage — a producer is never the sink', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const farmA = buildingAt(sim, FARM, 2, 0, [[WHEAT, 20]]);
    buildingAt(sim, FARM, 4, 0); // a NEARER sibling farm with wheat room — a producer, not storage
    buildingAt(sim, GRANARY, 8, 0); // the real sink, farther away
    const carrier = settlerAt(sim, 3, 0, CARRIER, farmA);
    sim.world.add(carrier, Carrying, { goodType: WHEAT, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    // Excluding only the carrier's OWN farm made the sibling the "nearest store" and the wheat
    // ping-ponged farm↔farm forever — the sink scan must skip every producer of the good.
    expect(sim.world.get(carrier, MoveGoal).cell).toBe(cell(sim, 8, 0));
  });

  it('with only sibling farms as candidate sinks there is no haul at all', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const farmA = buildingAt(sim, FARM, 2, 0, [[WHEAT, 20]]);
    buildingAt(sim, FARM, 5, 0); // has wheat room, but produces wheat — not a sink
    const carrier = settlerAt(sim, 2, 0, CARRIER, farmA);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(carrier, CurrentAtomic)).toBe(false);
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);
  });

  it('the field-worker guard: a FARMER never lifts the farm’s wheat out, the CARRIER does', () => {
    // The pickup half must mirror the delivery twin's isFieldWorkerOf split: a farmer that falls
    // through to the porter rung (its farm disabled/under construction) would otherwise lift the
    // wheat and bank it straight back — a per-tick pickup/deposit ping-pong.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const farm = buildingAt(sim, FARM, 2, 0, [[WHEAT, 20]]);
    const granary = buildingAt(sim, GRANARY, 6, 0);
    const farmer = settlerAt(sim, 2, 0, FARMER, farm);
    const carrier = settlerAt(sim, 2, 0, CARRIER, farm);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map sim always has terrain');
    const candidates = [farm, granary];
    const ctx = ctxOf(sim);
    // The pickup deliverability probe the planner would build — "some candidate store takes it" is
    // enough here; the role split under test lives in boundProducerOutputToHaul itself.
    const sinks = new SinkAvailability(candidates, sim.world, ctx);
    const deliverable = (good: number): boolean => sinks.has(good, /* excludeProducers */ true);

    expect(boundProducerOutputToHaul(deliverable, sim.world, ctx, farmer, FARMER, VIKING)).toBeNull();
    expect(boundProducerOutputToHaul(deliverable, sim.world, ctx, carrier, CARRIER, VIKING)).toMatchObject({
      home: farm,
      goodType: WHEAT,
    });
  });

  it('does not haul when no OTHER store can take the output (never shuttles farm→farm)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const farm = buildingAt(sim, FARM, 2, 0, [[WHEAT, 20]]); // wheat on hand, but nowhere else to put it
    const carrier = settlerAt(sim, 2, 0, CARRIER, farm);

    aiSystem(sim.world, ctxOf(sim));

    // No sink for wheat besides the farm itself → it neither picks up nor walks off with it.
    expect(sim.world.has(carrier, CurrentAtomic)).toBe(false);
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);
  });

  it('a carrier at a pure store (HQ) still only brings goods IN — no phantom haul-out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 2, 0, [[WOOD, 20]]); // a warehouse holding wood (no production)
    buildingAt(sim, GRANARY, 6, 0);
    const carrier = settlerAt(sim, 2, 0, CARRIER, hq);

    aiSystem(sim.world, ctxOf(sim));

    // The HQ produces nothing, so its carrier never hauls the HQ's own stock out — it stays inbound-only
    // (nothing to collect here, so it is simply idle rather than lifting the warehouse's wood).
    expect(sim.world.has(carrier, CurrentAtomic)).toBe(false);
  });

  it('end to end: a carrier drains the farm’s wheat into the granary', () => {
    const sim = new Simulation({ seed: 2, content: testContent(), map: grassMap(8, 1) });
    const farm = buildingAt(sim, FARM, 2, 0, [[WHEAT, 5]]);
    const granary = buildingAt(sim, GRANARY, 6, 0);
    settlerAt(sim, 2, 0, CARRIER, farm);

    // One unit per foot-trip (no vehicle), each a farm→granary→farm round trip — long enough to drain all 5.
    for (let i = 0; i < 1200; i++) sim.step();

    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT) ?? 0).toBe(0); // farm cleared
    expect(sim.world.get(granary, Stockpile).amounts.get(WHEAT) ?? 0).toBe(5); // all of it reached the granary
  });

  it('still hauls when the carrier carries Health and the default civilian FLEE stance', () => {
    // A real spawned carrier carries a Health pool and the civilian default FLEE stance (mode 4). Neither
    // blocks the haul: the planner only steps aside for the transient Fleeing MARKER (a threat in sight) and
    // the DEFEND stance, and this peaceful field has no enemy. Guards against a regression that would let a
    // stray stance/health gate the field carrier out of the economy ladder.
    const sim = new Simulation({ seed: 2, content: testContent(), map: grassMap(8, 1) });
    const farm = buildingAt(sim, FARM, 2, 0, [[WHEAT, 5]]);
    const granary = buildingAt(sim, GRANARY, 6, 0);
    const carrier = settlerAt(sim, 2, 0, CARRIER, farm);
    sim.world.add(carrier, Health, { hitpoints: 100, max: 100 });
    sim.world.add(carrier, Stance, { mode: MILITARY_MODE.FLEE, anchorCell: null });

    for (let i = 0; i < 1200; i++) sim.step();

    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT) ?? 0).toBe(0);
    expect(sim.world.get(granary, Stockpile).amounts.get(WHEAT) ?? 0).toBe(5);
  });
});
