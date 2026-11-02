import {
  Anger,
  AttackOrder,
  Building,
  Engagement,
  Fleeing,
  Health,
  Owner,
  Position,
  Settler,
  Vehicle,
} from '../../components/index.js';
import type { Component, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAggressiveAnimal, isAnimalTribe, isHuntablePrey, isHunterJob } from '../readviews/index.js';
import { isCombatant } from './combat-grid.js';

/** The combat state that must be resolved even with no live enemy left, so a combatant holding any keeps
 *  the system awake. */
const LINGERING_STATE: readonly Component<unknown>[] = [Engagement, AttackOrder, Anger, Fleeing];

/**
 * The dormancy gate: whether any combat work is possible this tick, in one cheap pass over the combatants.
 * Conservative - it may pass on a tick where the two hostile sides are out of range, but it never skips a
 * tick where a fight or a cleanup is due.
 */
export function combatPossible(world: World, ctx: SystemContext): boolean {
  if (lingeringStateHeld(world)) return true;
  // The walk is order-independent; it reads the kept canonical list, which hands out no iterator result
  // per combatant as the raw query's store iterator does.
  const combatants = world.canonicalQuery(Settler, Health, Position);
  const owners = new Set<number>();
  const civTribes = new Set<number>();
  let hasCiv = false;
  let hasHostileAnimal = false;
  let hasClaimedAnimal = false;
  let hasHunter = false;
  let hasPrey = false;
  for (const e of combatants) {
    const s = world.get(e, Settler);
    const owner = world.tryGet(e, Owner);
    if (owner !== undefined) owners.add(owner.player);
    if (isAnimalTribe(ctx.content, s.tribe)) {
      if (isAggressiveAnimal(ctx.content, s.tribe)) hasHostileAnimal = true;
      if (owner !== undefined) hasClaimedAnimal = true;
      if (isHuntablePrey(ctx.content, s.tribe)) hasPrey = true;
    } else {
      hasCiv = true;
      civTribes.add(s.tribe);
      if (isHunterJob(ctx.content, s.jobType)) hasHunter = true;
    }
    // The answer is fixed the moment one of these holds, so the walk stops there.
    if (owners.size >= 2) return true; // two players → possible pvp
    if (civTribes.size >= 2) return true; // two civilizations → civ-vs-civ (unowned scenarios)
    if (hasHostileAnimal && hasCiv) return true; // an aggressive animal near a civilization
    if (hasHostileAnimal && hasClaimedAnimal) return true; // a wild animal may strike claimed livestock
    if (hasHunter && hasPrey) return true; // a hunter and huntable prey
  }
  // A vehicle with a standing attack or a clip to play out fights on its own, a marching one resumes
  // its march from the combat pass, and an owned one is a body another owner's unit may batter: its owner joins the set
  // the building tail below reads.
  for (const v of world.query(Vehicle, Health, Position)) {
    const state = world.get(v, Vehicle);
    if (state.attack !== null || state.attackClipStart !== null || state.march !== null) return true;
    const owner = world.tryGet(v, Owner);
    if (owner !== undefined && world.get(v, Health).hitpoints > 0) owners.add(owner.player);
  }
  if (owners.size >= 2) return true; // a vehicle and a unit of two players, or two players' vehicles
  // A warrior sieging an enemy building is a fight even with no enemy UNIT present: an owned unit plus an
  // attackable building of a different player wakes the system. Reached only when no unit-vs-unit / animal
  // trigger fired above, and skipped entirely when no owned unit exists (buildings ≪ units - a cheap tail).
  if (owners.size >= 1) {
    for (const b of world.query(Building, Health, Position)) {
      const owner = world.tryGet(b, Owner);
      if (owner === undefined || world.get(b, Health).hitpoints <= 0) continue;
      for (const u of owners) if (u !== owner.player) return true;
    }
  }
  return false;
}

/** Whether a combatant holds {@link LINGERING_STATE}, asked of the holders: a fight's few rather than every
 *  combatant. */
function lingeringStateHeld(world: World): boolean {
  for (const store of LINGERING_STATE) {
    for (const e of world.query(store)) if (isCombatant(world, e)) return true;
  }
  return false;
}
