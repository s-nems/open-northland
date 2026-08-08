import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  PlayerOrder,
  Position,
  Stance,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, fx, Simulation } from '../../../src/index.js';
import { combatSystem, playerOrderSystem } from '../../../src/systems/index.js';
import { attackMoveUnit } from '../../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, fighterAt, grassMap, P0, P1, splitMap, VIKING, WOOD, WOODCUTTER } from './support.js';

/**
 * attack-move - the move order that keeps fighting. Its twin is move-order.cases.ts: the plain `moveUnit`
 * benches every auto-drive for the walk, this one deliberately does not, so the same setups must come out
 * the other way round.
 */

/** Order `entity` to fight its way to visual tile (x,y) - command coords are half-cell nodes. */
function orderAttackMove(sim: Simulation, entity: Entity, x: number, y: number): void {
  const n = cellAnchorNode(x, y);
  attackMoveUnit(sim.world, ctxOf(sim), { kind: 'attackMoveUnit', entity, x: n.hx, y: n.hy });
}

describe('attackMoveUnit - a march that fights everything on the way', () => {
  it('engages an enemy IN REACH mid-march (where a plain move order would walk straight past)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent to the march route

    orderAttackMove(sim, a, 9, 0);
    // The direct inverse of the "does not re-engage under a move order" case. It takes two more ticks to
    // land the first blow than a standing soldier: a swing needs a standstill (inReachAndStanding), so the
    // marcher brakes onto its contact cell first.
    sim.run(3);

    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
    expect(sim.world.has(a, PlayerOrder)).toBe(true); // and the march is still standing behind the fight
  });

  it('acquires while WALKING - the march does not have to stall first', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 4, 0, VIKING, WOODCUTTER, { owner: P1 }); // out of reach, inside sight

    orderAttackMove(sim, a, 11, 0);
    sim.step(); // a tick of the real schedule: the walk starts, then combat runs

    expect(sim.world.has(a, Engagement)).toBe(true); // it advanced on the enemy instead of walking by
  });

  it('resumes the march at the ordered spot once the fight is over', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P1 });
    const goal = sim.terrain?.nodeAtClamped(cellAnchorNode(11, 0).hx, cellAnchorNode(11, 0).hy);

    orderAttackMove(sim, a, 11, 0);
    sim.run(2); // engaged: combat owns the unit and the march waits the fight out
    expect(sim.world.has(a, Engagement)).toBe(true);

    sim.world.mut(enemy, Health).hitpoints = 0; // the enemy falls (cleanupSystem reaps it)
    sim.run(3);

    expect(sim.world.has(a, PlayerOrder)).toBe(true); // the order outlived the fight
    expect(sim.world.get(a, MoveGoal).cell).toBe(goal); // and aims at the spot it was sent to again
  });

  it('overrides a passive stance for the march - an IGNORE unit fights while it lasts, not after', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const scout = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(scout, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null }); // never auto-engages
    fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(scout, CurrentAtomic)).toBe(false); // IGNORE: it lets the adjacent enemy be

    orderAttackMove(sim, scout, 9, 0);
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(scout, Engagement)).toBe(true); // under the march it takes the fight

    sim.world.remove(scout, PlayerOrder); // the march ends (arrival)
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(scout, Engagement)).toBe(false); // its own IGNORE stance is back
  });

  it('releases the unit on arrival with nothing to fight - no post-arrival stand, like any move order', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });

    orderAttackMove(sim, a, 5, 0);
    sim.run(105); // 5 tiles at 18 ticks/tile plus the gait ramp

    expect(sim.world.get(a, Position).x).toBe(fx.fromInt(5)); // arrived at the ordered spot
    expect(sim.world.has(a, PlayerOrder)).toBe(false); // and was handed straight back to the economy
  });

  it('gives up a target it cannot reach and walks on (no standing at a river forever)', () => {
    // The enemy is inside sight but across an unswimmable column, so no cell an axe could strike it from is
    // one the marcher can stand on. Taken as a target anyway it would re-path at the water every tick and the
    // order could never complete.
    const sim = new Simulation({ seed: 1, content: testContent(), map: splitMap(14, 5, 6) });
    const a = fighterAt(sim, 2, 2, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 9, 2, VIKING, WOODCUTTER, { owner: P1 }); // unreachable, well inside SIGHT_RADIUS_NODES
    const goal = cellAnchorNode(4, 2); // on the marcher's own bank

    attackMoveUnit(sim.world, ctxOf(sim), { kind: 'attackMoveUnit', entity: a, x: goal.hx, y: goal.hy });
    sim.run(400);

    expect(sim.world.get(a, Position).x).toBe(fx.fromInt(4)); // it walked its march out
    expect(sim.world.has(a, PlayerOrder)).toBe(false); // and the order retired instead of hanging
  });

  it('keeps the march across the set-down when the settler was ordered with its hands full', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.add(a, Carrying, { goodType: WOOD, amount: 1 }); // it must drop this before walking
    fighterAt(sim, 4, 0, VIKING, WOODCUTTER, { owner: P1 });

    orderAttackMove(sim, a, 11, 0);
    // The drop parks the destination on `pendingGoal`; the rung that launches the parked walk must carry
    // the march over, or the order silently degrades to a plain move.
    sim.run(30);

    expect(sim.world.has(a, Carrying)).toBe(false); // the load is down
    expect(sim.world.has(a, Engagement)).toBe(true); // and it is still the aggressive flavour
  });

  it('is skipped for a NEUTRAL (unowned) settler - the moveUnit guards are unchanged', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const neutral = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // no owner

    orderAttackMove(sim, neutral, 5, 0);
    playerOrderSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(neutral, PlayerOrder)).toBe(false);
    expect(sim.world.has(neutral, MoveGoal)).toBe(false);
  });
});
