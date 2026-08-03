import { Anger, Settler } from '../../../../../../components/index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import type { SystemContext } from '../../../../../context.js';
import { angryGameTimeOf, isAggressiveAnimal, isProvokableAnimal } from '../../../../../readviews/index.js';

/**
 * Provoke a struck passive `getAngry` animal into temporary hostility - the provoked half of
 * `animaltypes.ini` aggression. Stamps an {@link Anger} deadline the `combatSystem` reads to make the
 * animal fight back until it lapses; a re-strike refreshes it, so harassment keeps the animal angry.
 */
export function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
  const settler = world.tryGet(target, Settler);
  if (settler === undefined) return;
  if (!isProvokableAnimal(ctx.content, settler.tribe)) return;
  // An always-aggressive animal needs no timer, and stamping one would leak a component `hostileAnimalNow`
  // never reaps: it short-circuits on `isAggressiveAnimal` before ever reading `Anger`.
  if (isAggressiveAnimal(ctx.content, settler.tribe)) return;
  const duration = angryGameTimeOf(ctx.content, settler.tribe);
  if (duration <= 0) return; // no readable duration - no lasting anger
  const until = ctx.tick + duration;
  const anger = world.tryGet(target, Anger);
  if (anger === undefined) world.add(target, Anger, { until });
  else anger.until = until;
}
