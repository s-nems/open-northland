import { describe, expect, it } from 'vitest';
import {
  AiPlayer,
  aiModuleEnables,
  Building,
  DeliveryFlag,
  JobAssignment,
  Owner,
  Position,
  Settler,
  setProfessionProgression,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { grantWorkExperience, jobSystem } from '../../src/systems/index.js';
import { setJob } from '../../src/systems/orders/index.js';
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
const GENERAL_TRACK = 2; // the woodcutter-general track (factor 1), fed alongside the wood track
const WOOD_GOOD = 1; // the woodcutter's specific track trains on it; a pinned gatherer collects it
const HQ = 1; // building type: 3 woodcutter slots + a transport slot
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

  it('offers a multi-slot workplace its LOWEST job id first, however its slots are declared', () => {
    // Reversed before the Simulation, because the content index is memoized per ContentSet.
    const content = testContent();
    const hq = content.buildings.find((b) => b.typeId === HQ);
    if (hq === undefined) throw new Error('fixture has no HQ');
    hq.workers = [...hq.workers].reverse();
    const sim = new Simulation({ seed: 1, content });
    placeBuilding(sim, HQ, 5, 5);
    const idle = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(idle, Settler).jobType).toBe(WOODCUTTER); // not CARRIER, the first-declared slot
  });

  it('never report-in binds a non-carrier trade (only adopt-on-station binds the pre-employed)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, 1 /* HQ */, 5, 5); // open woodcutter slots exist…
    const roamer = settler(sim, WOODCUTTER); // …but a roaming woodcutter works unbound, off targets

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(roamer, JobAssignment)).toBe(false);
  });

  // SKIPPED: the building tech-unlock gate (`buildingEnabled`/`jobEnablesHouse`) is disabled feature-wide
  // — see docs/tickets/sim/rework-building-unlock-gate.md. Un-skip when the gate is re-enabled.
  it.skip('does not assign a job at a tech-gated workplace until its enabling job is present', () => {
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
    // Taking the carpenter job requires 30 REPEATS of the wood track (typeId 1, factor 10 — 300 raw XP).
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
    const low = settler(sim, null, new Map([[WOOD_TRACK, 299]])); // one raw XP short of 30 repeats
    const high = settler(sim, null, new Map([[WOOD_TRACK, 300]])); // exactly clears

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(low, Settler).jobType).toBeNull(); // below threshold: not assigned
    // The high-XP settler clears it; only one carpenter slot, and `low` left it open, so `high` takes it.
    expect(sim.world.get(high, Settler).jobType).toBe(CARPENTER);
  });

  it('clears a GENERAL-keyed gate through specific-good work (the miller←farmer-general chain)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Real content keys some job gates on a GENERAL track (`needforjob miller 10 farmer-general`)
    // while the prerequisite job only ever works specific goods — the gate must count the trade's
    // total repeats (`requirementRepeats`), since work accrues only the matched specific track.
    const tribe = sim.content.tribes[0];
    if (tribe === undefined) throw new Error('fixture has no tribe');
    tribe.jobRequirements.push({
      requirement: 'need',
      target: 'job',
      targetId: CARPENTER,
      amount: 5,
      experienceTypes: [GENERAL_TRACK],
    });
    placeBuilding(sim, SAWMILL, 5, 5);
    // A woodcutter fells five wood units (all its work is wood-SPECIFIC), then goes idle.
    const veteran = settler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), veteran, WOOD_GOOD, 5);
    sim.world.get(veteran, Settler).jobType = null; // lifetime XP survives leaving the job
    const fresh = settler(sim, null);

    jobSystem(sim.world, ctxOf(sim));

    // The five wood-specific repeats count toward the GENERAL-keyed gate (the whole-trade sum).
    expect(sim.world.get(veteran, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.get(fresh, Settler).jobType).toBeNull(); // one slot, and fresh never qualified
  });

  it('staffs an XP- and tech-gated civilian job from zero XP while profession progression is off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const tribe = sim.content.tribes[0];
    if (tribe === undefined) throw new Error('fixture has no tribe');
    // Both gate kinds at once: a needforjob threshold AND a jobEnablesJob edge on a dead woodcutter.
    tribe.jobRequirements.push({
      requirement: 'need',
      target: 'job',
      targetId: CARPENTER,
      amount: 30,
      experienceTypes: [WOOD_TRACK],
    });
    tribe.jobEnables.push({ jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER });
    placeBuilding(sim, SAWMILL, 5, 5);
    const idle = settler(sim, null);
    setProfessionProgression(sim.world, false);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(idle, Settler).jobType).toBe(CARPENTER); // free start: both gates bypassed
  });

  it('staffs an AI seat’s gated job from zero XP even with progression ON (bots skip the tree)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
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
    const AI_SEAT = 3;
    sim.world.add(sim.world.create(), AiPlayer, { player: AI_SEAT, modules: aiModuleEnables() });
    const bot = settler(sim, null);
    sim.world.add(bot, Owner, { player: AI_SEAT });
    const human = settler(sim, null);
    sim.world.add(human, Owner, { player: 0 });

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bot, Settler).jobType).toBe(CARPENTER); // the AI seat is never gated
    expect(sim.world.get(human, Settler).jobType).toBeNull(); // the human still earns the trade
  });
});

describe('the civilist trade — the Cywil order pins a settler jobless', () => {
  const CIVILIST = 6; // the fixture's no-trade adult (the original's `jobtypes.ini` 6)

  it('setJob to civilist takes, and the assign pass never re-employs a job-6 settler', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // an open slot that WOULD employ any idle (jobType null) settler
    const e = settler(sim, WOODCUTTER);
    sim.world.add(e, Owner, { player: 0 });

    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: e, jobType: CIVILIST });
    expect(sim.world.get(e, Settler).jobType).toBe(CIVILIST);

    jobSystem(sim.world, ctxOf(sim));
    // Non-null jobType is never re-assigned, and no workplace declares a civilist slot — it idles.
    expect(sim.world.get(e, Settler).jobType).toBe(CIVILIST);

    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: e, jobType: WOODCUTTER });
    expect(sim.world.get(e, Settler).jobType).toBe(WOODCUTTER); // re-traded normally
  });
});

/**
 * The adopt pass (pass 1) binds a pre-employed settler to the workplace under its feet. Its two
 * limits: the slot count still applies, and a settler that already works a flag is passing by, not
 * reporting for duty. Without them a workshop beside a walking route collects staff without bound
 * (the reported "30/2 collectors in the pottery") and the flag gatherer it swallows stops gathering.
 */
describe('JobSystem — adopting the pre-employed settler standing on a workplace', () => {
  /** Put `e` at the sawmill's tile — the adopt pass reads the tile under the settler's feet. */
  function standOnSawmill(sim: Simulation, e: Entity): void {
    sim.world.get(e, Position).x = fx.fromInt(5);
    sim.world.get(e, Position).y = fx.fromInt(5);
  }

  /** Bind `e` to a work flag of its own, optionally pinned to one good (`setGatherGood`). */
  function flagFor(sim: Simulation, e: Entity, goodType?: number): void {
    const flag = sim.world.create();
    sim.world.add(flag, Position, { x: fx.fromInt(9), y: fx.fromInt(9) });
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(e, WorkFlag, { flag, radius: 8, ...(goodType !== undefined ? { goodType } : {}) });
  }

  it('adopts only as many as the slot holds', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // exactly one carpenter slot
    const first = settler(sim, CARPENTER);
    const second = settler(sim, CARPENTER);
    standOnSawmill(sim, first);
    standOnSawmill(sim, second);

    jobSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(first, JobAssignment)).toBe(true);
    expect(sim.world.has(second, JobAssignment)).toBe(false); // the slot is taken — it stays loose
  });

  it('leaves a flag worker alone, pinned to a good or not', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5);
    const pinned = settler(sim, CARPENTER);
    const unpinned = settler(sim, CARPENTER);
    const flagless = settler(sim, CARPENTER);
    for (const e of [pinned, unpinned, flagless]) standOnSawmill(sim, e);
    flagFor(sim, pinned, WOOD_GOOD); // a standing gather order (`setGatherGood`)
    flagFor(sim, unpinned); // the flag auto-planted under any fresh gatherer

    jobSystem(sim.world, ctxOf(sim));

    // Both flag holders are out working their ground; the slot goes to the one with no post at all.
    expect(sim.world.has(pinned, JobAssignment)).toBe(false);
    expect(sim.world.has(unpinned, JobAssignment)).toBe(false);
    expect(sim.world.has(flagless, JobAssignment)).toBe(true);
  });
});
