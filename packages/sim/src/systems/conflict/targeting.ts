import {
  Anger,
  Building,
  Health,
  Owner,
  Position,
  Settler,
  type SettlerIdentity,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAggressiveAnimal, isAnimalTribe, mayAttack, mayHunt } from '../readviews/index.js';

// The combat TARGETING relations — who may fight whom (the player/tribe/predation/anger axes) and
// how far a combatant spots an enemy. The leaf of the conflict/ split: flee.ts, weapons.ts and
// combat.ts all consult these; nothing here reaches back into them.

/**
 * How far (Manhattan half-cell nodes) an OWNED combatant can **spot** an enemy to advance on it — the
 * aggro/advance radius the walk-into-melee drive searches within. APPROXIMATED (source basis "Combat
 * sight radius"): humans carry NO readable sight/aggro field in the data (only animals have leash
 * radii), so this is a calibration-by-observation constant pending a look at the running original,
 * not a pinned param — doubled with the half-cell migration so it covers the same on-screen radius
 * the old 8-cell value did. The weapon's extracted `[minRange, maxRange]` band (where a swing lands)
 * is separate and faithful.
 */
export const SIGHT_RADIUS_NODES = 16;

/** Whether `t` is a live target this attacker may swing at — a positioned, `Health`-bearing enemy
 *  settler OR an enemy building (not the attacker itself, `hitpoints > 0`) for which the {@link mayTarget}
 *  hostility relation holds. The shared predicate behind both the attack-order validity check and the
 *  ring-search filter. A building is a target only for an OWNED attacker (a player's warriors siege
 *  structures; wildlife never does), keyed on the building's `tribe` so the same owner/tribe hostility as
 *  a unit target decides. */
export function isValidTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attacker: SettlerIdentity,
  t: Entity,
): boolean {
  if (t === self) return false;
  if (!world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  const building = world.tryGet(t, Building);
  if (building !== undefined) {
    // Only a player's own units besiege buildings — an animal (no Owner) never turns on a structure.
    if (!world.has(self, Owner)) return false;
    return mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, building.tribe);
  }
  if (!world.has(t, Settler)) return false;
  return mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, world.get(t, Settler).tribe);
}

/** Whether `t` is catchable **prey** a hunter of `hunterJob` may strike — the predation-only target filter
 *  an IGNORE hunter uses (its animal-hunt drive survives the IGNORE gate, but it ignores player-hostility).
 *  A live, positioned, Health-bearing settler for which {@link mayHunt} holds. */
export function isHuntTarget(world: World, ctx: SystemContext, t: Entity, hunterJob: number | null): boolean {
  if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  return mayHunt(ctx.content, hunterJob, world.get(t, Settler).tribe);
}

/**
 * Whether the attacker entity `self` (of `attackerTribe`/`attackerJob`) may swing at target `t` (of
 * `targetTribe`) — the composed hostility relation the ring-search filter and the attack-order check
 * both consult, so the two directions of a fight stay consistent. In order:
 *
 *  1. **Owner (player) hostility** — when BOTH `self` and `t` carry an {@link Owner}, the player axis is
 *     AUTHORITATIVE: different players → enemies, same player → friendly (a player's mixed-tribe army never
 *     fights itself; two players fielding the same tribe DO fight). The tribe/hunt/anger relations don't
 *     apply to an owned-vs-owned pair (both sides are player-commanded units, never wildlife). Binary — no
 *     alliances/diplomacy (source basis "Combat hostility axis").
 *  2. Otherwise (at least one side **unowned** — wildlife, an economy fixture, the golden path) the content
 *     relations decide, unchanged: the {@link mayAttack} **tribe hostility** (same-tribe friendly, civ-vs-civ
 *     enemies, civ→aggressive-animal, animals don't war on each other), the {@link mayHunt} **predation**
 *     (a {@link HUNTER_JOB} hunter may strike catchable prey), and the per-entity **provoked-anger** override
 *     (a struck `getAngry` animal — a live {@link Anger} — makes a civ⇄animal fight valid in both directions).
 *
 * Determinism: a pure read of the two entities' `Owner`, plus `content` + the relevant `Anger` against
 * `ctx.tick`; no RNG/wall-clock. A lapsed timer is not reaped here (a const-time candidate check) — the
 * once-per-tick reaping is {@link hostileAnimalNow} on the attacker pass; an expired timer reads not-angry.
 */
export function mayTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attackerTribe: number,
  attackerJob: number | null,
  t: Entity,
  targetTribe: number,
): boolean {
  const selfOwner = world.tryGet(self, Owner);
  const targetOwner = world.tryGet(t, Owner);
  if (selfOwner !== undefined && targetOwner !== undefined) {
    // Both player-owned: the OWNER axis alone decides (binary hostility, no diplomacy).
    return selfOwner.player !== targetOwner.player;
  }
  // At least one side neutral/unowned: the content tribe/predation/anger relations (unchanged).
  if (mayAttack(ctx.content, attackerTribe, targetTribe)) return true; // static hostility
  if (mayHunt(ctx.content, attackerJob, targetTribe)) return true; // a hunter striking catchable prey
  const attackerIsAnimal = isAnimalTribe(ctx.content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(ctx.content, targetTribe);
  // The anger override only bridges a civilization-vs-animal pair — never animal-vs-animal, never civ-vs-civ.
  if (attackerIsAnimal === targetIsAnimal) return false;
  // The ANIMAL side of the pair must carry a live anger timer (a provoked getAngry animal).
  const animalEntity = attackerIsAnimal ? self : t;
  const anger = world.tryGet(animalEntity, Anger);
  return anger !== undefined && ctx.tick < anger.until;
}

/**
 * Whether the animal entity `e` (of `tribe`) is **hostile right now** — an always-`aggressive` animal,
 * OR a passive `getAngry` animal that has been **provoked** and whose {@link Anger} timer is still live
 * (`ctx.tick < anger.until`). This is the per-entity layer the content-only {@link mayAttack} can't
 * carry: aggression-by-record is a content fact, but provoked anger is per-entity state.
 *
 * Side effect: a **lapsed** timer (`ctx.tick >= until`) is **removed** here — the animal has cooled off,
 * so it reverts to passive and the stale component is reaped (keeping the hash from accumulating dead
 * timers). Removing on read is safe: the combatant scan visits each entity once per tick, and an expired
 * timer carries no remaining meaning. Pure of RNG/wall-clock — the live/lapsed test is the exact integer
 * `tick < until`.
 */
export function hostileAnimalNow(world: World, ctx: SystemContext, e: Entity, tribe: number): boolean {
  if (isAggressiveAnimal(ctx.content, tribe)) return true; // unconditionally hostile
  const anger = world.tryGet(e, Anger);
  if (anger === undefined) return false; // never provoked
  if (ctx.tick < anger.until) return true; // still angry
  world.remove(e, Anger); // cooled off — revert to passive, reap the stale timer
  return false;
}
