import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  addWildlife,
  Chat,
  type CurrentAtomicState,
  Engagement,
  FamilyDuty,
  FarmTask,
  Fleeing,
  Garrison,
  IdleStand,
  JobAssignment,
  MoveGoal,
  Owner,
  PathRequest,
  PickupClaim,
  Position,
  Resting,
  Rider,
  Settler,
  Stranded,
  SupplyRun,
  setSettlerJob,
  TALK_ATOMIC_ID,
  UnreachableGoals,
  UnreachableTargets,
  Wedding,
  YardDeliveryRoute,
} from '../../src/components/index.js';
import { ZERO } from '../../src/core/fixed.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import type { ShelterSites } from '../../src/systems/defence/index.js';
import { collectFarmClaims } from '../../src/systems/settlers/drives/farming/index.js';
import {
  IDLE_REPLAN_PERIOD_TICKS,
  idleBeatOf,
  wakeIdle,
} from '../../src/systems/settlers/planner/idle-replan.js';
import { idleRelease, releaseStaleIntent } from '../../src/systems/settlers/planner/replan.js';
import { sweepOrder } from '../../src/systems/settlers/planner/sweep.js';
import { collectSupplyTally } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The planner sweep passes by a settler whose visit would change nothing: an atomic or a live route
 * holds it and it carries nothing the release reconciles, or it stands idle off its re-plan beat.
 * Everyone else is visited in ascending id, including a settler an earlier visit in the same pass woke.
 */

const BEAR = 0;
const GOAL = 7 as NodeId;
const NO_SHELTERS: ShelterSites = new Map();
const WALK_ATOMIC = 1;
const CRAFT_ATOMIC = 2;
const ATOMIC_TICKS = 10;
const ALARMED = 0;
const CALM = 1;
const WOODCUTTER = 1;
const SOLDIER = 31; // `soldier_unarmed`: a fighter trade, which never takes cover
const CONTENT = testContent();
const PLANK = 2;
/** An alarm whose one shelter of `ALARMED` has `free` places left. */
function alarmWithRoom(free: number): ShelterSites {
  return new Map([[ALARMED, [{ entity: 0 as Entity, hx: 0, hy: 0, free }]]]);
}

/** The sweep's idle beat that lets every idler through. */
const EVERY_IDLER = undefined;

function atomic(effect: CurrentAtomicState['effect'], atomicId: number): CurrentAtomicState {
  return { atomicId, duration: ATOMIC_TICKS, effect, targetEntity: null, targetTile: null };
}

/** A positioned creature with no trade. */
function jobless(world: World): Entity {
  const e = world.create();
  addWildlife(world, e, BEAR);
  world.add(e, Position, { x: ZERO, y: ZERO });
  return e;
}

/** A positioned settler with a trade, so its visit may run the ladder. */
function settler(world: World): Entity {
  const e = jobless(world);
  setSettlerJob(world, e, WOODCUTTER);
  return e;
}

function walking(world: World): Entity {
  const e = settler(world);
  world.add(e, MoveGoal, { cell: GOAL });
  return e;
}

function idler(world: World): Entity {
  const e = settler(world);
  world.add(e, IdleStand, { standing: true });
  world.add(e, Owner, { player: CALM });
  return e;
}

/** Give `e` a trade and an owner, as an alarm reads them. */
function employ(world: World, e: Entity, jobType: number, player: number): Entity {
  world.add(e, Settler, { ...world.get(e, Settler), jobType });
  world.add(e, Owner, { player });
  return e;
}

function busy(world: World): Entity {
  const e = settler(world);
  addCurrentAtomic(world, e, atomic({ kind: 'move', to: { x: 0, y: 0 } }, WALK_ATOMIC));
  return e;
}

/** Every settler a fresh sweep visits, in order. */
function swept(...args: Parameters<typeof sweepOrder>): Entity[] {
  const sweep = sweepOrder(...args);
  const visited: Entity[] = [];
  for (let e = sweep.next(); e !== undefined; e = sweep.next()) visited.push(e);
  return visited;
}

describe('planner sweep order', () => {
  it('skips held and walking settlers unless they carry something to reconcile', () => {
    const world = new World();
    const standing = settler(world);
    walking(world);
    busy(world);
    const idleWalker = walking(world);
    world.add(idleWalker, IdleStand, { standing: true });
    const failedRoute = walking(world);
    world.add(failedRoute, PathRequest, { start: GOAL, goal: GOAL, failed: true });

    expect(swept(world, CONTENT, NO_SHELTERS, EVERY_IDLER)).toEqual([standing, idleWalker, failedRoute]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('reaches a settler an earlier visit woke, but not one created during the pass', () => {
    const world = new World();
    const first = settler(world);
    const walker = walking(world);
    const visited: Entity[] = [];
    const sweep = sweepOrder(world, CONTENT, NO_SHELTERS, EVERY_IDLER);
    for (let e = sweep.next(); e !== undefined; e = sweep.next()) {
      visited.push(e);
      if (e === first) {
        world.remove(walker, MoveGoal);
        settler(world);
      }
    }
    expect(visited).toEqual([first, walker]);
  });

  it('visits a quiet walker once its route fails in place, combat takes it on, or another system takes its supply errand', () => {
    const world = new World();
    const [failing, engaged, supplying] = [walking(world), walking(world), walking(world)];
    world.add(failing, PathRequest, { start: GOAL, goal: GOAL, failed: false });
    world.add(supplying, SupplyRun, { site: failing, goodType: PLANK, amount: 1 });
    expect(swept(world, CONTENT, NO_SHELTERS, EVERY_IDLER)).toEqual([]);

    world.mut(failing, PathRequest).failed = true;
    world.add(engaged, Engagement, { repathAt: 0 });
    world.add(supplying, Fleeing, { repathAt: 0, calmUntil: null });
    expect(swept(world, CONTENT, NO_SHELTERS, EVERY_IDLER)).toEqual([failing, engaged, supplying]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('passes by a jobless settler with nothing to shed until it takes a trade or holds something', () => {
    const world = new World();
    const [hired, inside, standing] = [jobless(world), jobless(world), jobless(world)];
    expect(swept(world, CONTENT, NO_SHELTERS, EVERY_IDLER)).toEqual([]);

    setSettlerJob(world, hired, WOODCUTTER);
    world.add(inside, Resting, { at: standing });
    expect(swept(world, CONTENT, NO_SHELTERS, EVERY_IDLER)).toEqual([hired, inside]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('adds the quiet civilian walkers of an owner with a shelter place left on alarm, which cover may divert', () => {
    const world = new World();
    const standing = settler(world);
    const alarmedWalker = employ(world, walking(world), WOODCUTTER, ALARMED);
    employ(world, walking(world), WOODCUTTER, CALM);
    employ(world, walking(world), SOLDIER, ALARMED);
    employ(world, busy(world), WOODCUTTER, ALARMED);
    expect(swept(world, CONTENT, alarmWithRoom(1), EVERY_IDLER)).toEqual([standing, alarmedWalker]);
    // With no place left, a walker's visit could only fail to claim one.
    expect(swept(world, CONTENT, alarmWithRoom(0), EVERY_IDLER)).toEqual([standing]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('files a re-owned walker under its new owner', () => {
    const world = new World();
    const walker = employ(world, walking(world), WOODCUTTER, CALM);
    const alarm = alarmWithRoom(1);
    expect(swept(world, CONTENT, alarm, EVERY_IDLER)).toEqual([]);
    world.add(walker, Owner, { player: ALARMED });
    expect(swept(world, CONTENT, alarm, EVERY_IDLER)).toEqual([walker]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('visits an idler with nothing to shed on its beat, and a civilian one every beat once alarmed or woken', () => {
    const world = new World();
    const idlers = Array.from({ length: IDLE_REPLAN_PERIOD_TICKS + 1 }, () => idler(world));
    const [first, second, third] = idlers;
    const last = idlers.at(-1);
    if (first === undefined || second === undefined || third === undefined || last === undefined) {
      throw new Error('too few idlers');
    }
    const beat = idleBeatOf(first);
    const sweep = (shelters: ShelterSites): Entity[] => swept(world, CONTENT, shelters, beat);
    expect(sweep(NO_SHELTERS)).toEqual([first, last]);
    expect(swept(world, CONTENT, NO_SHELTERS, EVERY_IDLER)).toEqual(idlers);

    employ(world, second, WOODCUTTER, ALARMED);
    employ(world, third, SOLDIER, ALARMED);
    expect(sweep(new Map([[ALARMED, []]]))).toEqual([first, second, last]);
    wakeIdle(world, second);
    world.add(third, MoveGoal, { cell: GOAL }); // its visit wakes a walking idler
    expect(sweep(NO_SHELTERS)).toEqual([first, second, third, last]);
    expect(world.verifyCaches()).toEqual([]);
  });
});

describe('the beat an idler waits inside a building on', () => {
  it('is the building’s own, and turns back to the settler’s once it steps out', () => {
    const world = new World();
    const workplace = world.create();
    const crafter = idler(world);
    world.add(crafter, JobAssignment, { workplace });
    world.add(crafter, Resting, { at: workplace });
    const onBeat = (e: Entity): Entity[] => swept(world, CONTENT, NO_SHELTERS, idleBeatOf(e));
    expect(onBeat(workplace)).toEqual([crafter]);
    expect(onBeat(crafter)).toEqual([]);

    world.remove(crafter, Resting);
    expect(onBeat(workplace)).toEqual([]);
    expect(onBeat(crafter)).toEqual([crafter]);
    expect(world.verifyCaches()).toEqual([]);
  });
});

/** Every state a settler may meet the sweep in, crossed with every marker the release reads. */
const STATES: Record<string, (world: World, e: Entity) => void> = {
  standing: () => {},
  held: (world, e) => addCurrentAtomic(world, e, atomic({ kind: 'move', to: { x: 0, y: 0 } }, WALK_ATOMIC)),
  crafting: (world, e) =>
    addCurrentAtomic(world, e, atomic({ kind: 'produce', recipeOutput: PLANK }, CRAFT_ATOMIC)),
  walking: (world, e) => world.add(e, MoveGoal, { cell: GOAL }),
  routing: (world, e) => world.add(e, PathRequest, { start: GOAL, goal: GOAL, failed: false }),
  stranded: (world, e) => {
    world.add(e, PathRequest, { start: GOAL, goal: GOAL, failed: true });
    world.add(e, Stranded, { retryAt: 0 });
  },
  talking: (world, e) => addCurrentAtomic(world, e, atomic({ kind: 'idle' }, TALK_ATOMIC_ID)),
};
const MARKERS: Record<string, (world: World, e: Entity) => void> = {
  none: () => {},
  yardRoute: (world, e) =>
    world.add(e, YardDeliveryRoute, { flag: e, goodType: PLANK, goal: GOAL, failed: false }),
  unreachableGoals: (world, e) => world.add(e, UnreachableGoals, { entries: [] }),
  unreachableTargets: (world, e) => world.add(e, UnreachableTargets, { entries: [] }),
  garrison: (world, e) => world.add(e, Garrison, { post: e, returnTo: { x: ZERO, y: ZERO } }),
  idleStand: (world, e) => world.add(e, IdleStand, { standing: true }),
  supplyRun: (world, e) => world.add(e, SupplyRun, { site: e, goodType: PLANK, amount: 1 }),
  fleeingSupplyRun: (world, e) => {
    world.add(e, SupplyRun, { site: e, goodType: PLANK, amount: 1 });
    world.add(e, Fleeing, { repathAt: 0, calmUntil: null });
  },
  pickupClaim: (world, e) => world.add(e, PickupClaim, { source: e, goodType: PLANK, amount: 1 }),
  fleeingPickupClaim: (world, e) => {
    world.add(e, PickupClaim, { source: e, goodType: PLANK, amount: 1 });
    world.add(e, Fleeing, { repathAt: 0, calmUntil: null });
  },
  riderSupplyRun: (world, e) => {
    world.add(e, SupplyRun, { site: e, goodType: PLANK, amount: 1 });
    world.add(e, Rider, { vehicle: e, boarding: false, leaving: null });
  },
  familyDutyPickupClaim: (world, e) => {
    world.add(e, PickupClaim, { source: e, goodType: PLANK, amount: 1 });
    world.add(e, FamilyDuty, { duty: true });
  },
  engagement: (world, e) => world.add(e, Engagement, { repathAt: 0 }),
  pastimeChat: (world, e) =>
    world.add(e, Chat, { partner: e, seeker: true, talking: false, speaks: true, kind: 'pastime' }),
  companyChat: (world, e) =>
    world.add(e, Chat, { partner: e, seeker: true, talking: false, speaks: true, kind: 'company' }),
  wedding: (world, e) => world.add(e, Wedding, { partner: e, kissing: false }),
  fleeing: (world, e) => world.add(e, Fleeing, { repathAt: 0, calmUntil: null }),
  farmTask: (world, e) => world.add(e, FarmTask, { farm: e, node: GOAL, sow: false }),
  resting: (world, e) => world.add(e, Resting, { at: e }),
};
describe('idle release contract', () => {
  it('passes by only settlers whose release and wake change nothing, or whose trade runs no ladder', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(16, 8) });
    const { world } = sim;
    const ctx = ctxOf(sim);
    const kinds = new Set<string | null>();
    for (const shelters of [NO_SHELTERS, new Map([[ALARMED, []]]) as ShelterSites]) {
      for (const [state, enter] of Object.entries(STATES)) {
        for (const [marker, mark] of Object.entries(MARKERS)) {
          for (const [idle, jobType] of [false, true].flatMap((i) =>
            [WOODCUTTER, null].map((j) => [i, j] as const),
          )) {
            const e = settlerAt(sim, { jobType, position: positionOfNode(4, 4) });
            world.add(e, Owner, { player: CALM });
            enter(world, e);
            mark(world, e);
            if (idle) world.add(e, IdleStand, { standing: true });
            const release = idleRelease(world, e);
            kinds.add(release);
            if (release === null) continue;
            const before = world.mutationVersion;
            const planned = releaseStaleIntent(
              world,
              ctx,
              e,
              collectFarmClaims(world),
              collectSupplyTally(world),
              shelters,
            );
            if (!planned) wakeIdle(world, e);
            expect({
              state,
              marker,
              idle,
              jobType,
              planned,
              wrote: world.mutationVersion !== before,
            }).toEqual({
              state,
              marker,
              idle,
              jobType,
              planned: release === 'idle' || release === 'jobless',
              wrote: false,
            });
          }
        }
      }
    }
    expect(kinds).toEqual(new Set([null, 'held', 'travelling', 'jobless', 'idle']));
  });
});
