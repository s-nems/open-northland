import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  Position,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fx, ONE, Simulation } from '../../src/index.js';
import { aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Tests for the STORE CARRIER: an **employed** carrier (bound to a store's transport slot — the
 * planner's haul rung requires both the trade and the binding; a loose carrier or any other idle
 * settler does no hauling at all) ferries a workplace's finished output goods out to a store that
 * can stock them (goods never teleport — the source stockpile loses exactly what the carrier gains,
 * then the existing carry→pileup chain deposits it).
 *
 * Fixture wiring (see fixtures/content.ts): the SAWMILL (buildingType 2) has recipe wood→plank and a
 * plank output slot; the HEADQUARTERS (buildingType 1) is a passive store with a plank slot (cap 150),
 * no recipe, and a carrier transport slot the JobSystem's report-in pass posts a loose carrier to
 * (the end-to-end runs below rely on it; the planner-level tests bind explicitly).
 */

const PLANK = 2;
const CARRIER = 36; // fixture job with NO allowedAtomics — it can't harvest, only haul
const SAWMILL = 2; // workplace: recipe wood->plank
const HEADQUARTERS = 1; // passive store with a plank slot
const GRANARY = 6; // passive store with ONLY a wheat slot — it can never take a plank
const FARMER = 18; // a non-carrier trade with nothing to do on a bare strip
const VIKING = 1;

// The WHOLE component namespace, not a hand-picked subset — the JobSystem's report-in pass now
// stamps JobAssignment in the end-to-end runs, and a missed store leaks across the in-test reruns
// (the sim AGENTS.md's most-rediscovered trap).

/** A `width`×`height` CELL strip of grass, upsampled to the half-cell navigation lattice. */

function carrierAt(sim: Simulation, x: number, y: number, boundTo?: Entity): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: CARRIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

/** A sawmill (workplace) holding `planks` finished planks ready to be hauled away. */
function sawmillAt(sim: Simulation, x: number, y: number, planks: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: SAWMILL, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[PLANK, planks]]) });
  return e;
}

function hqAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function granaryAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function settlerWithJob(sim: Simulation, x: number, y: number, jobType: number): Entity {
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
  return e;
}

describe('carrier — choosing what to haul', () => {
  it('sets a MoveGoal to a workplace holding haulable output when empty-handed and not on it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const hq = hqAt(sim, 4, 0); // a place to deliver them — and the carrier's post
    const carrier = carrierAt(sim, 0, 0, hq);
    const mill = sawmillAt(sim, 3, 0, 2); // 2 planks waiting

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(carrier, MoveGoal)).toBe(true);
    const millNode = cellAnchorNode(3, 0); // the mill's anchor node on the half-cell lattice
    expect(sim.world.get(carrier, MoveGoal).cell).toBe(sim.terrain?.nodeAt(millNode.hx, millNode.hy));
    void mill;
  });

  it('starts a pickup atomic when standing on a workplace with haulable output', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const hq = hqAt(sim, 4, 0);
    const carrier = carrierAt(sim, 3, 0, hq);
    const mill = sawmillAt(sim, 3, 0, 2); // same cell

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(carrier, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: PLANK, amount: 1, from: mill });
  });

  it('does not haul when no store can take the good (a wheat-only granary is no plank sink)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const granary = granaryAt(sim, 4, 0); // the carrier's post — but it has no plank slot
    const carrier = carrierAt(sim, 0, 0, granary);
    sawmillAt(sim, 3, 0, 2); // planks present, but nowhere that can stock them
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);
    expect(sim.world.has(carrier, CurrentAtomic)).toBe(false);
  });

  it('never delivers a workplace output back into the producing workplace (no livelock)', () => {
    // The sawmill could nominally stock a plank (it has a plank slot and room), but it is the
    // PRODUCER, so it is never picked as the deposit target — and with the carrier's own post unable
    // to take planks, there is nowhere valid to deliver → nothing is hauled.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const granary = granaryAt(sim, 4, 0);
    const carrier = carrierAt(sim, 0, 0, granary);
    sawmillAt(sim, 3, 0, 2);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);
  });

  it('never dumps a carried good into a loose ground pile (no full-store shuffle livelock)', () => {
    // Regression: a delivery SINK must be a TYPED store (Building/Vehicle), never a bare loose pile. A
    // loose pile has no store type, so its capacity reads as uncapped; if a carrier could "deliver" its
    // load there when every real store is full (or absent), a porter would immediately re-collect it and
    // the good would shuttle pile→back→pile forever. With only a loose pile present, there is nowhere
    // valid to deliver, so the carrier keeps its load and the pile never grows.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const carrier = carrierAt(sim, 0, 0);
    sim.world.add(carrier, Carrying, { goodType: PLANK, amount: 1 });
    const pile = sim.world.create(); // a bare hand-dropped heap of the same good — no Building marker
    sim.world.add(pile, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(pile, Stockpile, { amounts: new Map([[PLANK, 3]]) });

    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.get(pile, Stockpile).amounts.get(PLANK)).toBe(3); // the pile never grew
    expect(sim.world.get(carrier, Carrying).amount).toBe(1); // the carrier still holds its load
  });

  it('a porter skips a good its store is full of and hauls the deliverable one (limit reached → next good)', () => {
    // A warehouse FULL of wood (150/150) but with room for planks; a porter bound to it; two loose piles —
    // wood (nearer, but the store is full of it) and plank (farther, deliverable). "Limit is limit": the
    // porter must STOP collecting wood entirely and fetch the plank instead — not loop, not stall.
    const WOOD = 1;
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const wh = sim.world.create();
    sim.world.add(wh, Position, { x: fx.fromInt(7), y: fx.fromInt(0) });
    sim.world.add(wh, Building, { buildingType: 7, tribe: VIKING, built: ONE, level: 0 }); // warehouse, stocks 1..6
    sim.world.add(wh, Stockpile, { amounts: new Map([[WOOD, 150]]) }); // full for wood (cap 150)
    const porter = carrierAt(sim, 0, 0);
    sim.world.add(porter, JobAssignment, { workplace: wh }); // bound → a porter
    const woodPile = sim.world.create();
    sim.world.add(woodPile, Position, { x: fx.fromInt(2), y: fx.fromInt(0) });
    sim.world.add(woodPile, Stockpile, { amounts: new Map([[WOOD, 3]]) });
    const plankPile = sim.world.create();
    sim.world.add(plankPile, Position, { x: fx.fromInt(4), y: fx.fromInt(0) });
    sim.world.add(plankPile, Stockpile, { amounts: new Map([[PLANK, 3]]) });

    for (let i = 0; i < 450; i++) sim.step();

    expect(sim.world.get(wh, Stockpile).amounts.get(PLANK) ?? 0).toBe(3); // all the plank was hauled in
    expect(sim.world.get(woodPile, Stockpile).amounts.get(WOOD)).toBe(3); // the full good was left untouched
    expect(sim.world.has(porter, Carrying)).toBe(false); // the porter isn't stuck holding a surplus
  });

  it('an UNEMPLOYED settler and a LOOSE carrier never haul (transport is a worked assignment)', () => {
    // Planks wait at the sawmill and the HQ could take them — but hauling belongs to the carrier
    // trade AND to a post: a settler of another idle trade (the fixture farmer, nothing to farm
    // here) and a carrier with no binding both stand idle. Planner-level (aiSystem only), so the
    // JobSystem's report-in pass doesn't bind the loose carrier first.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    hqAt(sim, 4, 0);
    const loose = carrierAt(sim, 0, 0); // carrier trade, no post
    const farmer = settlerWithJob(sim, 1, 0, FARMER);
    sawmillAt(sim, 3, 0, 2);
    aiSystem(sim.world, ctxOf(sim));
    for (const e of [loose, farmer]) {
      expect(sim.world.has(e, MoveGoal)).toBe(false);
      expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    }
  });
});

describe('carrier — end-to-end haul through the real schedule', () => {
  it('a carrier moves planks from the sawmill to the HQ (goods conserved)', () => {
    // Strip: carrier@0, sawmill@1 (2 planks), HQ@2. Short hops keep it fast.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const carrier = carrierAt(sim, 0, 0);
    const mill = sawmillAt(sim, 1, 0, 2);
    const hq = hqAt(sim, 2, 0);

    let delivered = 0;
    for (let i = 0; i < 80 && delivered === 0; i++) {
      sim.step();
      delivered = sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0;
    }

    expect(delivered).toBe(1); // one unit hauled out and deposited
    // Goods are conserved: 2 planks total — one now in the HQ, one still at the sawmill.
    const atMill = sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0;
    expect(atMill + delivered).toBe(2);
    expect(sim.world.has(carrier, Carrying)).toBe(false); // unloaded at the HQ
  });

  it('empties the sawmill over a longer run — all planks reach the HQ, none created or lost', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const carrier = carrierAt(sim, 0, 0);
    const mill = sawmillAt(sim, 1, 0, 3);
    const hq = hqAt(sim, 2, 0);

    for (let i = 0; i < 400; i++) sim.step();

    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // sawmill drained
    expect(sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0).toBe(3); // exactly the 3 it held
    expect(sim.world.has(carrier, Carrying)).toBe(false);
  });
});

describe('carrier — determinism', () => {
  it('two same-seed runs of the haul reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 13, content: testContent(), map: grassMap(4, 1) });
      carrierAt(sim, 0, 0);
      sawmillAt(sim, 1, 0, 3);
      hqAt(sim, 2, 0);
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
