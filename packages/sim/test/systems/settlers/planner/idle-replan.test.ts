import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiControl,
  Chat,
  COMPUTER_MODULE_IDS,
  computerModuleEnables,
  DeliveryFlag,
  FamilyDuty,
  IdleStand,
  JobAssignment,
  MoveGoal,
  NeedOrder,
  Owner,
  Position,
  Resource,
  Resting,
  Stance,
  WorkFlag,
} from '../../../../src/components/index.js';
import { type Entity, World } from '../../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../../src/index.js';
import { plannerSystem, stampResourceFootprintData } from '../../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import * as ladder from '../../../../src/systems/settlers/drives/ladder.js';
import {
  COMPUTER_IDLE_REPLAN_PERIOD_TICKS,
  IDLE_REPLAN_PERIOD_TICKS,
  idleBeatOf,
  idleBeatOfTick,
  idleReplanDue,
} from '../../../../src/systems/settlers/planner/idle-replan.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { settlerAt } from '../../../fixtures/settler.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

/**
 * An adult whose ladder found it nothing to do re-plans only on its staggered idle re-plan ticks, while an
 * order addressed to it acts on the tick it applies.
 */

const VIKING = 1;
const P0 = 0;
const P1 = 1;
const HUMAN = IDLE_REPLAN_PERIOD_TICKS;
const COMPUTER = COMPUTER_IDLE_REPLAN_PERIOD_TICKS;
const WOODCUTTER = 1; // harvest atomic 24
const WOOD = 1;
const CHOP = 24;
const FLAG_RADIUS = 4;
/** Long enough for several idle periods. */
const WATCH_TICKS = 4 * IDLE_REPLAN_PERIOD_TICKS;

afterEach(() => vi.restoreAllMocks());

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(48, 32) });
}

function woodcutterAt(sim: Simulation, hx: number, hy: number): Entity {
  const e = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING, position: positionOfNode(hx, hy) });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

/** Make `player` a machine seat whose controller, when it runs, runs no module, so nothing but the
 *  planner touches its settlers. Returns the AiControl carrier. */
function computerSeat(sim: Simulation, player = P0, controllerRuns = true): Entity {
  const carrier = sim.world.create();
  sim.world.add(carrier, AiControl, {
    player,
    modules: computerModuleEnables(Object.fromEntries(COMPUTER_MODULE_IDS.map((id) => [id, false]))),
    computerEnabled: controllerRuns,
    mapAiEnabled: !controllerRuns,
    difficulty: 'hard',
  });
  return carrier;
}

/** Assert idle `e` re-plans exactly on the beats of `period` over two of them. */
function expectBeat(sim: Simulation, e: Entity, period: number): void {
  const watch = 2 * period;
  const ticks = plannedTicks(sim, e, watch);
  expect(ticks.length).toBe(watch / period);
  for (const tick of ticks) expect(idleReplanDue(tick, e, period)).toBe(true);
}

function treeAt(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 3, harvestAtomic: CHOP });
  stampResourceFootprintData(sim.world, e, { walk: [], build: [], work: [{ dx: 0, dy: 0 }] });
  return e;
}

/** The ticks on which `planAdult` ran for `e` while the sim steps `ticks` times. */
function plannedTicks(sim: Simulation, e: Entity, ticks: number): number[] {
  const spy = vi.spyOn(ladder, 'planAdult');
  const seen: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const before = spy.mock.calls.filter((args) => args[1] === e).length;
    sim.step();
    if (spy.mock.calls.filter((args) => args[1] === e).length > before) seen.push(sim.tick);
  }
  return seen;
}

describe('idle re-plan cadence', () => {
  it('an idler is due exactly on the ticks of its beat', () => {
    const span = 2 * IDLE_REPLAN_PERIOD_TICKS;
    const world = new World();
    const idlers = Array.from({ length: span }, () => world.create());
    for (let tick = 0; tick < span; tick++) {
      for (const e of idlers)
        expect(idleBeatOf(e, HUMAN) === idleBeatOfTick(tick, HUMAN)).toBe(idleReplanDue(tick, e, HUMAN));
    }
  });

  it('an idle settler re-plans on its due ticks only', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10); // no tree anywhere
    sim.step();
    expect(sim.world.get(idler, IdleStand)).toEqual({ standing: true });

    const ticks = plannedTicks(sim, idler, WATCH_TICKS);
    expect(ticks.length).toBe(WATCH_TICKS / IDLE_REPLAN_PERIOD_TICKS);
    for (const tick of ticks) expect(idleReplanDue(tick, idler, HUMAN)).toBe(true);
  });

  it('an idle settler takes up new work on its next due tick, at most one period late', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    while (!idleReplanDue(sim.tick, idler, HUMAN)) sim.step();
    treeAt(sim, 16, 10); // just after its beat: the longest wait

    let waited = 0;
    while (!sim.world.has(idler, MoveGoal)) {
      sim.step();
      waited++;
      expect(waited).toBeLessThanOrEqual(IDLE_REPLAN_PERIOD_TICKS);
    }
    expect(waited).toBe(IDLE_REPLAN_PERIOD_TICKS);
    expect(sim.world.has(idler, IdleStand)).toBe(false);
  });

  it('an order addressed to an idle settler acts on the tick it applies', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    while (idleReplanDue(sim.tick + 1, idler, HUMAN)) sim.step();

    const orderTick = sim.tick + 1; // not its due tick
    sim.enqueueSetup({ kind: 'orderNeed', entity: idler, need: 'enjoyment' });
    expect(plannedTicks(sim, idler, 1)).toEqual([orderTick]);
    expect(sim.world.has(idler, NeedOrder)).toBe(true);
  });

  it('a flag gatherer standing by an exhausted flag rescans its flag area on its due ticks only', () => {
    const sim = newSim();
    const gatherer = woodcutterAt(sim, 10, 10);
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(10, 10));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(gatherer, WorkFlag, { flag, radius: FLAG_RADIUS });
    sim.step();
    expect(sim.world.get(gatherer, IdleStand)).toEqual({ standing: false });

    const ticks = plannedTicks(sim, gatherer, WATCH_TICKS);
    expect(ticks.length).toBe(WATCH_TICKS / IDLE_REPLAN_PERIOD_TICKS);
  });
});

describe('a computer seat', () => {
  it('re-plans an idle settler on its own, slower beat', () => {
    const sim = newSim();
    computerSeat(sim);
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    expect(sim.world.get(idler, IdleStand)).toEqual({ standing: true });

    const watch = 2 * COMPUTER;
    const ticks = plannedTicks(sim, idler, watch);
    expect(ticks.length).toBe(watch / COMPUTER);
    for (const tick of ticks) expect(idleReplanDue(tick, idler, COMPUTER)).toBe(true);
  });

  it('re-files the idlers it already has into the slower beat once it turns computer', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    expect(plannedTicks(sim, idler, HUMAN)).toHaveLength(1);

    computerSeat(sim);
    const watch = 2 * COMPUTER;
    const ticks = plannedTicks(sim, idler, watch);
    expect(ticks.length).toBe(watch / COMPUTER);
    for (const tick of ticks) expect(idleReplanDue(tick, idler, COMPUTER)).toBe(true);
  });

  it('keeps a map-AI-only seat, whose computer controller does not run, on the human beat', () => {
    const sim = newSim();
    computerSeat(sim, P0, false);
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    expectBeat(sim, idler, HUMAN);
  });

  it('re-files an idler re-owned from a human seat to a computer seat', () => {
    const sim = newSim();
    computerSeat(sim, P1);
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    expectBeat(sim, idler, HUMAN);

    sim.world.add(idler, Owner, { player: P1 });
    expectBeat(sim, idler, COMPUTER);
  });

  it('returns its idlers to the human beat once it loses AiControl', () => {
    const sim = newSim();
    const carrier = computerSeat(sim);
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    expectBeat(sim, idler, COMPUTER);

    sim.world.remove(carrier, AiControl);
    expectBeat(sim, idler, HUMAN);
  });

  it.each([
    ['family duty', 'outdoors', false, true],
    ['family duty', 'indoors', true, true],
    ['company chat', 'outdoors', false, true],
    ['family duty', 'indoors under a human seat', true, false],
  ])(
    'returns to work after its %s ends %s: outdoors on its beat, indoors on the next pass',
    (hold, _, indoors, computer) => {
      // Planner passes run by hand, so no family or social system ends the hold early.
      const sim = newSim();
      if (computer) computerSeat(sim);
      const held = woodcutterAt(sim, 10, 10);
      treeAt(sim, 16, 10);
      const partner = woodcutterAt(sim, 12, 10);
      const chat = { partner, seeker: true, talking: false, speaks: true, kind: 'company' } as const;
      if (hold === 'family duty') sim.world.add(held, FamilyDuty, { duty: true });
      else sim.world.add(held, Chat, chat);
      if (indoors) sim.world.add(held, Resting, { at: sim.world.create() });
      const key = sim.world.tryGet(held, Resting)?.at ?? held;
      let tick = 1;
      const pass = (): void => {
        plannerSystem(sim.world, { ...ctxOf(sim), tick });
        tick++;
      };
      pass();
      expect(sim.world.get(held, IdleStand)).toEqual({ standing: false });
      // Released just after its beat: the longest wait outdoors.
      while (!idleReplanDue(tick, key, computer ? COMPUTER : HUMAN)) pass();
      pass();
      if (hold === 'family duty') sim.world.remove(held, FamilyDuty);
      else sim.world.remove(held, Chat);

      const spy = vi.spyOn(ladder, 'planAdult');
      let waited = 0;
      while (!spy.mock.calls.some((args) => args[1] === held)) {
        pass();
        waited++;
      }
      expect(waited).toBe(indoors ? 1 : COMPUTER);
      expect(sim.world.has(held, IdleStand)).toBe(false);
    },
  );

  it.each([
    ['outdoors', false],
    ['indoors', true],
  ])('waits a family duty out %s on its beat, as a human seat does only indoors', (_, indoors) => {
    // Planner passes run by hand, since the family system drops a duty no child order claims.
    const heldPlans = (computer: boolean): { key: Entity; planned: number[] } => {
      const sim = newSim();
      if (computer) computerSeat(sim);
      const held = woodcutterAt(sim, 10, 10);
      sim.world.add(held, FamilyDuty, { duty: true });
      if (indoors) sim.world.add(held, Resting, { at: sim.world.create() });
      const spy = vi.spyOn(ladder, 'planAdult');
      const planned: number[] = [];
      for (let tick = 1; tick <= COMPUTER; tick++) {
        const before = spy.mock.calls.length;
        plannerSystem(sim.world, { ...ctxOf(sim), tick });
        if (spy.mock.calls.length > before) planned.push(tick);
      }
      spy.mockRestore();
      expect(sim.world.tryGet(held, IdleStand)).toEqual(
        computer || indoors ? { standing: false } : undefined,
      );
      return { key: sim.world.tryGet(held, Resting)?.at ?? held, planned };
    };
    const human = heldPlans(false);
    // Outdoors every pass; indoors the first pass, then each of its short beats.
    const firstThenBeats = (tick: number): boolean => tick === 1 || idleReplanDue(tick, human.key, HUMAN);
    const everyTick = Array.from({ length: COMPUTER }, (_, i) => i + 1);
    expect(human.planned).toEqual(indoors ? everyTick.filter(firstThenBeats) : everyTick);
    const { key, planned } = heldPlans(true);
    expect(planned).toHaveLength(2); // the first pass, then its beat
    expect(idleReplanDue(planned[1] ?? -1, key, COMPUTER)).toBe(true);
  });

  it('holds a guard at its post on its beat, a human seat’s too unless a workplace binds it', () => {
    const guardPlans = (computer: boolean, posted = false): number => {
      const sim = newSim();
      if (computer) computerSeat(sim);
      const guard = woodcutterAt(sim, 10, 10);
      sim.world.add(guard, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
      if (posted) sim.world.add(guard, JobAssignment, { workplace: sim.world.create() });
      sim.step();
      return plannedTicks(sim, guard, COMPUTER).length;
    };
    expect(guardPlans(false)).toBe(COMPUTER / HUMAN);
    expect(guardPlans(false, true)).toBe(COMPUTER);
    expect(guardPlans(true)).toBe(1);
  });
});
