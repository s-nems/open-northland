import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  PlayerOrder,
  Position,
} from '../../../src/components/index.js';
import { cellAnchorNode, fx, Simulation } from '../../../src/index.js';
import { combatSystem } from '../../../src/systems/index.js';
import { attackUnit, moveUnit } from '../../../src/systems/orders/index.js';
import { testContent } from '../../fixtures/content.js';
import { clearComponentStores } from '../../fixtures/stores.js';
import { ctxOf, fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './support.js';

beforeEach(clearComponentStores);

describe('a player order is authoritative — it overrides the autonomous drives (economy AND auto-combat)', () => {
  it('moveUnit drops a soldier’s Engagement/AttackOrder so the order supersedes the fight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P1 }); // beyond reach, inside sight → a engages (chases)

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(a, Engagement)).toBe(true); // it is fighting (advancing on the enemy)

    // The player orders it to walk AWAY (the far cell's anchor node — command coords are half-cell
    // nodes) — the order clears the combat state and stamps the move + hold.
    const away = cellAnchorNode(9, 0);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: a, x: away.hx, y: away.hy });
    expect(sim.world.has(a, Engagement)).toBe(false); // the fight is dropped
    expect(sim.world.has(a, AttackOrder)).toBe(false);
    expect(sim.world.has(a, PlayerOrder)).toBe(true); // now under the move order
    expect(sim.world.get(a, MoveGoal).cell).toBe(sim.terrain?.nodeAtClamped(away.hx, away.hy));
  });

  it('the CombatSystem does not re-engage a unit under a move order, even with an enemy IN REACH', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent — would auto-attack without the order

    const away = cellAnchorNode(9, 0); // command coords are half-cell nodes
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: a, x: away.hx, y: away.hy });
    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, CurrentAtomic)).toBe(false); // no swing — the order wins over the adjacent enemy
    expect(sim.world.has(a, Engagement)).toBe(false); // and it is not dragged back into engagement
    expect(sim.world.has(a, PlayerOrder)).toBe(true); // still carrying the order out
    expect(sim.world.has(a, MoveGoal)).toBe(true);
  });

  it('an explicit attackUnit order still engages — the OPPOSITE intent is honoured, not suppressed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    const target = fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 });

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: a, target });
    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, PlayerOrder)).toBe(false); // attackUnit clears a move order — the two are exclusive
    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target });
  });

  it('full step run: an ordered soldier walks toward its goal and never swings at the enemy it left', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 6, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 7, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent to the right
    const enemyHp0 = sim.world.get(enemy, Health).hitpoints;

    sim.enqueue({ kind: 'moveUnit', entity: a, x: 0, y: 0 }); // ordered LEFT, away from the enemy
    for (let i = 0; i < 40; i++) sim.step();

    // It obeyed: advanced toward x=0 (away from the enemy at x=7) and never damaged the enemy.
    expect(fx.toInt(sim.world.get(a, Position).x)).toBeLessThan(6);
    expect(sim.world.get(enemy, Health).hitpoints).toBe(enemyHp0); // `a` never swung at it
  });
});
