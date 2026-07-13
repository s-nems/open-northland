import { Anger, Carrying, Settler } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import {
  angryGameTimeOf,
  cadaverYieldOf,
  HUNTER_JOB,
  isAggressiveAnimal,
  isCatchableAnimal,
  isProvokableAnimal,
  MEAT_GOOD,
} from '../../../readviews/index.js';
import { addCarry } from '../../effects-goods/index.js';

/**
 * The hunter's `harvest_cadaver` payoff — when a **hunter**'s lethal blow fells **catchable prey**, the
 * slayer gains the kill's meat onto its back. Models the original's `viking_hunter_attack` →
 * `viking_hunter_harvest_cadaver` (`setatomic 15 33 …`) chain *in place on the killing blow*: a hunter
 * ({@link HUNTER_JOB}) who drains a {@link isCatchableAnimal} prey animal to 0 gains
 * {@link cadaverYieldOf} units (the prey's `maximumcadaversize`) of {@link MEAT_GOOD} via the same
 * {@link addCarry} carriers use — goods are conserved (the meat is created by the kill, exactly as the
 * original's harvest atomic yields it; the corpse leaves the field when `cleanupSystem` reaps it).
 *
 * No-ops unless every condition holds: the `attacker` is a hunter, the `target` is catchable prey, and
 * the yield is positive (a `maximumcadaversize` of 0 / a non-animal yields nothing). One guard worth
 * naming: {@link addCarry} THROWS if the hunter already carries a *different* good (a planner bug for a
 * harvester, but a fighting hunter never should) — so if the hunter is somehow already loaded with
 * another good, the meat is dropped (skipped) rather than crashing the tick; a hunter carrying meat
 * already merges the new units.
 *
 * source-basis: the meat **good** and **per-kill amount** are pinned params (the `meat` id + the prey's
 * `maximumcadaversize`); that the yield lands *on the killing blow* rather than via a separate
 * walk-to-corpse `harvest_cadaver` atomic, and the 1-cadaver-unit→1-meat-unit mapping, are approximated
 * (source basis "Hunter cadaver-harvest yield"). Pure over `content` + entity state, no RNG/wall-clock.
 */
export function harvestCadaver(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const hunter = world.tryGet(attacker, Settler);
  if (hunter === undefined || hunter.jobType !== HUNTER_JOB) return; // only a hunter harvests a cadaver
  const prey = world.tryGet(target, Settler);
  if (prey === undefined || !isCatchableAnimal(ctx.content, prey.tribe)) return; // only catchable prey
  const cadaverYield = cadaverYieldOf(ctx.content, prey.tribe);
  if (cadaverYield <= 0) return; // no readable cadaver size — nothing to harvest
  // If the hunter is somehow already carrying a DIFFERENT good, `addCarry` would throw (its harvester-bug
  // guard). A fighting hunter shouldn't be, but skip rather than crash the tick on that edge.
  const held = world.tryGet(attacker, Carrying);
  if (held !== undefined && held.goodType !== MEAT_GOOD) return;
  addCarry(world, attacker, MEAT_GOOD, cadaverYield);
}

/**
 * Provoke a struck **passive but `getAngry`** animal into temporary hostility — the provoked half of
 * `animaltypes.ini` aggression. If `target` is a {@link Settler} of a {@link isProvokableAnimal}
 * tribe, stamp/refresh an {@link Anger}`{until: tick + angryGameTime}` on it (`combatSystem` reads
 * the timer to make it fight back until it lapses). A re-strike before the timer expires **refreshes**
 * `until` (the latest provocation extends hostility, the original's "kept angry while harassed"
 * reading). No-ops for a non-`Settler` target, a non-animal/non-provokable tribe (a civilization, an
 * already-`aggressive` bear, an unknown tribe), or an `angryGameTime` of 0 (no readable duration → no
 * lasting anger). Pure of RNG/wall-clock — `until` is the integer `ctx.tick + angryGameTimeOf(...)`.
 */
export function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
  const settler = world.tryGet(target, Settler);
  if (settler === undefined) return; // not a settler/animal — nothing to anger
  if (!isProvokableAnimal(ctx.content, settler.tribe)) return; // not a getAngry animal — no provocation
  // An ALREADY-aggressive animal needs no anger timer — it is hostile unconditionally, and stamping a
  // redundant `Anger` on it would leak a stale component `hostileAnimalNow` never reaps (it short-circuits
  // on `isAggressiveAnimal` before reading `Anger`). Only a passive getAngry animal is provoked.
  if (isAggressiveAnimal(ctx.content, settler.tribe)) return;
  const duration = angryGameTimeOf(ctx.content, settler.tribe);
  if (duration <= 0) return; // no readable anger duration — nothing to time
  const until = ctx.tick + duration;
  const anger = world.tryGet(target, Anger);
  if (anger === undefined) world.add(target, Anger, { until });
  else anger.until = until; // re-strike refreshes the timer (latest provocation wins)
}
