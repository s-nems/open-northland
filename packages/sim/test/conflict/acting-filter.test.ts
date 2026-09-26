import { describe, expect, it } from 'vitest';
import {
  Health,
  MoveGoal,
  Position,
  Settler,
  Stance,
  Stranded,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { mayEngage } from '../../src/systems/conflict/acting.js';
import { BattleFront } from '../../src/systems/conflict/battle-alert.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import { engageCombatant } from '../../src/systems/conflict/engage-combatant.js';
import { MeleeSlots } from '../../src/systems/conflict/melee-slots.js';
import type { CombatPass } from '../../src/systems/conflict/pass.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { BEAR, BOAR, COW, DEER, fighterAtNode, HUNTER } from './combat-system/support.js';
import { cell, combatantAtNode, ctxOf, grassMap, P0, P1 } from './stances/support.js';

const TICKS = 240;

/** Two warring villages that meet, a far quiet one, guards, a hunter and wildlife. */
function mixedScene(): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(64, 64) });
  setDiplomacyStance(sim.world, P0, P1, 'enemy');
  setDiplomacyStance(sim.world, P1, P0, 'enemy');
  for (let i = 0; i < 4; i++) {
    combatantAtNode(sim, 20 + 2 * i, 20, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 20 + 2 * i, 24, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 44 + 2 * i, 20, P1, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 44 + 2 * i, 26, P1, MILITARY_MODE.IGNORE);
    // Far from any enemy: the filter should skip this village until the fight comes near.
    combatantAtNode(sim, 20 + 2 * i, 100, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 20 + 2 * i, 104, P0, MILITARY_MODE.ATTACK);
  }
  combatantAtNode(sim, 30, 104, P0, MILITARY_MODE.DEFEND); // on its own anchor
  const offAnchor = combatantAtNode(sim, 34, 104, P0, MILITARY_MODE.DEFEND);
  sim.world.mut(offAnchor, Stance).anchorCell = cell(sim, 10, 25);
  // Calm and walking to work past the enemy line: the flee drive still looks around it.
  const walker = combatantAtNode(sim, 30, 40, P0, MILITARY_MODE.FLEE);
  sim.world.add(walker, MoveGoal, { cell: cell(sim, 30, 20) });
  const stranded = combatantAtNode(sim, 38, 104, P0, MILITARY_MODE.DEFEND);
  sim.world.add(stranded, Stranded, { retryAt: 0 });
  combatantAtNode(sim, 100, 100, P1, MILITARY_MODE.IGNORE, { jobType: HUNTER });
  fighterAtNode(sim, 106, 100, DEER, null);
  fighterAtNode(sim, 100, 40, BEAR, null);
  fighterAtNode(sim, 60, 100, COW, null);
  fighterAtNode(sim, 64, 100, BOAR, null);
  return sim;
}

/** Every combatant the filter skips this tick, run through the ladder on a freshly built pass. */
function skippedLeaveNoTrace(sim: Simulation): number {
  const ctx = ctxOf(sim);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the scene has a map');
  const combatants = sim.world.canonicalQuery(Settler, Health, Position);
  const pass: CombatPass = {
    index: new CombatIndex(sim.world, ctx, terrain, combatants),
    slots: new MeleeSlots(sim.world, ctx, terrain),
    front: new BattleFront(sim.world, ctx),
  };
  const skipped: Entity[] = combatants.filter((e) => !mayEngage(sim.world, ctx, terrain, pass.index, e));
  const before = sim.hashState();
  for (const e of skipped) engageCombatant(sim.world, ctx, terrain, pass, e);
  expect(sim.hashState()).toBe(before);
  return skipped.length;
}

describe('combat pass - who may engage', () => {
  it('skips only combatants the engage ladder would leave untouched', () => {
    const sim = mixedScene();
    let skipped = 0;
    for (let t = 0; t < TICKS; t++) {
      skipped += skippedLeaveNoTrace(sim);
      sim.step();
    }
    expect(skipped).toBeGreaterThan(TICKS); // the quiet village and the grazing herd are skipped
  });
});
