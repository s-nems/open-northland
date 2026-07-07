import { beforeEach, describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  Carrying,
  CurrentAtomic,
  Felling,
  GroundDrop,
  JobAssignment,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
  Stump,
} from '../../src/components/index.js';
import { CORE_INVARIANTS, Simulation, type TerrainMap, checkInvariants, fx } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * GOLDEN STATE-HASH + GOLDEN ATOMIC-ACTION TRACE — the Phase-2 determinism tripwire (plan).
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
 * the commit (see packages/sim/AGENTS.md "the golden rule of the goldens").
 *
 * Scenario (a self-supplying woodcutter + a self-servicing carpenter + a carrier — the slice's exit goal):
 *   - a 6×1 grass strip;
 *   - a HEADQUARTERS store (x=5, starting with 10 wood) and a SAWMILL workplace (x=4), both placed via
 *     the COMMAND log (exercising CommandSystem) so the run also pins the placement seam;
 *   - a WOODCUTTER and a CARRIER spawned via commands, plus a CARPENTER spawned **on** the sawmill
 *     (x=4) as its operator — the SAWMILL's `workers` slot names the carpenter job, and the production
 *     worker-presence gate only runs the mill while that operator is present;
 *   - two finite FELLABLE wood nodes (placed directly — no map/resource command yet), each felled over
 *     3 chops and dropping a 4-wood trunk (the wood good's `gathering` felling spec).
 * The whole goods chain runs end to end and conserves goods: the woodcutter FELLS each tree (3 chops
 * yielding nothing → the tree drops a ground trunk holding its whole 4 wood), then carries the trunk off
 * a unit at a time to the SAWMILL (its nearest store with a wood slot, never back to the trunk) → the
 * carpenter runs its own supply→produce→deliver loop, ALSO fetching the HQ's 10 starting wood into the
 * mill (the input-supply drive) and hauling finished planks back out → so all **18** wood (10 stored + 8
 * felled) becomes 18 planks that end up in the HQ, with the carrier helping haul, and 2 stumps are left
 * where the trees stood. Conserved (18 wood in → 18 planks out, verified: 0 wood + 18 planks remain),
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
    Felling,
    Stump,
    GroundDrop,
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

  // Finite FELLABLE wood nodes (no resource command exists yet — placed directly, like the lower
  // goldens). The wood good declares the felling lifecycle (chops + whole yield), so each tree is
  // chopped DOWN over several swings and drops a trunk the collector then carries off — the multi-hit
  // harvest + drop-on-ground (plan Phase 3). `yieldPerNode` 4 keeps each tree worth 4 wood (2 trees
  // → 8 harvested), so the goods total is unchanged (10 stored + 8 → 18 planks).
  const woodFell = sim.content.goods.find((g) => g.id === 'wood')?.gathering;
  for (const x of [2, 3]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, {
      goodType: WOOD,
      remaining: woodFell?.yieldPerNode ?? 0,
      harvestAtomic: HARVEST_ATOMIC,
    });
    sim.world.add(tree, Felling, { chopsLeft: woodFell?.chopsToFell ?? 0 });
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

  // The golden atomic-action trace. Atomic ids: 24 = harvest/CHOP (a swing at a tree), 23 = pileup
  // (deposit into a store), 22 = pickup (lift out of a store / off a trunk). Entity 5 = woodcutter, 6 =
  // carrier (hauls planks to the HQ), 7 = carpenter (the mill's operator, self-servicing: it pickups the
  // HQ's stored wood into the mill and hauls finished planks back out). If this moves, a settler-economy
  // mechanic changed — name it in the commit. Last move: FAITHFUL MULTI-HIT HARVEST + DROP-ON-GROUND
  // (packages/sim/src/systems/conflict/atomic.ts + ai.ts). A wood node is now FELLED — the woodcutter
  // (entity 5) chops each tree down over `chopsToFell` (3) swings (24 at 21/24/27) that yield nothing,
  // the tree drops a trunk holding its whole 4-wood yield, and the collector then picks the trunk up (22)
  // and delivers it (23), a unit at a time (on-foot carry). So entity 5's old "one 24 per unit straight
  // onto the back" became "3 chops then 22/23 trips per tree", moving the trace + hash. Goods stay
  // conserved (10 stored + 8 felled → 18 planks, produced 18) and every core invariant holds every tick;
  // the settled state hash shifts (a4fa8225 → 1260b766). (The prior move, a4fa8225, was the producer
  // self-service drive.)
  const GOLDEN_TRACE: readonly string[] = [
    '14:7:22',
    '21:5:24',
    '24:5:24',
    '27:5:24',
    '28:7:23',
    '31:5:22',
    '52:7:22',
    '53:5:23',
    '66:7:23',
    '66:5:24',
    '69:5:24',
    '72:5:24',
    '76:5:22',
    '84:6:22',
    '84:7:22',
    '90:5:23',
    '98:6:23',
    '104:5:22',
    '118:5:23',
    '132:5:22',
    '137:6:22',
    '146:5:23',
    '147:7:22',
    '151:6:23',
    '160:5:22',
    '161:7:23',
    '174:5:23',
    '177:7:22',
    '191:7:23',
    '196:5:22',
    '205:6:22',
    '205:7:22',
    '218:5:23',
    '219:6:23',
    '219:7:22',
    '233:7:23',
    '240:5:22',
    '255:6:22',
    '262:5:23',
    '265:7:22',
    '269:6:23',
    '279:7:23',
    '284:5:22',
    '293:7:22',
    '306:5:23',
    '307:7:23',
    '333:5:22',
    '333:6:22',
    '333:7:22',
    '347:5:23',
    '347:7:22',
    '361:7:23',
    '385:6:22',
    '385:7:22',
    '399:6:23',
    '399:7:22',
    '413:7:23',
    '437:5:22',
    '437:7:22',
    '451:5:23',
    '451:7:22',
    '465:7:23',
    '489:6:22',
    '489:7:22',
    '503:6:23',
    '503:7:22',
    '517:7:23',
    '541:5:22',
    '541:7:22',
    '555:5:23',
    '555:7:22',
    '569:7:23',
    '593:6:22',
    '593:7:22',
    '607:6:23',
    '607:7:22',
    '621:7:23',
    '645:5:22',
    '645:7:22',
    '659:5:23',
    '659:7:22',
    '673:7:23',
    '697:6:22',
    '697:7:22',
    '711:6:23',
    '711:7:22',
    '725:7:23',
    '749:5:22',
    '749:7:22',
    '763:5:23',
  ];

  it('holds every core invariant on every tick', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    const run = runSlice(SEED, TICKS);
    // Intentional-change discipline: if this moves, a mechanic changed — name it in the commit.
    // Moved by FAITHFUL MULTI-HIT HARVEST + DROP-ON-GROUND (packages/sim/src/systems/conflict/atomic.ts
    // + ai.ts): the woodcutter now FELLS each tree over several chops that yield nothing, the tree drops
    // a ground trunk holding its whole yield, and the collector carries the trunk off — so the two trees
    // leave 2 stumps + no standing nodes (vs the old 2 depleted `remaining:0` Resource nodes) and the run
    // routes wood through trunk piles. Goods stay conserved (10 stored + 8 felled → 18 planks) and every
    // core invariant holds every tick; the settled state hash shifts (a4fa8225 → 1260b766).
    expect(run.hash).toBe('1260b766');
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
