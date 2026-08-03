import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Owner,
  Position,
  Settler,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { assignWorker } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The `assignWorker` command - the one way a settler becomes employed: bind an OWNED settler to a
 * SPECIFIC building as a worker (set its `jobType` to the building's open slot + stamp its
 * {@link JobAssignment} binding). It applies the same-tribe / same-owner / per-building capacity
 * gates, and enforces the per-settler XP threshold (`needforjob`) on a trade the settler does not yet hold -
 * a trade is earned by the settler, so a hand assignment cannot mint an unqualified craftsman; it falls
 * through to the next listed job (the hauler slot). The tribe-tech gate (`jobEnablesJob`) is not applied at
 * all, so a workshop is never refused for want of an enabling trade (the "mennica → tragarz" bug). See
 * openings.ts.
 *
 * The shared fixture's sawmill (type 2) declares one carpenter slot; the HQ (type 1) declares three
 * woodcutter slots.
 */

const VIKING = 1;
const HUMAN = 0;
const CARPENTER = 2; // the sawmill's worker job
const SAWMILL = 2; // building type

function placeBuilding(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  return e;
}

/** An OWNED, idle viking settler (assignWorker only touches a player's own units). */
function settler(
  sim: Simulation,
  owner: number | null = HUMAN,
  experience: ReadonlyArray<readonly [number, number]> = [],
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(experience),
  });
  if (owner !== null) sim.world.add(e, Owner, { player: owner });
  return e;
}

// The sawmill offers only CARPENTER; the priority list carries it (plus the HQ's woodcutter, which the
// sawmill doesn't offer - proving the building-doesn't-offer entry is skipped, not bound).
const WOODCUTTER = 1;
const CARRIER = 36; // the twin mill's transport slot - the hauler fallback in the priority list
const TWIN_MILL = 8; // building type: two carpenter slots + one carrier slot
const WOOD_TRACK = 1; // the woodcutter-wood experience track (factor 10)
const WOOD_FACTOR = 10;
const CARPENTER_GATE_REPEATS = 10;

/** Gate the carpenter trade behind {@link CARPENTER_GATE_REPEATS} repeats of the wood track - the shape
 *  real content uses (`needforjob 9 10 3`, the joiner behind collector-wood). */
function gateCarpenter(sim: Simulation): void {
  const tribe = sim.content.tribes[0];
  if (tribe === undefined) throw new Error('fixture has no tribe');
  tribe.jobRequirements.push({
    requirement: 'need',
    target: 'job',
    targetId: CARPENTER,
    amount: CARPENTER_GATE_REPEATS,
    experienceTypes: [WOOD_TRACK],
  });
}

type AssignWorkerCommand = Extract<Command, { readonly kind: 'assignWorker' }>;

const assign = (entity: Entity, building: Entity): AssignWorkerCommand => ({
  kind: 'assignWorker',
  entity,
  building,
  jobPriority: [WOODCUTTER, CARPENTER],
});

describe('assignWorker - bind an owned settler to a chosen building', () => {
  it('sets the building’s worker job and binds the settler to THAT building', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5);
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, mill));

    expect(sim.world.get(worker, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(mill);
  });

  it('binds to the CHOSEN building, not the first open one the economy would pick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // an earlier, also-open sawmill
    const chosen = placeBuilding(sim, SAWMILL, 9, 9); // the one the player clicks
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, chosen));

    expect(sim.world.get(worker, JobAssignment).workplace).toBe(chosen);
  });

  it('is a no-op at a FULL building (its one slot already staffed) - capacity is respected', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5); // count 1
    const first = settler(sim);
    const second = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(first, mill)); // fills the one slot
    assignWorker(sim.world, ctxOf(sim), assign(second, mill)); // building now full

    expect(sim.world.get(first, JobAssignment).workplace).toBe(mill);
    expect(sim.world.get(second, Settler).jobType).toBeNull(); // rejected: no open slot
    expect(sim.world.has(second, JobAssignment)).toBe(false);
  });

  it('re-binds an already-employed settler to a different building', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const millA = placeBuilding(sim, SAWMILL, 5, 5);
    const millB = placeBuilding(sim, SAWMILL, 9, 9);
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, millA));
    assignWorker(sim.world, ctxOf(sim), assign(worker, millB));

    expect(sim.world.get(worker, JobAssignment).workplace).toBe(millB); // moved off A onto B
  });

  it('skips a NEUTRAL (unowned) settler - only a player’s own unit is assignable', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5);
    const neutral = settler(sim, null); // no Owner

    assignWorker(sim.world, ctxOf(sim), assign(neutral, mill));

    expect(sim.world.get(neutral, Settler).jobType).toBeNull();
    expect(sim.world.has(neutral, JobAssignment)).toBe(false);
  });

  it('binds the FIRST job in the priority list that the building actually offers', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = placeBuilding(sim, 1, 5, 5); // the HQ offers WOODCUTTER (job 1), not CARPENTER (job 2)
    const worker = settler(sim);

    // Priority prefers CARPENTER, but the HQ doesn't offer it - so the walk skips to WOODCUTTER.
    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: worker,
      building: hq,
      jobPriority: [CARPENTER, WOODCUTTER],
    });

    expect(sim.world.get(worker, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(hq);
  });

  it('is a no-op when the priority list offers no job the building employs (or is empty)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5); // offers CARPENTER only
    const a = settler(sim);
    const b = settler(sim);

    // A list that names only jobs the sawmill doesn't offer → no bind.
    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: a,
      building: mill,
      jobPriority: [WOODCUTTER],
    });
    // An empty preference list → no bind.
    assignWorker(sim.world, ctxOf(sim), { kind: 'assignWorker', entity: b, building: mill, jobPriority: [] });

    for (const s of [a, b]) {
      expect(sim.world.get(s, Settler).jobType).toBeNull();
      expect(sim.world.has(s, JobAssignment)).toBe(false);
    }
  });

  it('falls an unqualified settler through to the hauler slot (needforjob is enforced)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    gateCarpenter(sim);
    const mill = placeBuilding(sim, TWIN_MILL, 5, 5); // two carpenter slots + one carrier slot
    const fresh = settler(sim);

    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: fresh,
      building: mill,
      jobPriority: [CARPENTER, CARRIER],
    });

    // The craft slot is open but unearned, so the next listed job wins - a tradesman first, else a hauler.
    expect(sim.world.get(fresh, Settler).jobType).toBe(CARRIER);
    expect(sim.world.get(fresh, JobAssignment).workplace).toBe(mill);
  });

  it('posts a settler to the trade it ALREADY holds, gate unmet - posting is not taking one up', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    gateCarpenter(sim);
    const mill = placeBuilding(sim, TWIN_MILL, 5, 5); // two carpenter slots + one carrier slot
    const carpenter = settler(sim); // no repeats: the gate would refuse him the trade today
    setSettlerJob(sim.world, carpenter, CARPENTER); // …but he already holds it

    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: carpenter,
      building: mill,
      jobPriority: [CARPENTER, CARRIER],
    });

    // Re-gating a trade the settler practises would demote him to hauler on every posting. It is the rule a
    // tower garrison lives on: a bow soldier's class is earned at the barracks (or by picking the bow up),
    // never at the tower he is sent to man.
    expect(sim.world.get(carpenter, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.get(carpenter, JobAssignment).workplace).toBe(mill);
  });

  it('binds the craft slot once the settler has earned its repeats', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    gateCarpenter(sim);
    const mill = placeBuilding(sim, TWIN_MILL, 5, 5);
    const veteran = settler(sim, HUMAN, [[WOOD_TRACK, CARPENTER_GATE_REPEATS * WOOD_FACTOR]]);

    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: veteran,
      building: mill,
      jobPriority: [CARPENTER, CARRIER],
    });

    expect(sim.world.get(veteran, Settler).jobType).toBe(CARPENTER);
  });

  it('still relaxes the TRIBE-tech gate - a built workshop is never refused for a missing enabler', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const tribe = sim.content.tribes[0];
    if (tribe === undefined) throw new Error('fixture has no tribe');
    // `jobEnablesJob`: the carpenter trade would need a living woodcutter, and none exists. The
    // automatic scan honours that; a hand assignment overrides it (the "mennica → tragarz" fix).
    tribe.jobEnables.push({ jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER });
    const mill = placeBuilding(sim, SAWMILL, 5, 5);
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, mill));

    expect(sim.world.get(worker, Settler).jobType).toBe(CARPENTER);
  });

  it('skips a non-building target (a stale/hostile command)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const worker = settler(sim);
    const other = settler(sim); // a settler id, not a building

    assignWorker(sim.world, ctxOf(sim), assign(worker, other));

    expect(sim.world.get(worker, Settler).jobType).toBeNull();
    expect(sim.world.has(worker, JobAssignment)).toBe(false);
  });
});
