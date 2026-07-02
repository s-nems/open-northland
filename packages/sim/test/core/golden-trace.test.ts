import { beforeEach, describe, expect, it } from 'vitest';
import {
  Age,
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
import { CORE_INVARIANTS, Simulation, type TerrainMap, checkInvariants, fx } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

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
 * Scenario (a self-supplying woodcutter + a self-servicing carpenter + a carrier — the slice's exit goal):
 *   - a 6×1 grass strip;
 *   - a HEADQUARTERS store (x=5, starting with 10 wood) and a SAWMILL workplace (x=4), both placed via
 *     the COMMAND log (exercising CommandSystem) so the run also pins the placement seam;
 *   - a WOODCUTTER and a CARRIER spawned via commands, plus a CARPENTER spawned **on** the sawmill
 *     (x=4) as its operator — the SAWMILL's `workers` slot names the carpenter job, and the production
 *     worker-presence gate only runs the mill while that operator is present;
 *   - two finite wood nodes of 4 units each (placed directly — there is no map/resource command yet).
 * The whole goods chain runs end to end and conserves goods: the woodcutter harvests all 8 tree-wood
 * and piles it at the SAWMILL (its nearest store with a wood slot) → the carpenter runs its own
 * supply→produce→deliver loop, ALSO fetching the HQ's 10 starting wood into the mill (the input-supply
 * drive) and hauling finished planks back out → so all **18** wood (10 stored + 8 harvested) becomes 18
 * planks that end up in the HQ, with the carrier helping haul. Conserved (18 wood in → 18 planks out,
 * verified: 0 wood + 18 planks remain), invariant-clean for the whole 1000-tick tail.
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
    JobAssignment,
    Age,
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

  // The golden atomic-action trace. Atomic ids: 24 = harvest, 23 = pileup (deposit into a store), 22 =
  // pickup (lift out of a store). Entity 5 = woodcutter (harvests tree-wood, delivers it to the mill,
  // then carries at the end), 6 = carrier (hauls planks to the HQ), 7 = carpenter (the mill's operator,
  // now self-servicing: it pickups the HQ's stored wood into the mill and hauls finished planks back
  // out — the pickup(22)/pileup(23) pairs on entity 7). If this moves, a settler-economy mechanic
  // changed — name it in the commit. Last move: the producer self-service drive (packages/sim/src/
  // systems/conflict/ai-supply.ts) — a bound workshop worker now FETCHES the recipe inputs it lacks
  // from any store that holds them and HAULS its own finished output out, instead of only staffing the
  // tile. So the carpenter also pulls the HQ's 10 starting wood into production (8 → 18 planks) and the
  // trace/hash move to the new self-servicing steady state (produced 18, hash a4fa8225).
  const GOLDEN_TRACE: readonly string[] = [
    '14:7:22',
    '21:5:24',
    '28:7:23',
    '43:5:23',
    '56:5:24',
    '70:5:23',
    '72:7:22',
    '78:6:22',
    '83:5:24',
    '86:7:23',
    '92:6:23',
    '97:5:23',
    '110:5:24',
    '111:6:22',
    '121:7:22',
    '124:5:23',
    '125:6:23',
    '135:7:23',
    '137:5:24',
    '151:5:23',
    '165:6:22',
    '172:5:24',
    '175:7:22',
    '179:6:23',
    '189:7:23',
    '193:7:22',
    '194:5:23',
    '207:7:23',
    '215:5:24',
    '229:6:22',
    '237:5:23',
    '239:7:22',
    '243:6:23',
    '253:7:23',
    '258:5:24',
    '268:7:22',
    '280:5:23',
    '282:7:23',
    '308:5:22',
    '308:6:22',
    '308:7:22',
    '322:5:23',
    '322:7:22',
    '336:7:23',
    '360:6:22',
    '360:7:22',
    '374:6:23',
    '374:7:22',
    '388:7:23',
    '412:5:22',
    '412:7:22',
    '426:5:23',
    '426:7:22',
    '440:7:23',
    '464:6:22',
    '464:7:22',
    '478:6:23',
    '478:7:22',
    '492:7:23',
    '516:5:22',
    '516:7:22',
    '530:5:23',
    '530:7:22',
    '544:7:23',
    '568:6:22',
    '568:7:22',
    '582:6:23',
    '582:7:22',
    '596:7:23',
    '620:5:22',
    '620:7:22',
    '634:5:23',
    '634:7:22',
    '648:7:23',
    '672:6:22',
    '672:7:22',
    '686:6:23',
    '686:7:22',
    '700:7:23',
    '724:5:22',
    '724:7:22',
    '738:5:23',
  ];

  it('holds every core invariant on every tick', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    const run = runSlice(SEED, TICKS);
    // Intentional-change discipline: if this moves, a mechanic changed — name it in the commit.
    // Moved by the producer self-service drive (packages/sim/src/systems/conflict/ai-supply.ts): the
    // carpenter now fetches the recipe inputs its mill lacks from any store that holds them and hauls
    // its own finished output out — so it drains the HQ's 10 starting wood into the mill as well as the
    // 8 harvested wood, producing 18 planks (vs the old pinned-operator's 8). Goods stay conserved (18
    // wood in → 18 planks out) and every core invariant holds every tick; the settled state hash shifts
    // (469da255 → a4fa8225). (The prior move, 469da255, was the JobSystem worker→workplace binding.)
    expect(run.hash).toBe('a4fa8225');
  });

  it('matches the golden atomic-action trace', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.trace).toEqual(GOLDEN_TRACE);
    // All 18 wood (10 stored in the HQ + 8 harvested) becomes 18 planks — the carpenter self-supplies
    // the mill from the HQ's stock, not just the woodcutter's deliveries.
    expect(run.produced).toBe(18);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const a = runSlice(SEED, TICKS);
    const b = runSlice(SEED, TICKS);
    expect(a.hash).toBe(b.hash);
    expect(a.trace).toEqual(b.trace);
    expect(a.produced).toBe(b.produced);
  });
});
