import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Engagement, Fleeing, MoveGoal, Owner } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { BEAR, COW, fighterAtNode, HUNTER } from './combat-system/support.js';
import { combatantAtNode, ctxOf, P0, P1 } from './stances/support.js';

/**
 * The HostilePresence idle early-out (conflict/presence.ts) is perf-only: skipping the ring search
 * must never skip a real target. These cases pin the conservative boundary — an enemy exactly at
 * the search radius, and one just across a coarse presence-cell border, must still be acquired,
 * while one past the radius stays unengaged (the gate may or may not fire there; behavior is what
 * is pinned).
 */
describe('combat presence gate — conservative boundaries', () => {
  const bigMap = () => grassCellMap(64, 64); // 128×128 half-cell nodes

  it('engages an enemy exactly at the sight radius', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 40 + SIGHT_RADIUS_NODES, 40, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true); // spotted at the boundary — chase started
    expect(sim.world.has(fighter, MoveGoal)).toBe(true);
  });

  it('does not engage an enemy one node past the sight radius', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 40 + SIGHT_RADIUS_NODES + 1, 40, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(false);
    expect(sim.world.has(fighter, MoveGoal)).toBe(false);
  });

  it('engages an in-sight enemy across a coarse presence-cell border', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    // Presence cells are 32 nodes wide: node 31 and node 34 sit in different coarse columns while
    // only 3 apart — the box query must reach the neighbouring cell.
    const fighter = combatantAtNode(sim, 31, 40, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 34, 40, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true);
  });

  it('engages an unowned aggressive animal exactly at the sight radius (unowned counts as other)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    fighterAtNode(sim, 40 + SIGHT_RADIUS_NODES, 40, BEAR, null); // unowned wildlife — no Owner

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true);
  });

  it('an owned hunter still hunts prey owned by its OWN player (the gate never covers hunters)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    // Hunters default to IGNORE with the prey-predation exemption; test_spear band is [3, 17].
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const cow = fighterAtNode(sim, 46, 40, COW, null); // catchable prey 6 nodes off, in the band
    sim.world.add(cow, Owner, { player: P0 }); // penned livestock: prey owned by the hunter's player

    combatSystem(sim.world, ctxOf(sim));

    // isHuntTarget is owner-blind, so same-player prey is valid — the presence gate must not skip it.
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('a civilian flees a threat exactly at the sight radius, and ignores one past it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const nearCiv = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 40 + SIGHT_RADIUS_NODES, 40, P1, MILITARY_MODE.IGNORE);
    const farCiv = combatantAtNode(sim, 40, 100, P0, MILITARY_MODE.FLEE);
    // farCiv's nearest threat is the same P1 unit, ~76 nodes away — far past its sight.

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(nearCiv, Fleeing)).toBe(true);
    expect(sim.world.has(farCiv, Fleeing)).toBe(false);
  });
});
