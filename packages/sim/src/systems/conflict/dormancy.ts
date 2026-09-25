import {
  Anger,
  AttackOrder,
  Building,
  Engagement,
  Fleeing,
  Health,
  Owner,
  Palisade,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAggressiveAnimal, isAnimalTribe, isHuntablePrey, isHunterJob } from '../readviews/index.js';

/**
 * The dormancy gate: whether any combat work is possible this tick, in one cheap pass over the combatants.
 * Conservative - it may pass on a tick where the two hostile sides are out of range, but it never skips a
 * tick where a fight or a cleanup is due.
 */
export function combatPossible(world: World, ctx: SystemContext, combatants: Iterable<Entity>): boolean {
  const owners = new Set<number>();
  const civTribes = new Set<number>();
  let hasCiv = false;
  let hasHostileAnimal = false;
  let hasHunter = false;
  let hasPrey = false;
  for (const e of combatants) {
    // Lingering combat state must be resolved even with no live enemy left, so its presence alone keeps the
    // system awake this tick.
    if (world.has(e, Engagement) || world.has(e, AttackOrder) || world.has(e, Anger) || world.has(e, Fleeing))
      return true;
    const s = world.get(e, Settler);
    const owner = world.tryGet(e, Owner);
    if (owner !== undefined) owners.add(owner.player);
    if (isAnimalTribe(ctx.content, s.tribe)) {
      if (isAggressiveAnimal(ctx.content, s.tribe)) hasHostileAnimal = true;
      if (isHuntablePrey(ctx.content, s.tribe)) hasPrey = true;
    } else {
      hasCiv = true;
      civTribes.add(s.tribe);
      if (isHunterJob(ctx.content, s.jobType)) hasHunter = true;
    }
  }
  if (owners.size >= 2) return true; // two players → possible pvp
  if (civTribes.size >= 2) return true; // two civilizations → civ-vs-civ (unowned scenarios)
  if (hasHostileAnimal && hasCiv) return true; // an aggressive animal near a civilization
  if (hasHunter && hasPrey) return true; // a hunter and huntable prey
  // A warrior sieging an enemy building is a fight even with no enemy UNIT present: an owned unit plus an
  // attackable building of a different player wakes the system. Reached only when no unit-vs-unit / animal
  // trigger fired above, and skipped entirely when no owned unit exists (buildings ≪ units - a cheap tail).
  if (owners.size >= 1) {
    for (const b of [
      ...world.query(Building, Health, Position),
      ...world.query(Palisade, Health, Position),
    ]) {
      const owner = world.tryGet(b, Owner);
      if (owner === undefined || world.get(b, Health).hitpoints <= 0) continue;
      for (const u of owners) if (u !== owner.player) return true;
    }
  }
  return false;
}
