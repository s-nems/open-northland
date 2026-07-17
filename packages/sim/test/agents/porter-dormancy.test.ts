import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  MoveGoal,
  Position,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The porter rung's dormancy gate (economy/porter-dormancy.ts): a porter whose pickup scan found
 * nothing skips the identical re-scan, and — the property under test — WAKES on every input change
 * that could flip the answer. A missed wake is invisible to a single-pass test (the porter just
 * idles), so each case runs several empty planner passes first (going dormant) and then proves the
 * porter still reacts to the change. The elision itself is perf-only (byte-identical by design) and
 * is covered by the goldens plus the `cachesCoherent` dormancy verifier.
 */

const PLANK = 2;
const CARRIER = 36; // fixture job with NO allowedAtomics — it can't harvest, only haul
const HEADQUARTERS = 1; // passive store with a plank slot (capacity 150)
const HQ_PLANK_CAPACITY = 150;
const VIKING = 1;

function porterAt(sim: Simulation, x: number, y: number, boundTo: Entity): Entity {
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
  sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

function hqAt(sim: Simulation, x: number, y: number, planks = 0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(planks > 0 ? [[PLANK, planks]] : []) });
  return e;
}

function groundPileAt(sim: Simulation, x: number, y: number, planks: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[PLANK, planks]]) });
  return e;
}

/** Empty planner passes that take the porter through its failed scan into dormancy. */
function idlePasses(sim: Simulation, n = 3): void {
  for (let i = 0; i < n; i++) aiSystem(sim.world, ctxOf(sim));
}

describe('porter dormancy', () => {
  it('a dormant porter still reacts when a new ground pile appears', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = hqAt(sim, 5, 0);
    const porter = porterAt(sim, 0, 0, hq);
    idlePasses(sim); // nothing to fetch — the porter goes dormant
    expect(sim.world.has(porter, MoveGoal)).toBe(false);

    groundPileAt(sim, 3, 0, 2); // the Stockpile add bumps the membership generation — a wake
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, MoveGoal)).toBe(true);
  });

  it('a dormant porter still reacts when an in-place stock write frees its sink', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = hqAt(sim, 5, 0, HQ_PLANK_CAPACITY); // the porter's post, full of planks — no sink
    const porter = porterAt(sim, 0, 0, hq);
    groundPileAt(sim, 3, 0, 2); // a pile it would fetch, were the plank deliverable
    idlePasses(sim); // undeliverable everywhere — the porter goes dormant
    expect(sim.world.has(porter, MoveGoal)).toBe(false);

    // The elision is real: a bare Map write (bypassing setStockAmount, the seam every system stock
    // write goes through) is invisible to the dormant porter — and the coherence verifier catches
    // exactly this incoherence, so a future unlogged write cannot slip past invariant-checked runs.
    sim.world.get(hq, Stockpile).amounts.set(PLANK, 0);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, MoveGoal)).toBe(false);
    expect(sim.world.verifyCaches().some((m) => m.includes('porter'))).toBe(true);

    // Logged through the seam (the value generation the dormancy version tracks), the freed sink
    // wakes the porter.
    sim.world.touchComponent(Stockpile);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, MoveGoal)).toBe(true);
  });

  it('a dormant porter re-scans after being displaced (its confinement circle moved with it)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = hqAt(sim, 5, 0);
    const porter = porterAt(sim, 0, 0, hq);
    idlePasses(sim);
    expect(sim.world.has(porter, MoveGoal)).toBe(false);

    groundPileAt(sim, 3, 0, 2);
    // A pile appearing and the porter moving in the same window must not mask each other: shift the
    // porter (node change), then plan — the entry mismatches on both fields and the scan re-runs.
    sim.world.get(porter, Position).x = fx.fromInt(1);
    sim.world.touch(porter);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, MoveGoal)).toBe(true);
  });
});
