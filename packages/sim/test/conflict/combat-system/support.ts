import { beforeEach } from 'vitest';
import { Health } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, positionOfNode, type Simulation } from '../../../src/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { clearComponentStores } from '../../fixtures/stores.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { ctxOf, grassMap };

/**
 * Unit + integration tests for the CombatSystem — the TARGETING half of the combat loop: an idle
 * Health-bearing combatant swings at the nearest enemy-tribe combatant within weapon range, issuing
 * the `attack` atomic with the `combatDamage`-resolved net damage. The fixture's `test_axe` (tribe 1,
 * job 1) has maxRange 2 and damage 50 vs an unarmored (class 0) target, bound to the `viking_attack`
 * animation (length 4). Together with the AtomicSystem `attack` effect (the hit) and the CleanupSystem
 * (the death) it closes the targeting->attack->hit->death loop.
 */

export const VIKING = 1; // tribe 1 in the fixture (has test_axe for job 1)
export const FRANK = 2; // a different tribe with NO record in the fixture — still a valid enemy (not an animal)
export const WOLVES = 9; // a recorded ANIMAL tribe in the fixture (no jobEnables; test_claw for job 1) — PASSIVE (no animaltypes record)
export const BEAR = 10; // an AGGRESSIVE animal tribe (animaltypes record: aggressive, hitpointsAdult 15000; test_bearfist for job 1)
export const BEES = 11; // a cannotBeAttacked animal tribe (decorative fauna — a civ is exempt from attacking it)
export const BOAR = 12; // a PASSIVE-but-PROVOKABLE animal tribe (getAngry, NOT aggressive; angryGameTime 10; test_tusk)
export const COW = 13; // a CATCHABLE prey animal tribe (catchable, fully passive — not aggressive, not getAngry)
export const DEER = 14; // a CATCHABLE-and-PROVOKABLE prey animal tribe (catchable + getAngry; angryGameTime 10; test_antler)
export const WOODCUTTER = 1; // job 1 — the test_axe binds to this (tribe 1, job 1)
export const HUNTER = 15; // job 15 (JOB_TYPE_HUMAN_HUNTER) — the test_spear binds to this (tribe 1, job 15)
export const ATTACK_ATOMIC = 81;

beforeEach(clearComponentStores);

/** A combatant: a settler with a Health pool at visual cell (x,y). `tribe`/`jobType` decide its weapon. */
export function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  hitpoints = 1000,
): Entity {
  return fighterAtPosition(sim, { x: fx.fromInt(x), y: fx.fromInt(y) }, tribe, jobType, hitpoints);
}

/** A combatant standing exactly on half-cell node (hx, hy) — reach geometry a whole cell (2 nodes on a
 *  row) cannot express, e.g. an ODD node distance from a cell-anchored fighter. */
export function fighterAtNode(
  sim: Simulation,
  hx: number,
  hy: number,
  tribe: number,
  jobType: number | null,
  hitpoints = 1000,
): Entity {
  return fighterAtPosition(sim, positionOfNode(hx, hy), tribe, jobType, hitpoints);
}

export function fighterAtPosition(
  sim: Simulation,
  position: { x: Fixed; y: Fixed },
  tribe: number,
  jobType: number | null,
  hitpoints: number,
): Entity {
  const e = settlerAt(sim, { jobType, tribe, position });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}
