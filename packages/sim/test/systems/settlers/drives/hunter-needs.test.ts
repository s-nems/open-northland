import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  BerryBush,
  CurrentAtomic,
  DeliveryFlag,
  Engagement,
  Position,
  StayPoint,
  WorkFlag,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../../../src/index.js';
import { HUNT_PREY_SCORE_CEILING } from '../../../../src/systems/conflict/hunting/spec.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { combatContent } from '../../../fixtures/content/combat.js';
import { economyContent } from '../../../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../../../fixtures/content/index.js';
import { societyContent } from '../../../fixtures/content/societies.js';
import { justAbove, NEED_DRIVE_THRESHOLD } from '../../../fixtures/needs.js';
import { setNeeds } from '../../../fixtures/settler.js';
import { grassCellMap } from '../../../fixtures/terrain.js';
import { COW, fighterAtNode, HUNTER } from '../../conflict/combat-system/support.js';
import { combatantAtNode, P0 } from '../../conflict/stances/support.js';

/**
 * A hunter's chase is an economy errand, so a pressing need breaks it off: the hunter walks to food
 * between shots instead of loosing arrow after arrow while it starves, then goes back to hunting.
 */

const EAT_ATOMIC = 10;
/** Enough to outlast the meal, yet under the pick's score ceiling: the hunt is still on when the hunter
 *  comes back. */
const TOUGH_HITPOINTS = HUNT_PREY_SCORE_CEILING - 1_000;

/** Map points from the hunter's flag to past every corner of the 64x64-cell test map: a struck cow runs
 *  20 points from each blow, and the hunt under test must not end at the ground's edge. */
const MAP_WIDE_GROUND_RADIUS = 128;

/** The test content with the fixture spear made a ranged weapon, so the hunter shoots from its band. */
function huntContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...societyContent,
    ...combatContent,
    weapons: combatContent.weapons.map((w) =>
      w.id === 'test_spear' ? { ...w, munitionType: 1, speed: 8 } : w,
    ),
  });
}

/** A hunter posted on its own node, with a flag-bound hunting ground spanning the map. */
function postedHunter(sim: Simulation, hx: number, hy: number): Entity {
  const e = combatantAtNode(sim, hx, hy, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
  const flag = sim.world.create();
  sim.world.add(flag, Position, positionOfNode(hx, hy));
  sim.world.add(flag, DeliveryFlag, {});
  sim.world.add(e, WorkFlag, { flag, radius: MAP_WIDE_GROUND_RADIUS });
  return e;
}

describe('hunter - a pressing need breaks off the hunt', () => {
  it('walks off to eat between shots, then goes back to hunting', () => {
    const sim = new Simulation({ seed: 3, content: huntContent(), map: grassCellMap(64, 64) });
    const hunter = postedHunter(sim, 40, 40);
    const cow = fighterAtNode(sim, 50, 40, COW, null, TOUGH_HITPOINTS);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    sim.world.add(cow, StayPoint, { cell: entityNode(sim.world, terrain, cow) });
    const bush = sim.world.create();
    sim.world.add(bush, Position, { x: fx.fromInt(16), y: fx.fromInt(20) });
    sim.world.add(bush, BerryBush, { stage: 'ripe' });

    let guard = 200;
    while (!sim.world.has(hunter, Engagement) && guard-- > 0) sim.step();
    expect(sim.world.has(hunter, Engagement)).toBe(true); // drawn on the cow
    setNeeds(sim, hunter, { hunger: justAbove(NEED_DRIVE_THRESHOLD) });

    let ate = false;
    for (let i = 0; i < 400 && !ate; i++) {
      sim.step();
      ate = sim.world.tryGet(hunter, CurrentAtomic)?.atomicId === EAT_ATOMIC;
    }
    expect(ate).toBe(true);

    guard = 400;
    while (!sim.world.has(hunter, Engagement) && guard-- > 0) sim.step();
    expect(sim.world.has(hunter, Engagement)).toBe(true); // back on the hunt once fed
  });

  it('keeps hunting while hungry when there is no food to walk to', () => {
    const sim = new Simulation({ seed: 3, content: huntContent(), map: grassCellMap(64, 64) });
    const hunter = postedHunter(sim, 40, 40);
    const cow = fighterAtNode(sim, 50, 40, COW, null);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    sim.world.add(cow, StayPoint, { cell: entityNode(sim.world, terrain, cow) });
    setNeeds(sim, hunter, { hunger: justAbove(NEED_DRIVE_THRESHOLD) });

    // Each blow sends the cow 20 points off, so the hunter shoots, chases and shoots again.
    let guard = 2400;
    while (sim.world.isAlive(cow) && guard-- > 0) sim.step();
    expect(sim.world.isAlive(cow)).toBe(false); // the meat it hunts is the food it lacks
  });
});
