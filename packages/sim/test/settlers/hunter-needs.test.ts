import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  BerryBush,
  CurrentAtomic,
  DeliveryFlag,
  Engagement,
  Position,
  Settler,
  StayPoint,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { COW, fighterAtNode, HUNTER } from '../conflict/combat-system/support.js';
import { combatantAtNode, P0 } from '../conflict/stances/support.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../fixtures/content/index.js';
import { societyContent } from '../fixtures/content/societies.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { justAbove, NEED_DRIVE_THRESHOLD } from './needs/support.js';

/**
 * A hunter's chase is an economy errand, so a pressing need breaks it off: the hunter walks to food
 * between shots instead of loosing arrow after arrow while it starves, then goes back to hunting.
 */

const EAT_ATOMIC = 10;
/** Enough to outlast the meal: the hunt is still on when the hunter comes back. */
const TOUGH_HITPOINTS = 20_000;

/** The test content with the fixture spear made a ranged weapon, so the hunter shoots from its band, and
 *  the cow given a territory, so a struck one keeps to the hunting ground. */
function huntContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...societyContent,
    ...combatContent,
    weapons: combatContent.weapons.map((w) =>
      w.id === 'test_spear' ? { ...w, munitionType: 1, speed: 8 } : w,
    ),
    animals: societyContent.animals.map((a) =>
      a.tribeType === COW ? { ...a, maximumDistanceToStayPoint: 6 } : a,
    ),
  });
}

/** A hunter posted on its own node, with a flag-bound hunting ground. */
function postedHunter(sim: Simulation, hx: number, hy: number): Entity {
  const e = combatantAtNode(sim, hx, hy, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
  const flag = sim.world.create();
  sim.world.add(flag, Position, positionOfNode(hx, hy));
  sim.world.add(flag, DeliveryFlag, {});
  sim.world.add(e, WorkFlag, { flag, radius: 24 });
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
    sim.world.add(bush, BerryBush, { stage: 'ripe', nextStageAtTick: 0 });

    let guard = 200;
    while (!sim.world.has(hunter, Engagement) && guard-- > 0) sim.step();
    expect(sim.world.has(hunter, Engagement)).toBe(true); // drawn on the cow
    sim.world.mut(hunter, Settler).hunger = justAbove(NEED_DRIVE_THRESHOLD);

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
    sim.world.mut(hunter, Settler).hunger = justAbove(NEED_DRIVE_THRESHOLD);

    let guard = 1200;
    while (sim.world.isAlive(cow) && guard-- > 0) sim.step();
    expect(sim.world.isAlive(cow)).toBe(false); // the meat it hunts is the food it lacks
  });
});
