import { describe, expect, it } from 'vitest';
import { Anger, CurrentAtomic, Engagement, Fleeing, MoveGoal, Owner } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { BEAR, BOAR, COW, fighterAtNode, HUNTER } from './combat-system/support.js';
import { combatantAtNode, ctxOf, P0, P1 } from './stances/support.js';

/**
 * The HostilePresence idle early-out (conflict/presence.ts) is perf-only: skipping the ring search
 * must never skip a real target. These cases pin the conservative boundary - an enemy exactly at
 * the search radius, and one just across a coarse presence-cell border, must still be acquired,
 * while one past the radius stays unengaged (the gate may or may not fire there; behavior is what
 * is pinned).
 */
describe('combat presence gate - conservative boundaries', () => {
  const bigMap = () => grassCellMap(64, 64); // 128×128 half-cell nodes

  it('engages an enemy exactly at the sight radius', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 40 + SIGHT_RADIUS_NODES, 40, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true); // spotted at the boundary - chase started
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
    // only 3 apart - the box query must reach the neighbouring cell.
    const fighter = combatantAtNode(sim, 31, 40, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 34, 40, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true);
  });

  it('engages an unowned aggressive animal exactly at the sight radius (unowned counts as other)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    fighterAtNode(sim, 40 + SIGHT_RADIUS_NODES, 40, BEAR, null); // unowned wildlife - no Owner

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true);
  });

  it("an owned hunter leaves its own player's claimed livestock alone (property, not prey)", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    // Hunters default to IGNORE with the prey-predation exemption; test_spear band is [3, 17].
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const cow = fighterAtNode(sim, 46, 40, COW, null); // catchable prey 6 nodes off, in the band
    sim.world.add(cow, Owner, { player: P0 }); // claimed livestock: carries the hunter's own Owner

    combatSystem(sim.world, ctxOf(sim));

    // isHuntTarget stops at ANY Owner (predation stops at property), so the herd is safe from its keeper.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('an owned hunter leaves ENEMY-claimed livestock alone (predation stops at property)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const cow = fighterAtNode(sim, 46, 40, COW, null);
    sim.world.add(cow, Owner, { player: P1 }); // an enemy's claimed animal - soldiers' business, not his

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('a gated soldier still engages a PROVOKED getAngry animal (angry classifies hostile, never passive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    const boar = fighterAtNode(sim, 46, 40, BOAR, null); // passive-but-provokable, 6 nodes off
    sim.world.add(boar, Anger, { until: 100 }); // provoked: a live anger timer - a valid civ target

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(true); // the discount must not hide an angry animal
  });

  it('a gated soldier ignores passive-only wildlife (the discount holds - no wake, no target)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const fighter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    fighterAtNode(sim, 46, 40, COW, null); // catchable, fully passive - not a soldier's target

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(fighter, Engagement)).toBe(false);
    expect(sim.world.has(fighter, CurrentAtomic)).toBe(false);
  });

  it('an ATTACK-stance hunter still finds passive prey (hunters are ungated in every stance)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    // ATTACK routes the hunter through generalAccept, whose mayHunt arm admits the discounted cow -
    // the presence gate must not skip the scan (spec.player is null for a hunter in ANY stance).
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK, { jobType: HUNTER });
    const cow = fighterAtNode(sim, 46, 40, COW, null); // in the test_spear band [3, 17]

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('a FLEE-stance hunter still reacts to prey in sight (the flee gate shares the hunter exemption)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE, { jobType: HUNTER });
    fighterAtNode(sim, 46, 40, COW, null); // discounted by the grid; the fleer's accept admits it

    combatSystem(sim.world, ctxOf(sim));

    // The fleer's threat filter is isValidTarget from its own perspective, so prey reads as a threat
    // (a pre-existing quirk the exemption preserves) - the early-out must not swallow it.
    expect(sim.world.has(hunter, Fleeing)).toBe(true);
  });

  it('a civilian flees a threat exactly at the sight radius, and ignores one past it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const nearCiv = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 40 + SIGHT_RADIUS_NODES, 40, P1, MILITARY_MODE.IGNORE);
    const farCiv = combatantAtNode(sim, 40, 100, P0, MILITARY_MODE.FLEE);
    // farCiv's nearest threat is the same P1 unit, ~76 nodes away - far past its sight.

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(nearCiv, Fleeing)).toBe(true);
    expect(sim.world.has(farCiv, Fleeing)).toBe(false);
  });
});
