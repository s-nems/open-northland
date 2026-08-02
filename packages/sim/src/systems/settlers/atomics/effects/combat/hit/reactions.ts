import { Anger, Settler } from '../../../../../../components/index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import type { SystemContext } from '../../../../../context.js';
import { angryGameTimeOf, isAggressiveAnimal, isProvokableAnimal } from '../../../../../readviews/index.js';

/**
 * Provoke a struck **passive but `getAngry`** animal into temporary hostility - the provoked half of
 * `animaltypes.ini` aggression. If `target` is a {@link Settler} of a {@link isProvokableAnimal}
 * tribe, stamp/refresh an {@link Anger}`{until: tick + angryGameTime}` on it (`combatSystem` reads
 * the timer to make it fight back until it lapses). A re-strike before the timer expires **refreshes**
 * `until` (the latest provocation extends hostility, the original's "kept angry while harassed"
 * reading). No-ops for a non-`Settler` target, a non-animal/non-provokable tribe (a civilization, an
 * already-`aggressive` bear, an unknown tribe), or an `angryGameTime` of 0 (no readable duration → no
 * lasting anger). Pure of RNG/wall-clock - `until` is the integer `ctx.tick + angryGameTimeOf(...)`.
 */
export function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
  const settler = world.tryGet(target, Settler);
  if (settler === undefined) return; // not a settler/animal - nothing to anger
  if (!isProvokableAnimal(ctx.content, settler.tribe)) return; // not a getAngry animal - no provocation
  // An ALREADY-aggressive animal needs no anger timer - it is hostile unconditionally, and stamping a
  // redundant `Anger` on it would leak a stale component `hostileAnimalNow` never reaps (it short-circuits
  // on `isAggressiveAnimal` before reading `Anger`). Only a passive getAngry animal is provoked.
  if (isAggressiveAnimal(ctx.content, settler.tribe)) return;
  const duration = angryGameTimeOf(ctx.content, settler.tribe);
  if (duration <= 0) return; // no readable anger duration - nothing to time
  const until = ctx.tick + duration;
  const anger = world.tryGet(target, Anger);
  if (anger === undefined) world.add(target, Anger, { until });
  else anger.until = until; // re-strike refreshes the timer (latest provocation wins)
}
