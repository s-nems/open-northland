import { describe, expect, it } from 'vitest';
import {
  Anger,
  Building,
  CurrentAtomic,
  diplomacyStance,
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  Position,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import { attackableBuildings } from '../../src/systems/conflict/dormancy.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { provokeHostility } from '../../src/systems/settlers/atomics/effects/combat/hit/reactions.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { BEAR, BOAR, COW, fighterAtNode, HUNTER } from './combat-system/support.js';
import { combatantAtNode, ctxOf, P0, P1, VIKING } from './stances/support.js';

/**
 * The combat index's coarse idle early-out (conflict/combat-index.ts) is perf-only: skipping the ring search
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

/**
 * The gate counts an owned member only for a player at war with the seeker in either direction, so on a map
 * of neighbours at peace a calm civilian skips its sight scan. A stance is read when `combat` builds its
 * index, after every writer that runs earlier in the tick.
 */
describe('combat presence gate - diplomacy', () => {
  const bigMap = () => grassCellMap(64, 64);
  /** The fixture headquarters type: a plain owned building with no footprint of its own. */
  const HEADQUARTERS = 1;
  const HQ_HP = 1000;

  function hqAtNode(sim: Simulation, hx: number, hy: number, owner: number): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(hx, hy));
    sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(e, Health, { hitpoints: HQ_HP, max: HQ_HP });
    sim.world.add(e, Owner, { player: owner });
    return e;
  }

  /** Whether `player`'s gate at node (40, 40) opens over `members` and every live building. */
  function gateOpens(sim: Simulation, members: readonly Entity[], player: number): boolean {
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const index = new CombatIndex(sim.world, ctxOf(sim), terrain, members, attackableBuildings(sim.world));
    return index.othersWithin(player, 40, 40, SIGHT_RADIUS_NODES);
  }

  /** P0's civilian at node (40, 40) with a P1 settler and a P1 building six nodes off, inside its sight box. */
  function neighbours(): { sim: Simulation; members: Entity[] } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const civ = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE);
    const settler = combatantAtNode(sim, 46, 40, P1, MILITARY_MODE.IGNORE);
    hqAtNode(sim, 40, 46, P1);
    return { sim, members: [civ, settler] };
  }

  function setPair(sim: Simulation, p0ToP1: string, p1ToP0: string): void {
    setDiplomacyStance(sim.world, P0, P1, p0ToP1);
    setDiplomacyStance(sim.world, P1, P0, p1ToP0);
  }

  for (const stance of ['neutral', 'friend'] as const) {
    it(`stays closed on a ${stance} neighbour's settlers and buildings in the box`, () => {
      const { sim, members } = neighbours();
      setPair(sim, stance, stance);
      expect(gateOpens(sim, members, P0)).toBe(false);
      expect(gateOpens(sim, members, P1)).toBe(false);
    });
  }

  it('opens on an enemy stance held in either direction', () => {
    const { sim, members } = neighbours();
    setPair(sim, 'enemy', 'neutral');
    expect([gateOpens(sim, members, P0), gateOpens(sim, members, P1)]).toEqual([true, true]);
    setPair(sim, 'neutral', 'enemy');
    expect([gateOpens(sim, members, P0), gateOpens(sim, members, P1)]).toEqual([true, true]);
  });

  it('still opens on a hostile animal beside neighbours at peace', () => {
    const { sim, members } = neighbours();
    setPair(sim, 'neutral', 'neutral');
    const bear = fighterAtNode(sim, 44, 44, BEAR, null);
    expect(gateOpens(sim, members, P0)).toBe(false);
    expect(gateOpens(sim, [...members, bear], P0)).toBe(true);
  });

  it('a civilian still flees a one-way aggressor it holds no grudge against', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const civ = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 46, 40, P1, MILITARY_MODE.IGNORE);
    setPair(sim, 'neutral', 'enemy');

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(civ, Fleeing)).toBe(true);
  });

  it('a civilian ignores a neutral neighbour in sight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const civ = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 46, 40, P1, MILITARY_MODE.IGNORE);
    setPair(sim, 'neutral', 'neutral');

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(civ, Fleeing)).toBe(false);
  });

  it('sees a stance a landed blow flipped earlier in the same tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const civ = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.FLEE);
    const raider = combatantAtNode(sim, 46, 40, P1, MILITARY_MODE.IGNORE);
    setPair(sim, 'neutral', 'neutral');
    const ctx = ctxOf(sim);

    // The atomic pass lands the raider's blow before combat runs: the victim's side turns enemy.
    provokeHostility(sim.world, ctx, raider, civ);
    expect(diplomacyStance(sim.world, P0, P1)).toBe('enemy');
    combatSystem(sim.world, ctx);

    expect(sim.world.has(civ, Fleeing)).toBe(true);
  });
});
