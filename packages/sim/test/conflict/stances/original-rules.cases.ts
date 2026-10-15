import { describe, expect, it } from 'vitest';
import { Engagement, MoveGoal, Stance, Weapon } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { combatSystem, DEFEND_LEASH_NODES, DEFEND_RADIUS_NODES } from '../../../src/systems/index.js';
import { moveUnit } from '../../../src/systems/orders/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { cell, combatantAtNode, ctxOf, grassMap, P0, P1, tileOf } from './support.js';

const SOLDIER = 31; // soldier_unarmed
const TEST_AXE = 7; // the fixture's viking weapon, reach band [1, 2]
const ANCHOR_NODE = 20;

/** An armed P0 soldier on row node `hx` under `mode`, guarding row node `anchorNode`. */
function soldierAtNode(sim: Simulation, hx: number, mode: MilitaryMode, anchorNode = hx): Entity {
  const e = combatantAtNode(sim, hx, 0, P0, mode, { jobType: SOLDIER, hitpoints: 100000 });
  sim.world.add(e, Weapon, { weaponTypeId: TEST_AXE });
  sim.world.mut(e, Stance).anchorCell = sim.terrain?.nodeAtClamped(anchorNode, 0) ?? null;
  return e;
}

function enemyAtNode(sim: Simulation, hx: number): Entity {
  return combatantAtNode(sim, hx, 0, P1, MILITARY_MODE.IGNORE, { hitpoints: 100000 });
}

function heldTarget(sim: Simulation, e: Entity): Entity | undefined {
  return sim.world.tryGet(e, Engagement)?.target;
}

describe('the original stance rules for an idle fighter', () => {
  it('DEFEND engages an enemy exactly the search radius from its guard point', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = soldierAtNode(sim, ANCHOR_NODE, MILITARY_MODE.DEFEND);
    enemyAtNode(sim, ANCHOR_NODE + DEFEND_RADIUS_NODES);
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, Engagement)).toBe(true);
  });

  it('DEFEND keeps a held enemy at the leash and lets it go one point past it, walking back', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const kept = soldierAtNode(sim, ANCHOR_NODE + DEFEND_LEASH_NODES - 2, MILITARY_MODE.DEFEND, ANCHOR_NODE);
    const held = enemyAtNode(sim, ANCHOR_NODE + DEFEND_LEASH_NODES);
    sim.world.add(kept, Engagement, { repathAt: 0, target: held });
    combatSystem(sim.world, ctxOf(sim));
    expect(heldTarget(sim, kept)).toBe(held);

    const sim2 = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = soldierAtNode(
      sim2,
      ANCHOR_NODE + DEFEND_LEASH_NODES - 1,
      MILITARY_MODE.DEFEND,
      ANCHOR_NODE,
    );
    const fled = enemyAtNode(sim2, ANCHOR_NODE + DEFEND_LEASH_NODES + 1);
    sim2.world.add(guard, Engagement, { repathAt: 0, target: fled });
    combatSystem(sim2.world, ctxOf(sim2));
    expect(heldTarget(sim2, guard)).not.toBe(fled);
    expect(sim2.world.get(guard, MoveGoal).cell).toBe(sim2.terrain?.nodeAtClamped(ANCHOR_NODE, 0));
  });

  it('ATTACK never gives a held enemy up, however far it stands from the guard point', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const far = ANCHOR_NODE + DEFEND_LEASH_NODES + DEFEND_RADIUS_NODES;
    const soldier = soldierAtNode(sim, far - 2, MILITARY_MODE.ATTACK, ANCHOR_NODE);
    const enemy = enemyAtNode(sim, far);
    sim.world.add(soldier, Engagement, { repathAt: 0, target: enemy });
    combatSystem(sim.world, ctxOf(sim));
    expect(heldTarget(sim, soldier)).toBe(enemy);
  });

  it('IGNORE strikes an enemy inside weapon reach and leaves one a step beyond it alone', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const near = soldierAtNode(sim, 10, MILITARY_MODE.IGNORE);
    enemyAtNode(sim, 12);
    const apart = soldierAtNode(sim, 50, MILITARY_MODE.IGNORE);
    enemyAtNode(sim, 53);
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(near, Engagement)).toBe(true);
    expect(sim.world.has(apart, Engagement)).toBe(false);
    expect(sim.world.has(apart, MoveGoal)).toBe(false);
  });

  it('a completed move order makes its end point the guard point DEFEND searches around', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = soldierAtNode(sim, 4, MILITARY_MODE.DEFEND);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: guard, x: 60, y: 0 });
    sim.run(1200);
    expect(tileOf(sim, guard).x).toBe(30);
    expect(sim.world.get(guard, Stance).anchorCell).toBe(cell(sim, 30, 0));
    // 16 points from the new guard point, 72 from the old one.
    enemyAtNode(sim, 60 + 16);
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, Engagement)).toBe(true);
  });
});
