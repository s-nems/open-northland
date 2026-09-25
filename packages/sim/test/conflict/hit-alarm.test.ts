import { describe, expect, it, vi } from 'vitest';
import { Engagement, Fleeing, MoveGoal, Owner, Stance } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import {
  ALARM_PEOPLE_RADIUS_NODES,
  ALARM_SOLDIER_RADIUS_NODES,
} from '../../src/systems/conflict/hit-alarm.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../src/systems/index.js';
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

describe('hit alarm - a blow alarms the struck person side', () => {
  it('turns a soldier past its own sight on the attacker once the combat pass answers a melee blow', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const off = 30;
    expect(off).toBeGreaterThan(SIGHT_RADIUS_NODES);
    expect(off).toBeLessThanOrEqual(ALARM_SOLDIER_RADIUS_NODES);
    const comrade = unit(s, VICTIM_AT + off, P0, MILITARY_MODE.ATTACK);
    const beyond = unit(s, VICTIM_AT + ALARM_SOLDIER_RADIUS_NODES + 1, P0, MILITARY_MODE.ATTACK);

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    expect(s.world.tryGet(comrade, Engagement)?.target).toBeUndefined(); // waits for the combat pass
    combatSystem(s.world, ctxOf(s));

    expect(s.world.get(comrade, Engagement).target).toBe(attacker);
    expect(s.world.tryGet(beyond, Engagement)?.target).toBeUndefined();
  });

  it('answers a shot at once, since shots land after the combat pass', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const comrade = unit(s, VICTIM_AT + 30, P0, MILITARY_MODE.DEFEND);
    combatSystem(s.world, ctxOf(s));

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'projectile');

    expect(s.world.get(comrade, Engagement).target).toBe(attacker);
  });

  it('runs the near people and leaves the far ones and a soldier under IGNORE alone', () => {
    const s = sim();
    const { victim, attacker } = struck(s);
    const near = unit(s, VICTIM_AT + 15, P0, MILITARY_MODE.FLEE, WOMAN);
    const far = unit(s, VICTIM_AT + 25, P0, MILITARY_MODE.FLEE, WOMAN);
    const ignoring = unit(s, VICTIM_AT + 5, P0, MILITARY_MODE.IGNORE);
    expect(25).toBeGreaterThan(ALARM_PEOPLE_RADIUS_NODES);

    resolveCombatHit(s.world, ctxOf(s), attacker, victim, BLOW, [], 'melee');
    combatSystem(s.world, ctxOf(s));

    expect(s.world.has(near, Fleeing)).toBe(true);
    const goal = s.world.get(near, MoveGoal).cell;
    expect(s.terrain?.xOf(goal)).toBeGreaterThan(VICTIM_AT + 15); // away from the attacker
    expect(s.world.has(far, Fleeing)).toBe(false);
    expect(s.world.has(ignoring, Engagement)).toBe(false);
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
});
