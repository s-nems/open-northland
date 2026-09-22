import { YoungAnimal } from '../../components/index.js';
import type { Entity } from '../../ecs/world.js';
import type { System } from '../context.js';

/** How long a bred animal stays young: the original promotes a `baby_animal` to `adult_animal` at age
 *  3600 game ticks, counted from its birth. */
export const ANIMAL_ADULT_AGE_TICKS = 3600;

/**
 * Grow up the farm-bred animals whose time has come, so the breeder's pair count sees them. Their
 * hitpoint pool stays the juvenile one it was born with: the original's growth-time health handling is
 * not readable (approximation).
 */
export const livestockGrowthSystem: System = (world, ctx) => {
  // Collected first: removing a component while iterating its own store is the one membership change to
  // keep out of the loop.
  const grown: Entity[] = [];
  for (const e of world.query(YoungAnimal)) {
    if (ctx.tick >= world.get(e, YoungAnimal).adultAt) grown.push(e);
  }
  for (const e of grown) world.remove(e, YoungAnimal);
};
