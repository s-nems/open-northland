import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  addWildlife,
  Chat,
  type CurrentAtomicState,
  Engagement,
  FarmTask,
  Fleeing,
  Garrison,
  IdleStand,
  MoveGoal,
  Owner,
  PathRequest,
  Position,
  Resting,
  Settler,
  Stranded,
  SupplyRun,
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
import { collectInboundSupply } from '../../src/systems/stores/index.js';
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
/** The sweep's idle beat that lets every idler through. */
const EVERY_IDLER = undefined;

function atomic(effect: CurrentAtomicState['effect'], atomicId: number): CurrentAtomicState {
  return { atomicId, duration: ATOMIC_TICKS, effect, targetEntity: null, targetTile: null };
}

function settler(world: World): Entity {
  const e = world.create();
  addWildlife(world, e, BEAR);
  world.add(e, Position, { x: ZERO, y: ZERO });
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

    expect([...sweepOrder(world, CONTENT, NO_SHELTERS, EVERY_IDLER)]).toEqual([
      standing,
      idleWalker,
      failedRoute,
    ]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('reaches a settler an earlier visit woke, but not one created during the pass', () => {
    const world = new World();
    const first = settler(world);
    const walker = walking(world);
    const visited: Entity[] = [];
    for (const e of sweepOrder(world, CONTENT, NO_SHELTERS, EVERY_IDLER)) {
      visited.push(e);
      if (e === first) {
        world.remove(walker, MoveGoal);
        settler(world);
      }
    }
    expect(visited).toEqual([first, walker]);
  });

  it('visits a quiet walker once its route fails in place, or combat or a supply errand takes it on', () => {
    const world = new World();
    const [failing, engaged, supplying] = [walking(world), walking(world), walking(world)];
    world.add(failing, PathRequest, { start: GOAL, goal: GOAL, failed: false });
    expect([...sweepOrder(world, CONTENT, NO_SHELTERS, EVERY_IDLER)]).toEqual([]);

    world.mut(failing, PathRequest).failed = true;
    world.add(engaged, Engagement, { repathAt: 0 });
    world.add(supplying, SupplyRun, { site: failing, goodType: PLANK, amount: 1, source: null });
    expect([...sweepOrder(world, CONTENT, NO_SHELTERS, EVERY_IDLER)]).toEqual([failing, engaged, supplying]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('adds the quiet civilian walkers of an owner with a shelter on alarm, which cover may divert', () => {
    const world = new World();
    const standing = settler(world);
    const alarmedWalker = employ(world, walking(world), WOODCUTTER, ALARMED);
    employ(world, walking(world), WOODCUTTER, CALM);
    employ(world, walking(world), SOLDIER, ALARMED);
    employ(world, busy(world), WOODCUTTER, ALARMED);
    const alarm: ShelterSites = new Map([[ALARMED, []]]);
    expect([...sweepOrder(world, CONTENT, alarm, EVERY_IDLER)]).toEqual([standing, alarmedWalker]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('files a re-owned walker under its new owner', () => {
    const world = new World();
    const walker = employ(world, walking(world), WOODCUTTER, CALM);
    const alarm: ShelterSites = new Map([[ALARMED, []]]);
    expect([...sweepOrder(world, CONTENT, alarm, EVERY_IDLER)]).toEqual([]);
    world.add(walker, Owner, { player: ALARMED });
    expect([...sweepOrder(world, CONTENT, alarm, EVERY_IDLER)]).toEqual([walker]);
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
    const sweep = (shelters: ShelterSites): Entity[] => [...sweepOrder(world, CONTENT, shelters, beat)];
    expect(sweep(NO_SHELTERS)).toEqual([first, last]);
    expect([...sweepOrder(world, CONTENT, NO_SHELTERS, EVERY_IDLER)]).toEqual(idlers);

    employ(world, second, WOODCUTTER, ALARMED);
    employ(world, third, SOLDIER, ALARMED);
    expect(sweep(new Map([[ALARMED, []]]))).toEqual([first, second, last]);
    wakeIdle(world, second);
    world.add(third, MoveGoal, { cell: GOAL }); // its visit wakes a walking idler
    expect(sweep(NO_SHELTERS)).toEqual([first, second, third, last]);
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
  supplyRun: (world, e) => world.add(e, SupplyRun, { site: e, goodType: PLANK, amount: 1, source: null }),
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
  it('passes by only settlers whose release and wake change nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(16, 8) });
    const { world } = sim;
    const ctx = ctxOf(sim);
    const kinds = new Set<string | null>();
    for (const shelters of [NO_SHELTERS, new Map([[ALARMED, []]]) as ShelterSites]) {
      for (const [state, enter] of Object.entries(STATES)) {
        for (const [marker, mark] of Object.entries(MARKERS)) {
          for (const idle of [false, true]) {
            const e = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(4, 4) });
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
              collectInboundSupply(world),
              shelters,
            );
            if (!planned) wakeIdle(world, e);
            expect({ state, marker, idle, planned, wrote: world.mutationVersion !== before }).toEqual({
              state,
              marker,
              idle,
              planned: release === 'idle',
              wrote: false,
            });
          }
        }
      }
    }
    expect(kinds).toEqual(new Set([null, 'held', 'travelling', 'idle']));
  });
});
