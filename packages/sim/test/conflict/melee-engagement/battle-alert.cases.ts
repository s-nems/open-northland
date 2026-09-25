import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  addCurrentAtomic,
  Building,
  Chat,
  CurrentAtomic,
  Engagement,
  Equipment,
  type EquipmentSlot,
  FOG_MODE,
  Health,
  HuntFocus,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  NeedOrder,
  Position,
  Settler,
  Stance,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, type NodeId, ONE, Simulation } from '../../../src/index.js';
import {
  combatSystem,
  NEED_CRITICAL_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  plannerSystem,
} from '../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import {
  applyPendingHitReactions,
  type PendingHitReaction,
  resolveCombatHit,
} from '../../../src/systems/settlers/atomics/effects/combat/index.js';
import { testContent } from '../../fixtures/content.js';
import { stepToIdleReplan } from '../../fixtures/idle-replan.js';
import { BEAR, ctxOf, FRANK, fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './support.js';

/**
 * THE BATTLE ALERT: a unit whose stance fights takes no rest and no company while a fight is on around it.
 * Between blows, or in a rear rank, it answers a need only with what it carries, and one asleep in the open
 * gets up the moment an enemy comes into its reach. Fighting inside the rest clearance raises the alert,
 * and so does an enemy soldier standing inside the nearer stand-to radius; wildlife raises neither.
 */

const FOOD = 3;
const MEAD = 13;
const SLEEP_ATOMIC = 8;
const HEADQUARTERS = 1;
/** Over the drive threshold and still inside the bar. */
const PRESSING: Fixed = fx.div(fx.fromInt(9), fx.fromInt(10));
/** Between the drive threshold and the critical mark, where a unit on alert still holds for food. */
const HUNGRY: Fixed = fx.div(fx.fromInt(85), fx.fromInt(100));
/** What one sip of mead takes off the hunger bar: half of it. */
const MEAD_SIP: Fixed = fx.div(ONE, fx.fromInt(2));
/** Cell distances along one row, where a cell is two half-cell nodes. `NEAR_CELLS` is inside the 32-node
 *  stand-to radius but past the 16-node sight radius, so the unit has the fight near it without being drawn
 *  into it; `CLEAR_CELLS` is past the 40-node rest clearance. */
const NEAR_CELLS = 12;
const CLEAR_CELLS = 21;
/** Between the stand-to radius and the rest clearance: too near to lie down, too far to be woken. */
const EDGE_CELLS = 18;
/** Long enough for the ten-cell walk to the larder and the meal at the end of it. */
const ORDERED_MEAL_BUDGET_TICKS = 400;
/** Long enough for the fixture's six-tick sleep clip and the order's own tick to land. */
const ORDERED_SLEEP_BUDGET_TICKS = 60;
/** A sleep far longer than any run below, so only a wake can end it. */
const LONG_SLEEP_TICKS = 10_000;
/** The fixture's unarmed soldier class: a fighter trade, which the company rungs refuse outright. */
const SOLDIER = 31;
/** Enough soldiers that a per-settler sweep would show up as more than one. */
const PEACETIME_ARMY = 20;
/** Enough ticks for a neighbouring enemy to close and land its first blow. */
const FIRST_BLOW_BUDGET_TICKS = 120;

function tiredFighterAt(sim: Simulation, x: number): Entity {
  const e = fighterAt(sim, x, 0, VIKING, WOODCUTTER, { owner: P0 });
  sim.world.mut(e, Settler).fatigue = PRESSING;
  return e;
}

function enemyAt(sim: Simulation, x: number, hitpoints = 1_000_000): Entity {
  return fighterAt(sim, x, 0, FRANK, WOODCUTTER, { owner: P1, hitpoints });
}

/** An enemy that can actually swing: the fixture arms the Viking classes, so a raider who has to land a
 *  blow is a Viking of the other seat, hostile by the default diplomacy. */
function raiderAt(sim: Simulation, x: number, hitpoints = 1000): Entity {
  return fighterAt(sim, x, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints });
}

/** An enemy in a fight of its own: what the alert is keyed on. Its opponent is off the fixture - the
 *  engagement is what a unit nearby reads, not who is on the other end of it. */
function fightingEnemyAt(sim: Simulation, x: number, hitpoints = 1_000_000): Entity {
  const e = enemyAt(sim, x, hitpoints);
  sim.world.add(e, Engagement, { repathAt: sim.tick });
  return e;
}

function sleeps(sim: Simulation, e: Entity): boolean {
  return sim.world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
}

function putToSleep(sim: Simulation, e: Entity): void {
  addCurrentAtomic(sim.world, e, {
    atomicId: SLEEP_ATOMIC,
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
  it('a tired fighter does not lie down with an enemy fighting inside its clearance', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    fightingEnemyAt(sim, NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(false);
    expect(sim.world.has(tired, MoveGoal)).toBe(false); // nor walks off to a bed
  });

  it('the same tired fighter lies down once the fighting is past the rest clearance', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    fightingEnemyAt(sim, CLEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(true);
  });

  it('an enemy on its feet holds it too, but only from inside the stand-to radius', () => {
    const rests = (enemyCells: number): boolean => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
      const tired = tiredFighterAt(sim, 0);
      enemyAt(sim, enemyCells); // on its feet, fighting nobody
      plannerSystem(sim.world, ctxOf(sim));
      return sleeps(sim, tired);
    };

    // Contact is seconds away at twenty-four nodes, whether or not anyone has swung yet.
    expect(rests(NEAR_CELLS)).toBe(false);
    // Past the stand-to radius an enemy merely standing there is not a reason to give up sleeping; a
    // fight at that distance still is, which the edge-of-the-battle case below pins.
    expect(rests(EDGE_CELLS)).toBe(true);
  });

  it('a hunter’s kill is no battle: its own side’s chase does not hold the camp up', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    const hunter = fighterAt(sim, NEAR_CELLS, 0, VIKING, WOODCUTTER, { owner: P0 });
    const prey = fighterAt(sim, NEAR_CELLS + 1, 0, BEAR, null, {});
    sim.world.add(hunter, Engagement, { repathAt: sim.tick });
    sim.world.add(hunter, HuntFocus, { target: prey });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(true);
  });

  it('an enemy whose stance does not fight is nobody’s reason to stand to', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    const peaceable = enemyAt(sim, NEAR_CELLS);
    sim.world.mut(peaceable, Stance).mode = MILITARY_MODE.FLEE; // a carrier of the other seat, say

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, tired)).toBe(true);
  });

  it('a prowling bear is no battle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const tired = tiredFighterAt(sim, 0);
    fighterAt(sim, NEAR_CELLS, 0, BEAR, null, {}); // aggressive, unowned, and minding its own business

    plannerSystem(sim.world, ctxOf(sim));

    // It is answered when it closes, by the fight half of the alert; wildlife on the horizon is not a
    // reason for a settlement to stop sleeping.
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

  it('a fight the player cannot see raises no alarm', () => {
    const rests = (fog: boolean): boolean => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
      // Rested at first, so the setup tick below cannot bed it down before the alert is the question.
      const watch = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
      if (fog) sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON_FOG_OF_WAR });
      // The mode lands and the vision masks are built around what stands on the map; the hand-run pass
      // below then falls on the watch's idle re-plan tick.
      stepToIdleReplan(sim, watch);

      fightingEnemyAt(sim, NEAR_CELLS);
      sim.world.mut(watch, Settler).fatigue = PRESSING;
      plannerSystem(sim.world, ctxOf(sim));
      return sleeps(sim, watch);
    };

    // Inside the clearance, but past this trade's twelve-node eyes and with nobody of the player's own in
    // the fight: what it cannot see cannot rouse it. With the fog off it sees the same fight and holds.
    expect(rests(true)).toBe(true);
    expect(rests(false)).toBe(false);
  });

  it('a passive unit is no fighter: it lies down beside the fighting', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const passive = tiredFighterAt(sim, 0);
    sim.world.mut(passive, Stance).mode = MILITARY_MODE.IGNORE;
    fightingEnemyAt(sim, NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sleeps(sim, passive)).toBe(true);
  });

  it('a player’s order to sleep is obeyed on alert, and no fight out of its reach gets it up', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const ordered = tiredFighterAt(sim, 0);
    fightingEnemyAt(sim, NEAR_CELLS);
    sim.enqueueSetup({ kind: 'orderNeed', entity: ordered, need: 'fatigue' });
    sim.step(); // the order lands and the unit lies down

    expect(sleeps(sim, ordered)).toBe(true);
    for (let t = 0; t < ORDERED_SLEEP_BUDGET_TICKS && sim.world.has(ordered, NeedOrder); t++) sim.step();

    expect(sim.world.has(ordered, NeedOrder)).toBe(false); // the sleep ran to its end
    expect(sim.world.get(ordered, Settler).fatigue).toBeLessThan(PRESSING);
  });

  it('a computer seat’s fighter on alert is not handed the sated bar it never went looking for', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const hungry = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.world.mut(hungry, Settler).hunger = HUNGRY;
    larderAt(sim, 0);
    const foe = fighterAt(sim, 10 + NEAR_CELLS, 0, FRANK, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    sim.world.add(foe, Engagement, { repathAt: sim.tick });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: P1, enabled: true });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hungry, Settler).hunger).toBeGreaterThanOrEqual(HUNGRY);
    expect(sim.world.has(hungry, MoveGoal)).toBe(false);
  });

  it('a hungry fighter on alert drinks its mead where it stands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const hungry = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(hungry, Settler).hunger = PRESSING;
    carryMead(sim, hungry);
    larderAt(sim, 0);
    fightingEnemyAt(sim, 10 + NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hungry, Settler).hunger).toBe(fx.sub(PRESSING, MEAD_SIP));
    expect(sim.world.has(hungry, MoveGoal)).toBe(false);
  });

  it('a hungry fighter on alert with no rations does not walk to the larder', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const hungry = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(hungry, Settler).hunger = HUNGRY;
    larderAt(sim, 0);
    fightingEnemyAt(sim, 10 + NEAR_CELLS);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hungry, MoveGoal)).toBe(false);
  });

  it('but once its hunger is critical it goes to eat, so a standoff cannot starve it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const starving = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(starving, Settler).hunger = NEED_CRITICAL_THRESHOLD;
    larderAt(sim, 0);
    fightingEnemyAt(sim, 10 + NEAR_CELLS);

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

  it('an ordered sleeper still gets up for the target its attack order names', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const sleeper = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(sleeper, Stance).mode = MILITARY_MODE.IGNORE; // it fights because it was told to, not by stance
    const target = enemyAt(sim, 1);
    sim.world.add(sleeper, AttackOrder, { target });
    putToSleep(sim, sleeper);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(sleeper, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target });
  });

  it('a blow leaves a chaser’s route to the CombatSystem, which owns it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const chaser = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(chaser, Engagement, { repathAt: sim.tick });
    sim.world.add(chaser, MoveGoal, { cell: cellNode(sim, 8) });
    const raider = raiderAt(sim, 1);
    const reactions: PendingHitReaction[] = [];
    // Feed the landing blow to its shared melee/projectile resolution seam. A full combat tick can
    // legitimately make this nearby chaser begin its own swing first, which retires its chase route.
    resolveCombatHit(sim.world, ctxOf(sim), raider, chaser, { damage: 50 }, reactions, 'melee');
    applyPendingHitReactions(sim.world, reactions);

    expect(sim.world.get(chaser, Health).hitpoints).toBeLessThan(sim.world.get(chaser, Health).max);
    // Shedding it here would stutter every advance under fire; the chase re-aims its own route.
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);
  });

  it('an ordered meal breaks the fight off, which is how a player feeds a line that would starve', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const engaged = fighterAt(sim, 10, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(engaged, Settler).hunger = ONE;
    sim.world.add(engaged, Engagement, { repathAt: sim.tick });
    larderAt(sim, 0);
    sim.world.add(engaged, AttackOrder, { target: enemyAt(sim, 10 + NEAR_CELLS) });
    sim.enqueueSetup({ kind: 'orderNeed', entity: engaged, need: 'hunger' });

    sim.step();
    expect(sim.world.has(engaged, MoveGoal)).toBe(true); // on its way to the larder
    expect(sim.world.has(engaged, Engagement)).toBe(false); // and out of the fight while it goes
    expect(sim.world.has(engaged, AttackOrder)).toBe(false); // the order it retired, rather than ignored

    // And it stays out: the CombatSystem leaves a unit on an ordered errand alone instead of walking it
    // back into the fight it was just pulled from.
    for (let t = 0; t < ORDERED_MEAL_BUDGET_TICKS && sim.world.has(engaged, NeedOrder); t++) sim.step();
    expect(sim.world.has(engaged, Engagement)).toBe(false);
    expect(sim.world.get(engaged, Settler).hunger).toBeLessThan(ONE); // it got its meal
  });

  it('nobody walks off to chat while the fighting is on', () => {
    const chatters = (x: number): Simulation => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
      for (const at of [0, 2]) {
        // A civilian trade a player put into a fighting stance: the fighting trades never chat at all.
        const e = fighterAt(sim, at, 0, VIKING, WOODCUTTER, { owner: P0 });
        sim.world.mut(e, Settler).enjoyment = NEED_DRIVE_THRESHOLD;
      }
      fightingEnemyAt(sim, x);
      plannerSystem(sim.world, ctxOf(sim));
      return sim;
    };

    const chatting = (sim: Simulation): number => [...sim.world.query(Chat)].length;
    expect(chatting(chatters(NEAR_CELLS))).toBe(0);
    expect(chatting(chatters(CLEAR_CELLS))).toBeGreaterThan(0); // with the fight far off, they talk
  });

  it('the read seam answers the ladder\u2019s own question, for a HUD that would say "idle"', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const soldier = tiredFighterAt(sim, 0);
    const far = tiredFighterAt(sim, CLEAR_CELLS + NEAR_CELLS);
    const hunter = tiredFighterAt(sim, 1);
    sim.world.add(hunter, HuntFocus, { target: far });
    fightingEnemyAt(sim, NEAR_CELLS);

    expect(sim.standsTo(soldier)).toBe(true);
    expect(sim.standsTo(far)).toBe(false); // the fighting is past its clearance
    expect(sim.standsTo(hunter)).toBe(false); // a hunt is no battle
  });

  it('costs a settlement at peace nothing: no sweep unless a rung would act on the answer', () => {
    // The expensive half of the alert is one sweep of the owned settlers. Every rung asks for it last,
    // after its own cheap refusals, so an army standing about in peacetime never pays for it.
    const sweepsPerPass = (bar: 'none' | 'hunger' | 'enjoyment'): number => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 4) });
      for (let i = 0; i < PEACETIME_ARMY; i++) {
        const e = fighterAt(sim, i % 20, i % 4, VIKING, SOLDIER, { owner: P0 });
        if (bar !== 'none') sim.world.mut(e, Settler)[bar] = HUNGRY;
      }
      let sweeps = 0;
      const world = sim.world as unknown as { query: (...c: { name?: string }[]) => unknown };
      const real = world.query.bind(sim.world);
      world.query = (...comps: { name?: string }[]) => {
        // The presence index's own query, and nothing else in the planner asks for this exact set.
        const names = comps.map((c) => c.name ?? '?');
        if (names.join('+') === 'Settler+Health+Position+Owner') sweeps++;
        return real(...comps);
      };
      plannerSystem(sim.world, ctxOf(sim));
      return sweeps;
    };

    expect(sweepsPerPass('none')).toBe(0); // nobody wants anything
    expect(sweepsPerPass('enjoyment')).toBe(0); // a soldier never chats, so the company rungs refuse first
    expect(sweepsPerPass('hunger')).toBe(1); // once for the pass, however many soldiers ask
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

  it('at a battle’s edge it neither lies down nor is woken, so the fight’s steps do not rouse it', () => {
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

  it('a passive unit is not roused by a fight beside it, but a blow still ends its sleep', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const passive = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(passive, Stance).mode = MILITARY_MODE.IGNORE;
    putToSleep(sim, passive);
    raiderAt(sim, 1);

    combatSystem(sim.world, ctxOf(sim));
    expect(sleeps(sim, passive)).toBe(true); // the fight alone is none of its business

    for (let t = 0; t < FIRST_BLOW_BUDGET_TICKS && sleeps(sim, passive); t++) sim.step();
    expect(sleeps(sim, passive)).toBe(false); // nobody is cut down in their sleep
    expect(sim.world.get(passive, Health).hitpoints).toBeLessThan(sim.world.get(passive, Health).max);
  });

  it('a blow ends the errand of a fighting unit walking one of its own', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const walker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(walker, MoveGoal, { cell: cellNode(sim, 30) });
    raiderAt(sim, 6); // standing on the way, so the errand walks into its reach

    for (let t = 0; t < FIRST_BLOW_BUDGET_TICKS; t++) {
      sim.step();
      if (sim.world.get(walker, Health).hitpoints < sim.world.get(walker, Health).max) break;
    }

    expect(sim.world.get(walker, Health).hitpoints).toBeLessThan(sim.world.get(walker, Health).max);
    expect(sim.world.has(walker, MoveGoal)).toBe(false); // it turned round instead of walking on
  });
});

/** The terrain node at a visual cell anchor on row 0. */
function cellNode(sim: Simulation, x: number): NodeId {
  const anchor = cellAnchorNode(x, 0);
  const node = sim.terrain?.nodeAt(anchor.hx, anchor.hy);
  if (node === undefined) throw new Error('fixture map has no such cell');
  return node;
}
