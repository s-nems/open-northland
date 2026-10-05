import { describe, expect, it } from 'vitest';
import { MoveGoal, Owner, PickupClaim } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { plannerSystem } from '../../src/systems/index.js';
import { collectSupplyTally } from '../../src/systems/stores/index.js';
import { HUMAN_PLAYER, orderMove } from '../conflict/orders/support.js';
import { testContent } from '../fixtures/content.js';
import { idleReplanTick } from '../fixtures/idle-replan.js';
import {
  buildingAt,
  CARRIER,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  PLANK,
  pileAt,
  SAWMILL,
  settlerAt,
  WOOD,
} from './producer-supply/support.js';

/**
 * A hauler walking to lift a unit claims it, so a hauler planned after it in the same pass picks another
 * source or nothing, and a claim given up frees the unit for the next pass.
 */

function claimOf(sim: Simulation, e: Entity): Entity | undefined {
  return sim.world.tryGet(e, PickupClaim)?.source;
}

/** One planner pass on `e`'s idle re-plan tick, so a settler that found nothing before re-plans now. */
function planDue(sim: Simulation, e: Entity): void {
  plannerSystem(sim.world, { ...ctxOf(sim), tick: idleReplanTick(e, sim.tick) });
}

describe('porters claiming loose ground piles', () => {
  it('a porter planned after another takes the far pile when the near one is claimed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 9, 0);
    const first = settlerAt(sim, 0, 0, CARRIER, hq);
    const second = settlerAt(sim, 1, 0, CARRIER, hq);
    const near = pileAt(sim, 3, 0, [[WOOD, 1]]);
    const far = pileAt(sim, 6, 0, [[WOOD, 1]]);

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, first)).toBe(near);
    expect(claimOf(sim, second)).toBe(far);
  });

  it('a released claim frees the pile for the porter that found nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 9, 0);
    const first = settlerAt(sim, 0, 0, CARRIER, hq);
    const second = settlerAt(sim, 1, 0, CARRIER, hq);
    const pile = pileAt(sim, 3, 0, [[WOOD, 1]]);
    plannerSystem(sim.world, ctxOf(sim));
    expect(claimOf(sim, first)).toBe(pile);
    expect(sim.world.has(second, PickupClaim)).toBe(false);

    collectSupplyTally(sim.world).releaseErrands(first);
    planDue(sim, second);

    expect(claimOf(sim, second)).toBe(pile);
  });

  it("a player's move order on the claimant frees the pile for the other porter", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 4) });
    const hq = buildingAt(sim, HEADQUARTERS, 9, 0);
    const first = settlerAt(sim, 0, 0, CARRIER, hq);
    const second = settlerAt(sim, 1, 0, CARRIER, hq);
    for (const e of [hq, first, second]) sim.world.add(e, Owner, { player: HUMAN_PLAYER });
    const pile = pileAt(sim, 6, 0, [[WOOD, 1]]);
    plannerSystem(sim.world, ctxOf(sim));
    sim.step();
    expect(claimOf(sim, first)).toBe(pile); // held while it walks

    orderMove(sim, first, 0, 3);
    sim.step();
    expect(sim.world.has(first, PickupClaim)).toBe(false);
    planDue(sim, second);

    expect(claimOf(sim, second)).toBe(pile);
  });
});

describe('store carriers claiming workshop output', () => {
  it('only one carrier walks for the single finished unit', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 9, 0);
    const first = settlerAt(sim, 0, 0, CARRIER, hq);
    const second = settlerAt(sim, 1, 0, CARRIER, hq);
    const mill = buildingAt(sim, SAWMILL, 4, 0, [[PLANK, 1]]);

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, first)).toBe(mill);
    expect(sim.world.has(first, MoveGoal)).toBe(true);
    expect(claimOf(sim, second)).toBeUndefined();
    expect(collectSupplyTally(sim.world).reservedAt(mill, PLANK)).toBe(1);
  });
});
