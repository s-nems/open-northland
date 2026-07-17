import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { jobSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * JobSystem (assignment half — the smallest slice): an IDLE settler (`jobType === null`) takes the
 * job of an understaffed, tech-enabled, same-tribe workplace it qualifies for, gated by `needforjob`.
 *
 * The shared fixture's sawmill (building type 2) declares one carpenter slot (`workers jobType 2,
 * count 1`) and carries no `house` jobEnables edge → it is tech-enabled by default, so an idle settler
 * gets the carpenter job. The HQ (type 1) declares three woodcutter slots (job 1, count 3). To
 * exercise the XP gate we inject a `needforjob` requirement into the in-memory IR (the same trick
 * harvest-need-gate.test.ts uses for `needforgood`).
 */

const VIKING = 1;
const CARPENTER = 2; // the sawmill's worker job
const WOODCUTTER = 1; // the HQ's worker job
const CARRIER = 36; // the HQ's transport-slot job
const WOOD_TRACK = 1; // the wood-specific humanjobexperiencetype typeId in the fixture
const SAWMILL = 2; // building type
const SMITHY = 4; // building type gated by `jobEnablesHouse 2 4` (needs a carpenter present)

/** Place a building of `buildingType` for the viking tribe at (x, y). */
function placeBuilding(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  return e;
}

/** Spawn an idle (or pre-jobbed) settler of the viking tribe, optionally pre-seeded with XP. */
function settler(sim: Simulation, jobType: number | null, xp?: Map<number, number>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: xp ?? new Map<number, number>(),
  });
  return e;
}

describe('JobSystem — idle settlers take open workplace jobs', () => {
  it('assigns an idle settler the worker job of an open, tech-enabled workplace', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // one carpenter slot, ungated
    const idle = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(idle, Settler).jobType).toBe(CARPENTER);
  });

  it('leaves an already-employed settler alone (only the idle are assigned)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5);
    const employed = settler(sim, WOODCUTTER);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(employed, Settler).jobType).toBe(WOODCUTTER); // untouched
  });

  it('does not over-staff a one-worker slot: only the first idle settler takes the carpenter job', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // count 1
    const first = settler(sim, null);
    const second = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(first, Settler).jobType).toBe(CARPENTER); // lower id wins the one slot
    expect(sim.world.get(second, Settler).jobType).toBeNull(); // slot already filled
  });

  it('fills every slot of a multi-worker workplace (HQ: 3 woodcutter slots + 1 carrier slot)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, 1 /* HQ */, 5, 5); // 3 woodcutter slots + a transport slot
    const a = settler(sim, null);
    const b = settler(sim, null);
    const c = settler(sim, null);
    const d = settler(sim, null);
    const e = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(a, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(b, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(c, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(d, Settler).jobType).toBe(CARRIER); // the woodcutter slots full — the transport slot next
    expect(sim.world.get(e, Settler).jobType).toBeNull(); // every slot filled
  });

  it('posts a LOOSE carrier to the first open transport slot (the report-in pass)', () => {
    // Hauling is worked only through an assignment (the planner's haul rung requires the binding), so
    // a pre-employed carrier standing nowhere near a post reports in to the HQ's transport slot.
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = placeBuilding(sim, 1 /* HQ */, 5, 5);
    const loose = settler(sim, CARRIER);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(loose, Settler).jobType).toBe(CARRIER); // the trade never changes
    expect(sim.world.tryGet(loose, JobAssignment)).toEqual({ workplace: hq });
  });

  it('leaves a loose carrier unposted when no transport slot is open anywhere', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // a carpenter slot — no carrier slot in this world
    const loose = settler(sim, CARRIER);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(loose, JobAssignment)).toBe(false); // stays loose (and therefore idle)
  });

  it('never report-in binds a non-carrier trade (only adopt-on-station binds the pre-employed)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, 1 /* HQ */, 5, 5); // open woodcutter slots exist…
    const roamer = settler(sim, WOODCUTTER); // …but a roaming woodcutter works unbound, off targets

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(roamer, JobAssignment)).toBe(false);
  });

  it('does not assign a job at a tech-gated workplace until its enabling job is present', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Give the smithy (type 4) a worker slot so it COULD offer a job; it is gated by `jobEnablesHouse
    // 2 4` (needs a carpenter present). The injected slot is the only thing offering a woodcutter job.
    sim.content.buildings.find((b) => b.typeId === SMITHY)?.workers.push({ jobType: WOODCUTTER, count: 1 });
    placeBuilding(sim, SMITHY, 5, 5);
    const idle = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(idle, Settler).jobType).toBeNull(); // gated out: no carpenter alive yet
  });

  it('does not assign a job gated by jobEnablesJob until its enabling job is present', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Gate the carpenter job itself behind a woodcutter being present: `jobEnablesJob 1 2` (a
    // woodcutter unlocks the carpenter trade). The sawmill is house-ungated, so only this `job` edge
    // can hold the assignment back.
    const tribe = sim.content.tribes[0];
    if (tribe === undefined) throw new Error('fixture has no tribe');
    tribe.jobEnables.push({ jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER });
    placeBuilding(sim, SAWMILL, 5, 5);
    const idle = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(idle, Settler).jobType).toBeNull(); // gated out: no woodcutter alive yet
  });

  it('assigns a jobEnablesJob-gated job once a settler of its enabling job exists', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const tribe = sim.content.tribes[0];
    if (tribe === undefined) throw new Error('fixture has no tribe');
    tribe.jobEnables.push({ jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER });
    placeBuilding(sim, SAWMILL, 5, 5);
    settler(sim, WOODCUTTER); // an enabling-job settler is now alive in the tribe
    const idle = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(idle, Settler).jobType).toBe(CARPENTER); // unlocked: woodcutter present
  });

  it('gates assignment on the settler clearing the job needforjob XP threshold', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Producing a carpenter requires 30 XP in the wood track (typeId 1) before taking the job.
    const tribe = sim.content.tribes[0];
    if (tribe === undefined) throw new Error('fixture has no tribe');
    tribe.jobRequirements.push({
      requirement: 'need',
      target: 'job',
      targetId: CARPENTER,
      amount: 30,
      experienceTypes: [WOOD_TRACK],
    });
    placeBuilding(sim, SAWMILL, 5, 5);
    const low = settler(sim, null, new Map([[WOOD_TRACK, 29]])); // one short
    const high = settler(sim, null, new Map([[WOOD_TRACK, 30]])); // exactly clears

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(low, Settler).jobType).toBeNull(); // below threshold: not assigned
    // The high-XP settler clears it; only one carpenter slot, and `low` left it open, so `high` takes it.
    expect(sim.world.get(high, Settler).jobType).toBe(CARPENTER);
  });
});
