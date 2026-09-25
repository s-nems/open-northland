import { describe, expect, it, vi } from 'vitest';
import {
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  Position,
  Resting,
  Stance,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import {
  ALARM_PEOPLE_RADIUS_NODES,
  ALARM_SOLDIER_RADIUS_NODES,
} from '../../src/systems/conflict/hit-alarm.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../src/systems/index.js';
import { moveUnit } from '../../src/systems/orders/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_SPEAR,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

const P0 = 0;
const P1 = 1;
const ROW = 0;
const MAP_CELLS = 50;
const VICTIM_AT = 10;
const BLOW = { damage: 10 };
/** A blow that does no damage, which leaves the struck side's diplomacy as it was. */
const HARMLESS_BLOW = { damage: 0 };

/** Offsets from the victim, in map points along its row. */
const PAST_SIGHT = 30; // beyond a soldier's own sight, inside the soldiers' alarm
const NEAR_PERSON = 15; // inside the people's alarm
const FAR_PERSON = 25; // past the people's alarm, inside the soldiers'
const BESIDE = 5; // well inside both

function sim(): Simulation {
  return new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(MAP_CELLS, 2) });
}

function unit(s: Simulation, hx: number, owner: number, mode: MilitaryMode, job = SOLDIER_SPEAR): Entity {
  const e = fighterAtNode(s, hx, ROW, owner === P0 ? VIKING : SAXON, job);
  s.world.add(e, Owner, { player: owner });
  s.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** A blue woman struck by a red soldier standing beside her. */
function struck(s: Simulation): { victim: Entity; attacker: Entity } {
  const victim = unit(s, VICTIM_AT, P0, MILITARY_MODE.FLEE, WOMAN);
  const attacker = unit(s, VICTIM_AT - 1, P1, MILITARY_MODE.ATTACK);
  return { victim, attacker };
}

function held(s: Simulation, e: Entity): Entity | undefined {
  return s.world.tryGet(e, Engagement)?.target;
}

describe('hit alarm - a blow alarms the struck person side', () => {
  it('turns a soldier past its own sight on the attacker once the combat pass answers a melee blow', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    expect(PAST_SIGHT).toBeGreaterThan(SIGHT_RADIUS_NODES);
    expect(PAST_SIGHT).toBeLessThanOrEqual(ALARM_SOLDIER_RADIUS_NODES);
    const comrade = unit(s, VICTIM_AT + PAST_SIGHT, P0, MILITARY_MODE.ATTACK);
    const beyond = unit(s, VICTIM_AT + ALARM_SOLDIER_RADIUS_NODES + 1, P0, MILITARY_MODE.ATTACK);

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    expect(held(s, comrade)).toBeUndefined(); // waits for the combat pass
    combatSystem(s.world, ctxOf(s));

    expect(held(s, comrade)).toBe(attacker);
    expect(held(s, beyond)).toBeUndefined();
  });

  it('answers a shot at once, since shots land after the combat pass', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const comrade = unit(s, VICTIM_AT + PAST_SIGHT, P0, MILITARY_MODE.DEFEND);
    combatSystem(s.world, ctxOf(s));

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'projectile');

    expect(held(s, comrade)).toBe(attacker);
  });

  it('runs the near people and leaves the far ones and a soldier under IGNORE alone', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const near = unit(s, VICTIM_AT + NEAR_PERSON, P0, MILITARY_MODE.FLEE, WOMAN);
    const far = unit(s, VICTIM_AT + FAR_PERSON, P0, MILITARY_MODE.FLEE, WOMAN);
    const ignoring = unit(s, VICTIM_AT + BESIDE, P0, MILITARY_MODE.IGNORE);
    expect(NEAR_PERSON).toBeLessThanOrEqual(ALARM_PEOPLE_RADIUS_NODES);
    expect(FAR_PERSON).toBeGreaterThan(ALARM_PEOPLE_RADIUS_NODES);

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    combatSystem(s.world, ctxOf(s));

    expect(s.world.has(near, Fleeing)).toBe(true);
    const goal = s.world.get(near, MoveGoal).cell;
    expect(s.terrain?.xOf(goal)).toBeGreaterThan(VICTIM_AT + NEAR_PERSON); // away from the attacker
    expect(s.world.has(far, Fleeing)).toBe(false);
    expect(s.world.has(ignoring, Engagement)).toBe(false);
  });

  it('never runs a soldier, whatever its stance, and holds a civilian under IGNORE', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const fleeingSoldier = unit(s, VICTIM_AT + BESIDE, P0, MILITARY_MODE.FLEE);
    const ignoringCivilian = unit(s, VICTIM_AT + NEAR_PERSON, P0, MILITARY_MODE.IGNORE, WOMAN);

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    combatSystem(s.world, ctxOf(s));

    for (const e of [fleeingSoldier, ignoringCivilian]) {
      expect(s.world.has(e, Fleeing)).toBe(false);
      expect(held(s, e)).toBeUndefined();
    }
  });

  it('answers each attacker once a tick, however many blows it lands', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const second = unit(s, VICTIM_AT + 1, P0, MILITARY_MODE.FLEE, WOMAN);
    const other = unit(s, VICTIM_AT + 2, P1, MILITARY_MODE.ATTACK);
    const answers = vi.spyOn(CombatIndex.prototype, 'ownedWithin');
    try {
      resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
      resolveCombatHit(s.world, ctxOf(s), attacker, second, BLOW, [], 'melee');
      resolveCombatHit(s.world, ctxOf(s), other, second, BLOW, [], 'melee');
      combatSystem(s.world, ctxOf(s));
      expect(answers).toHaveBeenCalledTimes(2);
    } finally {
      answers.mockRestore();
    }
  });

  it('drops a melee alarm that its own tick did not answer', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const comrade = unit(s, VICTIM_AT + PAST_SIGHT, P0, MILITARY_MODE.ATTACK);

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    combatSystem(s.world, { ...ctxOf(s), tick: s.tick + 1 });

    expect(held(s, comrade)).toBeUndefined();
  });
});

describe('hit alarm - who does not answer', () => {
  it('a side at peace with a harmless striker, and anyone near a dead one', () => {
    const peace = sim();
    const calm = struck(peace);
    setDiplomacyStance(peace.world, P0, P1, 'friend');
    setDiplomacyStance(peace.world, P1, P0, 'friend');
    const soldier = unit(peace, VICTIM_AT + BESIDE, P0, MILITARY_MODE.ATTACK);
    const person = unit(peace, VICTIM_AT + NEAR_PERSON, P0, MILITARY_MODE.FLEE, WOMAN);
    resolveCombatHit(peace.world, ctxOf(peace), calm.attacker, calm.victim, HARMLESS_BLOW, [], 'melee');
    combatSystem(peace.world, ctxOf(peace));
    expect(held(peace, soldier)).toBeUndefined();
    expect(peace.world.has(person, Fleeing)).toBe(false);

    const dead = sim();
    const fallen = struck(dead);
    const comrade = unit(dead, VICTIM_AT + PAST_SIGHT, P0, MILITARY_MODE.ATTACK);
    const neighbour = unit(dead, VICTIM_AT + NEAR_PERSON, P0, MILITARY_MODE.FLEE, WOMAN);
    resolveCombatHit(dead.world, ctxOf(dead), fallen.attacker, fallen.victim, BLOW, [], 'melee');
    dead.world.mut(fallen.attacker, Health).hitpoints = 0; // felled by a blow of its own this tick
    combatSystem(dead.world, ctxOf(dead));
    expect(held(dead, comrade)).toBeUndefined();
    expect(dead.world.has(neighbour, Fleeing)).toBe(false);
  });

  it('a soldier inside a house', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const sleeper = unit(s, VICTIM_AT + PAST_SIGHT, P0, MILITARY_MODE.ATTACK);
    s.world.add(sleeper, Resting, { at: sleeper });

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    combatSystem(s.world, ctxOf(s));

    expect(held(s, sleeper)).toBeUndefined();
  });

  it('a soldier walking under a move order, which it walks out to the end', () => {
    const MARCH_FROM = 30;
    const MARCH_TO = 60;
    const STRIKE_AFTER_TICKS = 3;
    const SETTLE_TICKS = 300;
    const s = sim();
    const victim = unit(s, VICTIM_AT, P0, MILITARY_MODE.IGNORE, WOMAN);
    const attacker = unit(s, VICTIM_AT - 1, P1, MILITARY_MODE.IGNORE, WOMAN); // strikes once, by hand
    const soldier = unit(s, MARCH_FROM, P0, MILITARY_MODE.ATTACK);
    expect(MARCH_FROM - VICTIM_AT).toBeLessThanOrEqual(ALARM_SOLDIER_RADIUS_NODES);
    expect(MARCH_TO - (VICTIM_AT - 1)).toBeGreaterThan(SIGHT_RADIUS_NODES);
    moveUnit(s.world, ctxOf(s), { kind: 'moveUnit', entity: soldier, x: MARCH_TO, y: ROW });
    for (let t = 0; t < STRIKE_AFTER_TICKS; t++) s.step();

    resolveCombatHit(s.world, { ...ctxOf(s), tick: s.tick + 1 }, attacker, victim, BLOW, [], 'melee');
    s.step();
    expect(held(s, soldier)).toBeUndefined();
    for (let t = 0; t < SETTLE_TICKS; t++) s.step();

    const p = s.world.get(soldier, Position);
    expect(nodeOfPosition(p.x, p.y)).toEqual({ hx: MARCH_TO, hy: ROW });
  });
});
