import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  MealBreak,
  MealBreakRetry,
  MoveGoal,
  NoRegeneration,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  SettlerNeeds,
  SIGNPOST_SPACING_NODES,
  Signpost,
  Stockpile,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { type Fixed, fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, ONE, Simulation } from '../../src/index.js';
import {
  NEED_CRITICAL_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  needBar,
  needLevel,
} from '../../src/systems/index.js';
import { MEAL_BREAK_RETRY_TICKS } from '../../src/systems/orders/meal-break.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/** Hunger at the level the HUD marks takes a settler off its player orders to eat, then the orders go on. */

const VIKING = 1;
const HUMAN_PLAYER = 0;
const WOODCUTTER = 1;
const SCOUT = 27;
const SOLDIER = 31;
const HEADQUARTERS = 1;
const FOOD = 3;
const LARDER = 5;
const WALK_BUDGET = 1200;
/** Ticks of drain before a walker given this much hunger reaches the critical level: well into its walk. */
const TICKS_TO_CRITICAL = 40;
const NEARLY_CRITICAL: Fixed = fx.sub(NEED_CRITICAL_THRESHOLD, needBar(TICKS_TO_CRITICAL));

function freshSim(width = 96, height = 8): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(width, height) });
}

function ownedSettler(sim: Simulation, x: number, y: number, jobType: number, needs = {}): Entity {
  const e = settlerAt(sim, { jobType, needs, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

function larderAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, LARDER]]) });
  return e;
}

function walk(e: Entity, cx: number, cy: number, queued = false): Command {
  const n = cellAnchorNode(cx, cy);
  return { kind: 'moveUnit', entity: e, x: n.hx, y: n.hy, ...(queued ? { queued } : {}) };
}

function standsAt(sim: Simulation, e: Entity, cx: number, cy: number): boolean {
  const p = sim.world.get(e, Position);
  return fx.toInt(p.x) === cx && fx.toInt(p.y) === cy && !sim.world.has(e, PlayerOrder);
}

function hunger(sim: Simulation, e: Entity): Fixed {
  return needLevel(sim.world.get(e, SettlerNeeds), 'hunger', sim.tick);
}

/** Step until `done`, reporting whether a meal break ever held the settler on the way. */
function stepUntil(sim: Simulation, e: Entity, done: () => boolean, budget = WALK_BUDGET): boolean {
  let broke = false;
  for (let t = 0; t < budget && !done(); t++) {
    sim.step();
    broke ||= sim.world.has(e, MealBreak);
  }
  return broke;
}

describe('meal break', () => {
  it('a starving scout eats between its queued signposts, then erects them all', () => {
    const sim = freshSim();
    const larder = larderAt(sim, 6, 6);
    const scout = ownedSettler(sim, 2, 2, SCOUT, { hunger: NEED_CRITICAL_THRESHOLD });
    const spots = [8, 8 + SIGNPOST_SPACING_NODES, 8 + 2 * SIGNPOST_SPACING_NODES];
    spots.forEach((x, i) => {
      sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x, y: 4, ...(i > 0 ? { queued: true } : {}) });
    });
    const broke = stepUntil(sim, scout, () => [...sim.world.query(Signpost)].length === spots.length);
    expect(broke).toBe(true);
    expect([...sim.world.query(Signpost)]).toHaveLength(spots.length);
    expect(sim.world.get(larder, Stockpile).amounts.get(FOOD)).toBeLessThan(LARDER);
    expect(hunger(sim, scout)).toBeLessThan(NEED_DRIVE_THRESHOLD);
  });

  it('holds the queue while it walks to food, its next order kept at the head', () => {
    const sim = freshSim();
    larderAt(sim, 30, 6);
    const e = ownedSettler(sim, 2, 2, WOODCUTTER, { hunger: NEED_CRITICAL_THRESHOLD });
    sim.world.add(e, OrderQueue, { orders: [walk(e, 40, 2) as Extract<Command, { kind: 'moveUnit' }>] });
    sim.step();
    expect(sim.world.has(e, MealBreak)).toBe(true);
    expect(sim.world.get(e, OrderQueue).orders).toHaveLength(1);
    expect(sim.world.has(e, PlayerOrder)).toBe(false);
    expect(sim.world.has(e, MoveGoal)).toBe(true); // to the larder
  });

  it('turns off a long walk once hunger reaches the critical level, eats, and walks the order out', () => {
    const sim = freshSim();
    const larder = larderAt(sim, 20, 6);
    const e = ownedSettler(sim, 2, 2, WOODCUTTER, { hunger: NEARLY_CRITICAL });
    sim.enqueueSetup(walk(e, 60, 2));
    const broke = stepUntil(sim, e, () => standsAt(sim, e, 60, 2) && !sim.world.has(e, OrderQueue));
    expect(broke).toBe(true);
    expect(standsAt(sim, e, 60, 2)).toBe(true);
    expect(sim.world.get(larder, Stockpile).amounts.get(FOOD)).toBeLessThan(LARDER);
  });

  it('a soldier whose regeneration is prohibited marches on hungry', () => {
    const sim = freshSim();
    const larder = larderAt(sim, 20, 6);
    const e = ownedSettler(sim, 2, 2, SOLDIER, { hunger: NEARLY_CRITICAL });
    sim.world.add(e, NoRegeneration, { prohibited: true });
    sim.enqueueSetup(walk(e, 60, 2));
    const broke = stepUntil(sim, e, () => standsAt(sim, e, 60, 2));
    expect(broke).toBe(false);
    expect(standsAt(sim, e, 60, 2)).toBe(true);
    expect(sim.world.get(larder, Stockpile).amounts.get(FOOD)).toBe(LARDER);
  });

  it('a soldier allowed to regenerate breaks off like a civilian', () => {
    const sim = freshSim();
    larderAt(sim, 20, 6);
    const e = ownedSettler(sim, 2, 2, SOLDIER, { hunger: NEARLY_CRITICAL });
    sim.enqueueSetup(walk(e, 60, 2));
    expect(stepUntil(sim, e, () => standsAt(sim, e, 60, 2))).toBe(true);
  });

  it('fatigue waits for the orders to run out', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER, { fatigue: ONE });
    sim.enqueueSetup(walk(e, 30, 2));
    sim.enqueueSetup(walk(e, 30, 5, true));
    const broke = stepUntil(sim, e, () => standsAt(sim, e, 30, 5) && !sim.world.has(e, OrderQueue));
    expect(broke).toBe(false);
    expect(standsAt(sim, e, 30, 5)).toBe(true);
  });

  it('with nothing in reach to eat it walks on and leaves the next break for later', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER, { hunger: NEARLY_CRITICAL });
    sim.enqueueSetup(walk(e, 60, 2));
    stepUntil(sim, e, () => sim.world.has(e, MealBreakRetry));
    const retry = sim.world.get(e, MealBreakRetry).retryAt;
    expect(retry).toBeGreaterThan(sim.tick);
    expect(retry).toBeLessThanOrEqual(sim.tick + MEAL_BREAK_RETRY_TICKS);
    const broke = stepUntil(sim, e, () => standsAt(sim, e, 60, 2) || sim.tick >= retry);
    expect(broke).toBe(false);
    expect(sim.world.has(e, OrderQueue) || sim.world.has(e, PlayerOrder) || standsAt(sim, e, 60, 2)).toBe(
      true,
    );
  });

  it('an order given during the break calls the break and the waiting orders off', () => {
    const sim = freshSim();
    larderAt(sim, 30, 6);
    const e = ownedSettler(sim, 2, 2, WOODCUTTER, { hunger: NEED_CRITICAL_THRESHOLD });
    sim.world.add(e, OrderQueue, { orders: [walk(e, 40, 2) as Extract<Command, { kind: 'moveUnit' }>] });
    sim.step();
    expect(sim.world.has(e, MealBreak)).toBe(true);
    sim.enqueueSetup(walk(e, 2, 6));
    sim.step();
    expect(sim.world.has(e, MealBreak)).toBe(false);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
  });
});
