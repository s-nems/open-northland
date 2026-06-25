import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
} from '../src/components/index.js';
import { CORE_INVARIANTS, Simulation, type TerrainMap, checkInvariants, fx } from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * GOLDEN STATE-HASH + GOLDEN ATOMIC-ACTION TRACE — the Phase-2 determinism tripwire (ROADMAP).
 *
 * The lower-level golden tests pin one mechanic each over tens of ticks; this is the *integration*
 * golden. It drives the **whole vertical slice** end-to-end for ~1000 ticks through the real
 * `Simulation.step()` schedule (CommandSystem → AI planner → pathfinding → movement → atomic executor
 * → production → carrier) and pins two complementary fingerprints of the run:
 *
 *  - the final canonical **state hash** (`hashState()`) — every component on every entity; one bit of
 *    drift anywhere changes it. This catches *that* something changed.
 *  - the **atomic-action trace** — the ordered list of `atomicCompleted` events as
 *    `"tick:entity:atomicId"`, collected every tick. The hash says state diverged; the trace says
 *    *which behavior* diverged and *when*, in human-readable terms. This is the agent's self-check
 *    that the settler economy still does the same thing tick-for-tick. The atomic ids are the
 *    fixture's vocabulary: 24 = harvest (the woodcutter), 23 = pileup (deposit at a store), 22 =
 *    pickup (the carrier hauling planks out of the workplace).
 *
 * Invariants run **after every tick** (not just at the end), so a system that transiently breaks the
 * world (negative stock, hunger out of range) is caught at the exact tick it happens, not masked by a
 * later recovery. If any golden below moves, it must be an *intentional* mechanic change — name it in
 * the commit (see packages/sim/CLAUDE.md "the golden rule of the goldens").
 *
 * Scenario (a self-supplying woodcutter + a carrier — the slice's exit goal):
 *   - a 6×1 grass strip;
 *   - a HEADQUARTERS store (x=5) and a SAWMILL workplace (x=4), both placed via the COMMAND log
 *     (exercising CommandSystem) so the run also pins the placement seam;
 *   - a WOODCUTTER and a CARRIER spawned via commands, plus a CARPENTER spawned **on** the sawmill
 *     (x=4) as its operator — the SAWMILL's `workers` slot names the carpenter job, and the
 *     production worker-presence gate only runs the mill while that operator is present (the planner
 *     pins a settler standing on a workplace it staffs, so the carpenter stays put);
 *   - two finite wood nodes of 4 units each (placed directly — there is no map/resource command yet).
 * The whole goods chain runs end to end and conserves goods: the woodcutter harvests all 8 wood and
 * piles it at the SAWMILL (its nearest store with a wood slot) → the staffed sawmill produces 8 planks
 * → the carrier hauls every plank out to the HQ. The run settles into a steady state and stays
 * invariant-clean for the whole 1000-tick tail.
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const CARPENTER = 2; // the sawmill's `workers` jobType — its operator
const CARRIER = 36;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const VIKING = 1;
const HARVEST_ATOMIC = 24;

// Component stores are module-level singletons — clear every store this slice touches so the run is
// scoped to this test regardless of execution order (see atomic-planner.test.ts).
function clearStores(): void {
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
  ]) {
    c.store.clear();
  }
}

beforeEach(clearStores);

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

interface GoldenRun {
  readonly hash: string;
  /** The atomic-action trace as compact `"tick:entity:atomicId"` strings — the behavioral fingerprint. */
  readonly trace: readonly string[];
  readonly produced: number;
  readonly invariantViolations: readonly string[];
}

/**
 * Build the slice world (command-driven placement + direct resource nodes), run `ticks` ticks
 * through the real schedule, and collect the final state hash, the per-tick atomic trace, the count
 * of `goodProduced` events, and the first invariant violation (checked every tick).
 */
function runSlice(seed: number, ticks: number): GoldenRun {
  clearStores();
  const sim = new Simulation({ seed, content: testContent(), map: grassMap(6, 1) });

  // Placement via the command log (CommandSystem applies these on tick 1) — the seam the UI uses.
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: 4, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: CARRIER, x: 1, y: 0, tribe: VIKING });
  // The sawmill's operator (carpenter) is spawned standing ON the sawmill (x=4): the worker-presence
  // gate runs the mill only while it is staffed, and the planner pins a settler on a workplace it
  // staffs so the carpenter stays put.
  sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 4, y: 0, tribe: VIKING });

  // Finite wood nodes (no resource command exists yet — placed directly, like the lower goldens).
  for (const x of [2, 3]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
  }

  const trace: string[] = [];
  let produced = 0;
  const invariantViolations: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    for (const ev of sim.events.current()) {
      if (ev.kind === 'atomicCompleted') trace.push(`${sim.tick}:${ev.entity}:${ev.atomicId}`);
      else if (ev.kind === 'goodProduced') produced += ev.amount;
    }
    if (invariantViolations.length === 0) {
      const v = checkInvariants(sim.world, CORE_INVARIANTS);
      if (v.length > 0) invariantViolations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
  }
  return { hash: sim.hashState(), trace, produced, invariantViolations };
}

describe('golden: the vertical slice over ~1000 ticks', () => {
  const TICKS = 1000;
  const SEED = 7;

  // The golden atomic-action trace: harvest(24)/pileup(23) by the woodcutter (entity 5) and
  // pickup(22)/pileup(23) by the carrier (entity 6), settling once both trees and the sawmill's
  // planks are exhausted. If this moves, a settler-economy mechanic changed — name it in the commit.
  const GOLDEN_TRACE: readonly string[] = [
    '13:5:24',
    '27:5:23',
    '36:5:24',
    '46:5:23',
    '55:5:24',
    '65:5:23',
    '65:6:22',
    '74:5:24',
    '75:6:23',
    '84:5:23',
    '85:6:22',
    '93:5:24',
    '95:6:23',
    '103:5:23',
    '105:6:22',
    '115:6:23',
    '116:5:24',
    '125:6:22',
    '130:5:23',
    '135:6:23',
    '143:5:24',
    '145:6:22',
    '155:6:23',
    '157:5:23',
    '165:6:22',
    '170:5:24',
    '175:6:23',
    '184:5:23',
    '187:6:22',
    '188:5:22',
    '197:6:23',
    '208:5:22',
    '218:5:23',
  ];

  it('holds every core invariant on every tick', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    const run = runSlice(SEED, TICKS);
    // Intentional-change discipline: if this moves, a mechanic changed — name it in the commit.
    // Moved by the NeedsSystem fatigue rise: settlers now carry a second need field, `fatigue`,
    // growing ONE/8192 per tick (it was added at 0), so each settler's state — and thus the canonical
    // hash — shifts (db68cc53 → ff907e9a). Behavior is unchanged: the atomic trace + 8-plank output
    // below are identical (no sleep drive yet — fatigue only rises, never reaches its threshold here).
    expect(run.hash).toBe('ff907e9a');
  });

  it('matches the golden atomic-action trace', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.trace).toEqual(GOLDEN_TRACE);
    expect(run.produced).toBe(8); // the sawmill turns all 8 harvested wood into 8 planks over the run
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const a = runSlice(SEED, TICKS);
    const b = runSlice(SEED, TICKS);
    expect(a.hash).toBe(b.hash);
    expect(a.trace).toEqual(b.trace);
    expect(a.produced).toBe(b.produced);
  });
});
