import { describe, expect, it } from 'vitest';
import {
  Health,
  MoveGoal,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Stranded,
  setDiplomacyStance,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation } from '../../src/index.js';
import { mayEngage } from '../../src/systems/conflict/acting.js';
import { BattleFront } from '../../src/systems/conflict/battle-alert.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import { engageCandidates } from '../../src/systems/conflict/engage-candidates.js';
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
    index: new CombatIndex(sim.world, ctx, terrain),
    slots: new MeleeSlots(sim.world, ctx, terrain),
    front: new BattleFront(sim.world, ctx),
    stance: { owned: false, ordered: false, mode: null, post: null },
  };
  const skipped: Entity[] = combatants.filter((e) => !mayEngage(sim.world, ctx, terrain, pass.index, e));
  const before = sim.hashState();
  for (const e of skipped) engageCombatant(sim.world, ctx, terrain, pass, e);
  expect(sim.hashState()).toBe(before);
  return skipped.length;
}

/** Every combatant left out of this tick's candidates, each refused by the filter on a freshly built pass. */
function outsideCandidatesRefused(sim: Simulation): number {
  const ctx = ctxOf(sim);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the scene has a map');
  const index = new CombatIndex(sim.world, ctx, terrain);
  const candidates = new Set(engageCandidates(sim.world, ctx, index));
  let outside = 0;
  for (const e of sim.world.canonicalQuery(Settler, Health, Position)) {
    if (candidates.has(e)) continue;
    outside++;
    expect(mayEngage(sim.world, ctx, terrain, index, e)).toBe(false);
  }
  return outside;
}

/** Three quiet villagers far from the fight, whose readiness the run flips in place halfway through. */
function quietRecruits(sim: Simulation): () => void {
  const recruit = combatantAtNode(sim, 40, 110, P0, MILITARY_MODE.FLEE);
  const guard = combatantAtNode(sim, 44, 110, P0, MILITARY_MODE.DEFEND);
  const marcher = combatantAtNode(sim, 48, 110, P0, MILITARY_MODE.ATTACK);
  // A plain move order benches it; its long walk keeps the order alive until the attack-move is written.
  sim.world.add(marcher, PlayerOrder, {});
  sim.world.add(marcher, MoveGoal, { cell: cell(sim, 60, 10) });
  return () => {
    setSettlerJob(sim.world, recruit, HUNTER);
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 10, 25);
    sim.world.mut(marcher, PlayerOrder).attackMove = {
      goal: cell(sim, 20, 50),
      resume: false,
      blockedUntil: 0,
    };
  };
}

describe('combat pass - who may engage', () => {
  it('draws every combatant the filter lets act among the candidates, and leaves the quiet ones out', () => {
    const sim = mixedScene();
    const stir = quietRecruits(sim);
    let outside = 0;
    for (let t = 0; t < TICKS; t++) {
      if (t === TICKS / 2) stir();
      outside += outsideCandidatesRefused(sim);
      sim.step();
      expect(sim.world.verifyCaches()).toEqual([]);
    }
    expect(outside).toBeGreaterThan(TICKS); // the quiet village and the grazing herd are never drawn
  });

  it('the verifiers flag a readiness or a position written around the tracked seams', () => {
    const sim = mixedScene();
    const guard = combatantAtNode(sim, 44, 110, P0, MILITARY_MODE.DEFEND);
    outsideCandidatesRefused(sim);
    expect(sim.world.verifyCaches()).toEqual([]);
    // Defeating the readonly views is the bug the verifiers exist to catch: no feed entry.
    (sim.world.get(guard, Stance) as { anchorCell: number | null }).anchorCell = cell(sim, 10, 25);
    (sim.world.get(guard, Position) as { x: number }).x = sim.world.get(guard, Position).x + 20 * ONE;
    const reports = sim.world.verifyCaches().join('\n');
    expect(reports).toContain('combatReadyUnits');
    expect(reports).toContain('combatUnitLayer');
  });

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
