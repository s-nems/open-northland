import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  Engagement,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  Position,
  Settler,
  Stance,
  Stockpile,
  stampMissionBehaviour,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, type NodeId, ONE, Simulation } from '../../../src/index.js';
import { combatSystem, NEED_CRITICAL_THRESHOLD, plannerSystem } from '../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, FRANK, fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './support.js';

/**
 * THE BATTLE ALERT: a unit whose stance fights takes no rest while a fight is on around it. Between blows,
 * or in a rear rank, it answers a need only with what it carries, and one asleep in the open gets up the
 * moment an enemy comes into its reach.
 */

const FOOD = 3;
const MEAD = 13;
const EAT_ATOMIC = 10;
const SLEEP_ATOMIC = 8;
const HEADQUARTERS = 1;
/** Over the drive threshold and still inside the bar. */
const PRESSING: Fixed = fx.div(fx.fromInt(9), fx.fromInt(10));
/** Between the drive threshold and the critical mark, where a unit on alert still holds for food. */
const HUNGRY: Fixed = fx.div(fx.fromInt(85), fx.fromInt(100));
/** Cell distances along one row, where a cell is two half-cell nodes. `NEAR_CELLS` is inside the 32-node
 *  stand-to radius but past the 16-node sight radius, so the unit sees the fight without being drawn into
 *  it; `CLEAR_CELLS` is past the 40-node rest clearance. */
const NEAR_CELLS = 12;
const CLEAR_CELLS = 21;
/** Between the stand-to radius and the rest clearance: too near to lie down, too far to be woken. */
const EDGE_CELLS = 18;
/** Long enough for the fixture's six-tick sleep clip and the order's own tick to land. */
const ORDERED_SLEEP_BUDGET_TICKS = 60;
/** A sleep far longer than any run below, so only a wake can end it. */
const LONG_SLEEP_TICKS = 10_000;

function tiredFighterAt(sim: Simulation, x: number): Entity {
  const e = fighterAt(sim, x, 0, VIKING, WOODCUTTER, { owner: P0 });
  sim.world.mut(e, Settler).fatigue = PRESSING;
  return e;
}

function enemyAt(sim: Simulation, x: number, hitpoints = 1_000_000): Entity {
  return fighterAt(sim, x, 0, FRANK, WOODCUTTER, { owner: P1, hitpoints });
}

function sleeps(sim: Simulation, e: Entity): boolean {
  return sim.world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
}

function putToSleep(sim: Simulation, e: Entity): void {
  sim.world.add(e, CurrentAtomic, {
    atomicId: SLEEP_ATOMIC,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: LONG_SLEEP_TICKS,
    effect: { kind: 'sleep' },
    targetEntity: e,
    targetTile: null,
  });
}

function larderAt(sim: Simulation, x: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, 5]]) });
}

function carryMead(sim: Simulation, e: Entity): void {
  const misc = new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null);
  misc[0] = { goodType: MEAD, degreeOfUse: fx.fromInt(0) };
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

describe('a fighting unit on alert takes no rest', () => {
  it('a tired fighter does not lie down with an enemy fighter in view', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    enemyAt(sim, NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(false);
    expect(sim.world.has(tired, MoveGoal)).toBe(false); // nor walks off to a bed
  });

  it('the same tired fighter lies down once the enemy is past the rest clearance', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    enemyAt(sim, CLEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(true);
  });

  it('a rear rank stays up while its front rank fights an enemy it cannot see', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const rear = tiredFighterAt(sim, 0);
    const front = fighterAt(sim, NEAR_CELLS, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(front, Engagement, { repathAt: sim.tick });
    enemyAt(sim, NEAR_CELLS + CLEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, rear)).toBe(false);
  });

  it('a passive unit is no fighter: it lies down with an enemy in view', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const passive = tiredFighterAt(sim, 0);
    sim.world.mut(passive, Stance).mode = MILITARY_MODE.IGNORE;
    enemyAt(sim, NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, passive)).toBe(true);
  });

  it('a player’s order to sleep is obeyed on alert, and no fight out of its reach gets it up', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const ordered = tiredFighterAt(sim, 0);
    enemyAt(sim, NEAR_CELLS);
    sim.enqueueSetup({ kind: 'orderNeed', entity: ordered, need: 'fatigue' });
    sim.step(); // the order lands and the unit lies down

    expect(sleeps(sim, ordered)).toBe(true);
    for (let t = 0; t < ORDERED_SLEEP_BUDGET_TICKS && sim.world.has(ordered, NeedOrder); t++) sim.step();

    expect(sim.world.has(ordered, NeedOrder)).toBe(false); // the sleep ran to its end
    expect(sim.world.get(ordered, Settler).fatigue).toBeLessThan(PRESSING);
  });

  it('an enemy that a script holds passive starts no fight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    stampMissionBehaviour(sim.world, enemyAt(sim, NEAR_CELLS), MISSION_BEHAVIOUR.PASSIVE);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(true);
  });

  it('a computer seat’s fighter on alert is not handed the sated bar it never went looking for', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const hungry = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.world.mut(hungry, Settler).hunger = HUNGRY;
    larderAt(sim, 0);
    fighterAt(sim, 10 + NEAR_CELLS, 0, FRANK, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: P1, enabled: true });

    sim.step();

    expect(sim.world.get(hungry, Settler).hunger).toBeGreaterThan(HUNGRY);
    expect(sim.world.has(hungry, MoveGoal)).toBe(false);
  });

  it('a hungry fighter on alert drinks its mead where it stands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const hungry = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(hungry, Settler).hunger = PRESSING;
    carryMead(sim, hungry);
    larderAt(sim, 0);
    enemyAt(sim, 10 + NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(hungry, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC); // the eat gesture doubles as the drink clip
    expect(atomic.effect).toEqual({ kind: 'drink', slot: 0 });
  });

  it('a hungry fighter on alert with no rations does not walk to the larder', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const hungry = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(hungry, Settler).hunger = HUNGRY;
    larderAt(sim, 0);
    enemyAt(sim, 10 + NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hungry, MoveGoal)).toBe(false);
  });

  it('but once its hunger is critical it goes to eat, so a standoff cannot starve it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const starving = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(starving, Settler).hunger = NEED_CRITICAL_THRESHOLD;
    larderAt(sim, 0);
    enemyAt(sim, 10 + NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(starving, MoveGoal)).toBe(true);
  });

  it('an engaged fighter holds even when starving', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const engaged = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(engaged, Settler).hunger = ONE;
    sim.world.add(engaged, Engagement, { repathAt: sim.tick });
    larderAt(sim, 0);
    enemyAt(sim, 10 + NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(engaged, MoveGoal)).toBe(false);
  });

  it('over real ticks, a tired rear rank stays up for the whole fight and rests once it is won', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const rear = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 13, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    // Just past the rear rank's rest clearance, so only the front rank's fight can hold it; the front rank
    // closes to the cell beside it, which is still inside.
    const enemy = enemyAt(sim, CLEAR_CELLS, 400);
    sim.step(); // the front rank engages
    sim.world.mut(rear, Settler).fatigue = PRESSING;

    let sleptMidFight = false;
    for (let t = 0; t < 600 && sim.world.has(enemy, Health); t++) {
      sim.step();
      if (sim.world.has(enemy, Health) && sleeps(sim, rear)) sleptMidFight = true;
    }
    expect(sim.world.has(enemy, Health)).toBe(false); // the fight was won
    expect(sleptMidFight).toBe(false);

    let rested = false;
    for (let t = 0; t < 60 && !rested; t++) {
      sim.step();
      rested = sleeps(sim, rear);
    }
    expect(rested).toBe(true);
  });
});

describe('a fighting unit asleep in the open wakes for a fight', () => {
  it('gets up to strike an enemy in reach', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const sleeper = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    putToSleep(sim, sleeper);
    const enemy = enemyAt(sim, 1);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(sleeper, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
  });

  it('gets up for a fight its front rank is in, though nothing is in its own reach', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const rear = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    putToSleep(sim, rear);
    const front = fighterAt(sim, NEAR_CELLS, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(front, Engagement, { repathAt: sim.tick });
    enemyAt(sim, NEAR_CELLS + CLEAR_CELLS);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(rear, CurrentAtomic)).toBe(false); // up, and standing to
  });

  it('at the edge of a fight it neither lies down nor is woken, so the fight’s steps do not rouse it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const awake = tiredFighterAt(sim, 0);
    const asleep = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    putToSleep(sim, asleep);
    const front = fighterAt(sim, EDGE_CELLS, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(front, Engagement, { repathAt: sim.tick });
    enemyAt(sim, EDGE_CELLS + CLEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));
    combatSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, awake)).toBe(false);
    expect(sleeps(sim, asleep)).toBe(true);
  });

  it('sleeps on with no enemy in reach, and a guard is not walked back to its anchor in its sleep', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(guard, Stance).mode = MILITARY_MODE.DEFEND;
    sim.world.mut(guard, Stance).anchorCell = cellNode(sim, 4);
    putToSleep(sim, guard);
    enemyAt(sim, 30); // wakes the combat system, far outside the guard's radius

    combatSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, guard)).toBe(true);
    expect(sim.world.has(guard, MoveGoal)).toBe(false);
  });

  it('a passive unit sleeps through an enemy beside it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const passive = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(passive, Stance).mode = MILITARY_MODE.IGNORE;
    putToSleep(sim, passive);
    enemyAt(sim, 1);

    combatSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, passive)).toBe(true);
  });
});

/** The terrain node at a visual cell anchor on row 0. */
function cellNode(sim: Simulation, x: number): NodeId {
  const anchor = cellAnchorNode(x, 0);
  const node = sim.terrain?.nodeAt(anchor.hx, anchor.hy);
  if (node === undefined) throw new Error('fixture map has no such cell');
  return node;
}
