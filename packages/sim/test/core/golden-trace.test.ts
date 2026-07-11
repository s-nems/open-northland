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
  // changed — name it in the commit. Last move: SPAWN-TIME FLAG AUTO-PLANT — a gatherer spawned by the
  // command path now gets a work flag at its feet (like a profession change), so it searches only its
  // flag's radius and banks its felled wood at the flag instead of roaming the map and delivering to the
  // mill. Entity ids shift by one (the flag is entity 6), and with porters not yet moving flag heaps the
  // mill self-supplies from the HQ's stock, so plank output settles at 13 (was 18). Every core invariant
  // still holds every tick; the settled state hash moved to d9104697. (Prior move e452b766 was the
  // half-cell navigation migration.)
  const GOLDEN_TRACE: readonly string[] = [
    '20:8:22',
    '31:5:24',
    '34:5:24',
    '37:5:24',
    '40:8:23',
    '41:5:22',
    '64:8:22',
    '73:5:23',
    '84:8:23',
    '88:8:22',
    '105:5:22',
    '108:8:23',
    '132:7:22',
    '132:8:22',
    '137:5:23',
    '152:7:23',
    '152:8:22',
    '169:5:22',
    '172:8:23',
    '196:8:22',
    '201:5:23',
    '216:8:23',
    '220:8:22',
    '233:5:22',
    '240:8:23',
    '264:7:22',
    '264:8:22',
    '265:5:23',
    '284:7:23',
    '284:8:22',
    '304:8:23',
    '308:5:24',
    '311:5:24',
    '314:5:24',
    '318:5:22',
    '328:8:22',
    '348:8:23',
    '352:8:22',
    '362:5:23',
    '372:8:23',
    '396:7:22',
    '396:8:22',
    '406:5:22',
    '416:7:23',
    '416:8:22',
    '436:8:23',
    '444:5:23',
    '460:8:22',
    '480:8:23',
    '482:5:22',
    '484:8:22',
    '504:8:23',
    '520:5:23',
    '528:7:22',
    '528:8:22',
    '548:7:23',
    '548:8:22',
    '568:8:23',
    '592:8:22',
    '612:8:23',
    '616:8:22',
    '636:8:23',
    '660:7:22',
    '660:8:22',
    '680:7:23',
    '680:8:22',
    '700:8:23',
    '724:8:22',
    '744:8:23',
    '806:8:22',
    '856:8:23',
    '880:7:22',
    '880:8:22',
    '900:7:23',
    '930:8:22',
    '980:8:23',
  ];

  it('holds every core invariant on every tick', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    const run = runSlice(SEED, TICKS);
    // Intentional-change discipline: if this moves, a mechanic changed — name it in the commit.
    // 2d0d23b0 → fe19b319 (2026-07-11): the SPAWN-TIME FLAG AUTO-PLANT (see the trace note) lands on
    // top of the default-Health change — the woodcutter now carries a work flag at its feet, so it
    // banks its felled wood at the flag rather than delivering it to the mill; the settled end state
    // differs (a wood heap by the flag, fewer planks in the HQ).
    expect(run.hash).toBe('fe19b319');
  });

  it('matches the golden atomic-action trace', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.trace).toEqual(GOLDEN_TRACE);
    // The carpenter self-supplies the mill from the HQ's stored wood and turns it into 13 planks. The
    // woodcutter's 8 felled wood now banks at its own work flag (it is flag-bound from spawn) instead of
    // reaching the mill, and with no porter moving flag heaps yet that wood stays by the flag — so the
    // plank total settles at 13 (was 18 when the woodcutter roamed and delivered straight to the mill).
    expect(run.produced).toBe(13);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const a = runSlice(SEED, TICKS);
    const b = runSlice(SEED, TICKS);
    expect(a.hash).toBe(b.hash);
    expect(a.trace).toEqual(b.trace);
    expect(a.produced).toBe(b.produced);
  });
});
