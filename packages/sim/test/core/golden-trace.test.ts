import { describe, expect, it } from 'vitest';
import { Building, Felling, Position, Resource, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CORE_INVARIANTS, checkInvariants, fx, Simulation } from '../../src/index.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * GOLDEN STATE-HASH + GOLDEN ATOMIC-ACTION TRACE - the determinism tripwire.
 *
 * The lower-level golden tests pin one mechanic each over tens of ticks; this is the *integration*
 * golden. It drives the **whole vertical slice** end-to-end for ~1000 ticks through the real
 * `Simulation.step()` schedule (CommandSystem → AI planner → pathfinding → movement → atomic executor
 * → production → carrier) and pins two complementary fingerprints of the run:
 *
 *  - the final canonical **state hash** (`hashState()`) - every component on every entity; one bit of
 *    drift anywhere changes it. This catches *that* something changed.
 *  - the **atomic-action trace** - the ordered list of `atomicCompleted` events as
 *    `"tick:entity:atomicId"`, collected every tick. The hash says state diverged; the trace says
 *    *which behavior* diverged and *when*, in human-readable terms. This is the agent's self-check
 *    that the settler economy still does the same thing tick-for-tick. The atomic ids are the
 *    fixture's vocabulary: 24 = harvest (the woodcutter), 23 = pileup (deposit at a store), 22 =
 *    pickup (the carrier hauling planks out of the workplace).
 *
 * Invariants run **after every tick** (not just at the end), so a system that transiently breaks the
 * world (negative stock, hunger out of range) is caught at the exact tick it happens, not masked by a
 * later recovery. If any golden below moves, it must be an *intentional* mechanic change - name it in
 * the commit (see packages/sim/AGENTS.md "the golden rule of the goldens").
 *
 * Scenario (a self-supplying woodcutter + a self-servicing carpenter + a carrier - the slice's exit goal):
 *   - a 6×1 grass strip;
 *   - a HEADQUARTERS store (x=5, starting with 10 wood) and a SAWMILL workplace (x=4), both placed via
 *     the COMMAND log (exercising CommandSystem) so the run also pins the placement seam;
 *   - a WOODCUTTER and a CARRIER spawned via commands, plus a CARPENTER spawned **on** the sawmill
 *     (x=4) as its operator - the SAWMILL's `workers` slot names the carpenter job, and the production
 *     worker-presence gate only runs the mill while that operator is present;
 *   - two finite FELLABLE wood nodes (placed directly - no map/resource command yet), each felled over
 *     3 chops and dropping a 4-wood trunk (the wood good's `gathering` felling spec).
 * The whole goods chain runs end to end and conserves goods: the woodcutter FELLS each tree (3 chops
 * yielding nothing → the tree drops a ground trunk holding its whole 4 wood) and banks the felled wood
 * at its own work flag → the CARRIER - posted to the HQ's transport slot on tick 1 (hauling is worked
 * only through an assignment, and nothing employs a settler on its own) - ferries the flag-banked wood
 * into the HQ and hauls finished planks there too → the carpenter runs its own supply→produce→deliver
 * loop, fetching the HQ's wood into the mill (the input-supply drive) and hauling planks back out.
 * 2 stumps are left where the trees stood; goods are conserved throughout, invariant-clean for the
 * whole 1000-tick tail (10 stored + 8 felled wood; the produced count is pinned below).
 */

const WOOD = 1;
const WOODCUTTER = 1;
const CARPENTER = 2; // the sawmill's `workers` jobType - its operator
const CARRIER = 36;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const VIKING = 1;
const HUMAN = 0; // the owner the posted crew needs - assignWorker is an owned-unit order
const HARVEST_ATOMIC = 24;

interface GoldenRun {
  readonly hash: string;
  /** The atomic-action trace as compact `"tick:entity:atomicId"` strings - the behavioral fingerprint. */
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
  const sim = new Simulation({ seed, content: testContent(), map: grassMap(6, 1) });

  // Placement via the command log (CommandSystem applies these on tick 1) - the seam the UI uses.
  // Command coords are half-cell nodes: cell x on row 0 sits at node (2x, 0).
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 10, y: 0, tribe: VIKING });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: SAWMILL, x: 8, y: 0, tribe: VIKING });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
  // The two settlers the slice POSTS carry an owner: `assignWorker` is an owned-unit order. The
  // woodcutter and the buildings stay neutral (a neutral owner is compatible with any), so only the
  // posting itself gained a prerequisite.
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: CARRIER, x: 2, y: 0, tribe: VIKING, owner: HUMAN });
  // The sawmill's operator (carpenter) is spawned standing ON the sawmill (node 8): the worker-presence
  // gate runs the mill only while it is staffed, and the planner pins a settler on a workplace it
  // staffs so the carpenter stays put. It spawns with the fixture's `needforgood PLANK` threshold
  // earned (30 wood-track repeats × factor 10) so the slice keeps exercising production; the unearned
  // path is craft-selection.cases.ts. Seeded XP alters only the state hash, never the trace.
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: CARPENTER,
    x: 8,
    y: 0,
    tribe: VIKING,
    owner: HUMAN,
    experience: [[1, 300]],
  });

  // Finite FELLABLE wood nodes (no resource command exists yet - placed directly, like the lower
  // goldens). The wood good declares the felling lifecycle (chops + whole yield), so each tree is
  // chopped DOWN over several swings and drops a trunk the collector then carries off - the multi-hit
  // harvest + drop-on-ground. `yieldPerNode` 4 keeps each tree worth 4 wood (2 trees
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
    stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
    sim.world.add(tree, Felling, { chopsLeft: woodFell?.chopsToFell ?? 0 });
  }

  const trace: string[] = [];
  let produced = 0;
  const invariantViolations: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    // Employment is directed, never automatic, so the slice posts its own crew: the carpenter to the
    // sawmill it stands on and the carrier to the HQ's transport slot. Enqueued after tick 1, the first
    // tick on which the CommandSystem has created the buildings and settlers these commands name.
    if (sim.tick === 1) staffSlice(sim);
    for (const ev of sim.events.current()) {
      if (ev.kind === 'atomicCompleted') trace.push(`${sim.tick}:${ev.entity}:${ev.atomicId}`);
      else if (ev.kind === 'goodProduced') produced += ev.amount;
    }
    // A per-tick snapshot populates the clone cache, arming the cachesCoherent invariant's stale-clone
    // verifier against any system write that bypassed the tracked seam. A pure read: hashes unaffected.
    sim.snapshot();
    if (invariantViolations.length === 0) {
      const v = checkInvariants(sim.world, sim.content, CORE_INVARIANTS);
      if (v.length > 0) invariantViolations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
  }
  return { hash: sim.hashState(), trace, produced, invariantViolations };
}

/** Post the slice's crew through the command seam, like every other change it makes: the carpenter to the
 *  sawmill it stands on, the carrier to the headquarters' transport slot. Each entity is resolved by its
 *  type/trade rather than by a hard-coded id, and a second match is a fixture bug - the resolution must not
 *  depend on store order for the pinned hash to mean anything. */
function staffSlice(sim: Simulation): void {
  sim.enqueueSetup({
    kind: 'assignWorker',
    entity: theSettlerOfJob(sim, CARPENTER),
    building: theBuildingOfType(sim, SAWMILL),
    jobPriority: [CARPENTER],
  });
  sim.enqueueSetup({
    kind: 'assignWorker',
    entity: theSettlerOfJob(sim, CARRIER),
    building: theBuildingOfType(sim, HEADQUARTERS),
    jobPriority: [CARRIER],
  });
}

function theBuildingOfType(sim: Simulation, buildingType: number): Entity {
  return theOne(
    [...sim.world.query(Building)].filter((e) => sim.world.get(e, Building).buildingType === buildingType),
    `building of type ${buildingType}`,
  );
}

function theSettlerOfJob(sim: Simulation, jobType: number): Entity {
  return theOne(
    [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === jobType),
    `settler of job ${jobType}`,
  );
}

function theOne(matches: readonly Entity[], what: string): Entity {
  const only = matches[0];
  if (matches.length !== 1 || only === undefined) {
    throw new Error(`golden slice: expected exactly one ${what}, found ${matches.length}`);
  }
  return only;
}

describe('golden: the vertical slice over ~1000 ticks', () => {
  const TICKS = 1000;
  const SEED = 7;

  // The golden atomic-action trace. Atomic ids: 24 = harvest/CHOP (a swing at a tree), 23 = pileup
  // (deposit into a store), 22 = pickup (lift out of a store / off a trunk). Entity 5 = woodcutter, 6 =
  // its WORK FLAG (auto-planted at its feet when it spawns - a gatherer is never free; it carries no
  // atomics), 7 = carrier, 8 = carpenter (the mill's operator, self-servicing: it pickups the HQ's stored
  // wood into the mill and hauls finished planks back out). Cadence notes: a rested barefoot settler
  // walks a land cell in 16 ticks (a laden one in 18), the inter-swing breather lands after every 2nd
  // swing of a worker's burst, and a trained swing advances a tree by more than one chop (the
  // woodcutter's second tree). Separation can push a walker off a waypoint; the continuation uses
  // its captured full-step pace, which also shifts later work cycles within this fixed window.
  const GOLDEN_TRACE: readonly string[] = [
    '24:8:22',
    '38:5:24',
    '41:5:24',
    '50:8:23',
    '59:5:24',
    '63:5:22',
    '82:7:22',
    '94:8:22',
    '107:5:23',
    '120:8:23',
    '141:7:23',
    '147:5:22',
    '164:8:22',
    '190:8:23',
    '191:5:23',
    '197:7:22',
    '234:8:22',
    '247:5:24',
    '250:5:24',
    '259:7:23',
    '260:8:23',
    '268:5:24',
    '272:5:22',
    '304:8:22',
    '330:8:23',
    '334:5:23',
    '347:7:22',
    '374:8:22',
    '390:5:22',
    '400:8:23',
    '441:8:22',
    '447:7:23',
    '452:5:23',
    '467:8:23',
    '511:8:22',
    '535:7:22',
    '537:8:23',
    '581:8:22',
    '607:8:23',
    '633:7:23',
    '651:8:22',
    '677:8:23',
    '721:7:22',
    '721:8:22',
    '747:8:23',
    '791:8:22',
    '818:8:23',
    '819:7:23',
    '862:8:22',
    '888:8:23',
    '907:7:22',
    '932:8:22',
    '958:8:23',
    '962:8:22',
    '988:8:23',
  ];

  it('holds every core invariant on every tick', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    const run = runSlice(SEED, TICKS);
    // The hash covers every component on every entity, so it moves on any intentional mechanic change;
    // each move is named in its own completing commit (`git log -S` this literal for the history).
    expect(run.hash).toBe('5c05ee68');
  });

  it('matches the golden atomic-action trace', () => {
    const run = runSlice(SEED, TICKS);
    expect(run.trace).toEqual(GOLDEN_TRACE);
    // Whole planks out of the mill inside this fixed 1000-tick observation window: the batches its
    // journeys complete plus the whole bonus units the carpenter's growing experience banks over them
    // (see the production-bonus cases).
    expect(run.produced).toBe(20); // turn pauses leave one fewer production cycle in this fixed window
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const a = runSlice(SEED, TICKS);
    const b = runSlice(SEED, TICKS);
    expect(a.hash).toBe(b.hash);
    expect(a.trace).toEqual(b.trace);
    expect(a.produced).toBe(b.produced);
  });
});
