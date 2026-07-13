import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
} from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { combatSystem } from '../../../src/systems/index.js';
import { attackUnit, setStance } from '../../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { combatant, combatantAtNode, ctxOf, grassMap, P0, P1 } from './support.js';

describe('IGNORE — never auto-engage, but an explicit order still fights', () => {
  it('an IGNORE unit does NOT swing at an adjacent enemy', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const scout = combatant(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    combatant(sim, 1, 0, P1, MILITARY_MODE.ATTACK); // enemy adjacent, in reach
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(scout, CurrentAtomic)).toBe(false); // it ignored the enemy
    expect(sim.world.has(scout, Engagement)).toBe(false);
  });

  it('an explicit attackUnit order overrides the IGNORE stance (order-over-stance)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const scout = combatant(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    const enemy = combatant(sim, 1, 0, P1, MILITARY_MODE.ATTACK);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: scout, target: enemy });
    combatSystem(sim.world, ctxOf(sim));
    // The order makes the IGNORE unit strike the ordered target.
    expect(sim.world.get(scout, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
  });

  it('when the ordered target dies, an IGNORE unit reverts to ignoring — it does NOT auto-engage a bystander', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const scout = combatant(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    const focus = combatant(sim, 1, 0, P1, MILITARY_MODE.IGNORE); // the ordered target (2 nodes away)
    combatantAtNode(sim, 1, 0, P1, MILITARY_MODE.IGNORE); // a bystander enemy 1 node away, in reach, the scout must NOT hit
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: scout, target: focus });
    sim.world.get(focus, Health).hitpoints = 0; // the ordered target dies

    combatSystem(sim.world, ctxOf(sim));
    // The stale order is dropped and the IGNORE stance re-decides THIS tick — no swing at the bystander.
    expect(sim.world.has(scout, AttackOrder)).toBe(false);
    expect(sim.world.has(scout, CurrentAtomic)).toBe(false);
    expect(sim.world.has(scout, Engagement)).toBe(false);
  });
});

describe('stance change mid-chase', () => {
  it('switching ATTACK → IGNORE stops a chase (drops Engagement + the chase route)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const chaser = combatant(sim, 0, 0, P0, MILITARY_MODE.ATTACK);
    combatant(sim, 6, 0, P1, MILITARY_MODE.IGNORE); // 12 nodes — spotted (sight 16) but beyond reach (2) → chase

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(chaser, Engagement)).toBe(true); // it is chasing
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);

    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: chaser, mode: MILITARY_MODE.IGNORE });
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(chaser, Engagement)).toBe(false); // IGNORE disengages
    expect(sim.world.has(chaser, MoveGoal)).toBe(false);
  });

  it('switching ATTACK → FLEE mid-chase sheds the stale Engagement (no permanent bench)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const unit = combatant(sim, 10, 0, P0, MILITARY_MODE.ATTACK);
    const enemy = combatant(sim, 16, 0, P1, MILITARY_MODE.IGNORE); // 12 nodes — spotted, beyond reach → chase

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(unit, Engagement)).toBe(true); // chasing

    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: unit, mode: MILITARY_MODE.FLEE });
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(unit, Engagement)).toBe(false); // the attack Engagement is shed on entering flee
    expect(sim.world.has(unit, Fleeing)).toBe(true); // now fleeing the same enemy

    // Threat gone: after the cool-down the unit fully disengages — crucially NO Engagement is left stuck
    // (the bug this guards: a leaked Engagement benches the unit forever and keeps combat awake).
    sim.world.destroy(enemy);
    sim.run(60);
    expect(sim.world.has(unit, Engagement)).toBe(false);
    expect(sim.world.has(unit, Fleeing)).toBe(false);
  });
});
