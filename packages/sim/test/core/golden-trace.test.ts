import { beforeEach, describe, expect, it } from 'vitest';
import { Felling, Position, Resource } from '../../src/components/index.js';
import {
  CORE_INVARIANTS,
  checkInvariants,
  fx,
  halfCellMapFromCells,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

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
 * yielding nothing → the tree drops a ground trunk holding its whole 4 wood) and banks the felled wood
 * at its own work flag → the CARRIER — posted to the HQ's transport slot on tick 1 by the JobSystem's
 * report-in pass (hauling is worked only through an assignment) — ferries the flag-banked wood into
 * the HQ and hauls finished planks there too → the carpenter runs its own supply→produce→deliver
 * loop, fetching the HQ's wood into the mill (the input-supply drive) and hauling planks back out.
 * 2 stumps are left where the trees stood; goods are conserved throughout, invariant-clean for the
 * whole 1000-tick tail (10 stored + 8 felled wood; 16 planks complete inside the window — see the
 * produced note).
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

beforeEach(clearComponentStores);

function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
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
  clearComponentStores();
  const sim = new Simulation({ seed, content: testContent(), map: grassMap(6, 1) });

  // Placement via the command log (CommandSystem applies these on tick 1) — the seam the UI uses.
  // Command coords are half-cell nodes: cell x on row 0 sits at node (2x, 0).
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 10, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: 8, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: CARRIER, x: 2, y: 0, tribe: VIKING });
  // The sawmill's operator (carpenter) is spawned standing ON the sawmill (node 8): the worker-presence
  // gate runs the mill only while it is staffed, and the planner pins a settler on a workplace it
  // staffs so the carpenter stays put.
  sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 8, y: 0, tribe: VIKING });

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
  // its WORK FLAG (auto-planted at its feet when it spawns — a gatherer is never free; it carries no
  // atomics), 7 = carrier, 8 = carpenter (the mill's operator, self-servicing: it pickups the HQ's stored
  // wood into the mill and hauls finished planks back out). If this moves, a settler-economy mechanic
  // changed — name it in the commit. Last move: CARRIER-BY-ASSIGNMENT — hauling is now worked only by
  // an employed carrier (the trade AND a binding; "bezrobotny to bezrobotny", nobody freelances), the
  // HQ fixture gained its transport slot (the original HQ's `logicworker 24` shape) and the JobSystem's
  // report-in pass posts the loose carrier there on tick 1. The posted carrier also PORTERS: it ferries
  // the wood banked at the woodcutter's flag into the HQ (its bound store), so more wood reaches the
  // carpenter's supply loop and two more planks land inside the run (16, was 14); the rebase onto
  // main folded in its INTER-SWING REST (a breather tail every few harvest swings), so the woodcutter's
  // chop bursts sit wider apart and the whole cadence downstream shifts with them. (Prior moves:
  // PRODUCER FETCH-BEFORE-HAUL + WORK-INSIDE; SPAWN-TIME FLAG AUTO-PLANT; e452b766 — the half-cell
  // navigation migration.)
  const GOLDEN_TRACE: readonly string[] = [
    '20:8:22',
    '31:5:24',
    '40:8:23',
    '49:5:24',
    '52:5:24',
    '56:5:22',
    '72:7:22',
    '80:8:22',
    '88:5:23',
    '100:8:23',
    '116:7:23',
    '120:5:22',
    '140:8:22',
    '152:5:23',
    '160:7:22',
    '160:8:23',
    '199:5:24',
    '200:8:22',
    '204:7:23',
    '217:5:24',
    '220:5:24',
    '220:8:23',
    '224:5:22',
    '260:8:22',
    '268:5:23',
    '272:7:22',
    '280:8:23',
    '312:5:22',
    '320:8:22',
    '340:7:23',
    '340:8:23',
    '356:5:23',
    '380:8:22',
    '400:8:23',
    '408:7:22',
    '440:8:22',
    '460:8:23',
    '476:7:23',
    '500:8:22',
    '520:8:23',
    '544:7:22',
    '560:8:22',
    '580:8:23',
    '612:7:23',
    '620:8:22',
    '640:8:23',
    '680:7:22',
    '680:8:22',
    '700:8:23',
    '740:8:22',
    '748:7:23',
    '760:8:23',
    '768:7:22',
    '788:7:23',
    '800:8:22',
    '808:7:22',
    '820:8:23',
    '828:7:23',
    '848:7:22',
    '860:8:22',
    '868:7:23',
    '880:8:23',
    '888:7:22',
    '908:7:23',
    '920:8:22',
    '928:7:22',
    '940:8:23',
    '948:7:23',
    '968:7:22',
    '980:8:22',
    '988:7:23',
    '1000:8:23',
  ];

  it('holds every core invariant on every tick', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    const run = runSlice(SEED, TICKS);
    // Intentional-change discipline: if this moves, a mechanic changed — name it in the commit.
    // fe19b319 → d58a6716 (2026-07-12): CARRIER-BY-ASSIGNMENT (see the trace note) — the carrier now
    // works as the HQ's posted transport (JobAssignment on tick 1) and ferries the flag-banked wood
    // in, so the settled goods distribution differs (two more planks through, the flag pile drained) —
    // combined with main's INTER-SWING REST timing folded in by the rebase.
    expect(run.hash).toBe('d58a6716');
  });

  it('matches the golden atomic-action trace', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.trace).toEqual(GOLDEN_TRACE);
    // The carpenter self-supplies the mill from the HQ's stored wood, and the HQ-posted carrier now
    // ferries the woodcutter's flag-banked wood into the HQ too (the porter rung of its assignment),
    // so more of the 8 felled wood feeds the supply loop: the plank total settles at 16 inside the
    // 1000-tick window (was 14 when the flag pile just sat there).
    expect(run.produced).toBe(16);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const a = runSlice(SEED, TICKS);
    const b = runSlice(SEED, TICKS);
    expect(a.hash).toBe(b.hash);
    expect(a.trace).toEqual(b.trace);
    expect(a.produced).toBe(b.produced);
  });
});
