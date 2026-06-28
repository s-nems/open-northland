import type { WeaponType } from '@vinland/data';
import {
  Anger,
  Armor,
  CurrentAtomic,
  Health,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Settler,
  Weapon,
} from '../components/index.js';
import { fx } from '../core/fixed.js';
import type { Entity, World } from '../ecs/world.js';
import type { CellId, TerrainGraph } from '../nav/terrain.js';
import type { System, SystemContext } from './context.js';
import { isAggressiveAnimal, isAnimalTribe, mayAttack, mayHunt } from './readviews/index.js';

/**
 * CombatSystem (the **targeting** half of the combat loop) — choose who each idle combatant swings
 * at and start the {@link CurrentAtomic} `attack` that lands the hit. This is the front half of the
 * targeting→attack→hit→death loop: it picks a target and resolves the net damage; the AtomicSystem's
 * `attack` effect drains the target's {@link Health} (the hit), and the CleanupSystem reaps a felled
 * combatant. Together with those two already-landed halves it closes the loop.
 *
 * A **combatant** is a {@link Settler} that carries a {@link Health} pool (a fighter — a non-combat
 * settler/the golden slice carries none, so it never fights and the hash stays untouched, the
 * separate-optional-component pattern of `JobAssignment`/`Age`). Two hostility models drive who an
 * idle combatant may swing at, unified in {@link mayAttack}:
 *
 *  - **Civilization vs civilization** — a different-civilization combatant is an enemy (the
 *    player-vs-player drive); a same-tribe settler is friendly; alliances are a later slice.
 *  - **Civilization ⇄ aggressive animal** — an **aggressive** animal ({@link isAggressiveAnimal} —
 *    `animaltypes.ini` `aggressive`, attacks unprovoked) and a civilization are mutual enemies, so a
 *    bear/wolf engages a nearby settler **and** that settler fights back. A `cannotbeattacked` animal
 *    (decorative fauna — bees) is exempt as a *target* (a civ can't hit it) but, if aggressive, can
 *    still attack. A **passive** animal (a cow, a deer) is no combat target — hostility leaves it alone.
 *  - **Hunter → catchable prey** — a civilization **hunter** ({@link mayHunt} — job
 *    {@link HUNTER_JOB}) may strike a {@link isCatchableAnimal} prey animal (a cow/deer the hostility
 *    relation leaves alone), the original's `viking_hunter_attack`. This is predation, gated by the
 *    attacker's *job* not tribe hostility; the strike reuses the same `attack` atomic + weapon/hit path,
 *    and (for a `getAngry` prey) is the **provocation source** the `Anger` timer waits on. Animals don't
 *    fight each other here.
 *
 * For each idle, living combatant (no `CurrentAtomic` running, not travelling, `hitpoints > 0`), in
 * deterministic store order, the system finds the nearest valid target within the attacker's weapon
 * **range** (Manhattan cells, canonical entity-id tie-break), resolves the **net damage** that hit
 * deals — the attacker's weapon ({@link attackerWeapon}, keyed by the attacker's tribe+job for a
 * settler, or by tribe alone for a jobless spawned animal) versus **the target's armor class** (its
 * {@link Armor} tier, or class 0 when it wears none — the verbatim `weapontypes`×`armortypes` join
 * {@link netDamageVs}/{@link combatDamage} computes) — and starts an `attack` atomic carrying that
 * resolved damage.
 *
 * The attacker stays put and swings (combat is in-place at range — no walk-into-melee drive yet; an
 * out-of-range enemy is simply not a target this tick, the original's "advance on the enemy" is a
 * later movement slice). The attack atomic id is {@link ATTACK_ATOMIC_ID} (the original's
 * `setatomic <job> 81 "..._attack"`, bound per job to a weapon-specific animation — see
 * docs/FIDELITY.md); its `duration` is resolved through that binding like every other atomic.
 *
 * FIDELITY: the **net-damage amount** is the faithful `weapontypes`×`armortypes` param join (the same
 * pin as the `attack` effect / `combatDamage` read view) — now resolved against the **target's worn
 * armor class** ({@link Armor}, the `damage[targetClass] - blockingValue` join), not a fixed unarmored
 * value; the **civ-vs-animal hostility gate** reads the faithful `aggressive`/`cannotbeattacked`
 * params, and the **playable-vs-animal split** is the faithful tech-graph signature
 * ({@link isAnimalTribe}). **Approximated (no oracle):** *who* a combatant picks (nearest enemy in
 * range), the *swing cadence* (re-target each idle tick), and that an unarmed combatant does no damage
 * are *our* deterministic design — the original's target-acquisition AI is the undocumented "soul"
 * (docs/FIDELITY.md). *Which* settler wears *which* armor class is caller-supplied (`spawnSettler`),
 * not yet pinned to a soldier-class→armor binding. The **provoked**-anger half (`getAngry`/
 * `angryGameTime` — a passive animal turned hostile after being struck) is **now wired**: the
 * AtomicSystem stamps an {@link Anger} timer on a struck `getAngry` animal, and this system reads it
 * ({@link hostileAnimalNow} on the attacker side, {@link mayTarget} on the target side) so a provoked
 * animal fights back and is a valid target until the timer lapses, then reverts to passive.
 *
 * Determinism: no RNG, no wall-clock; combatants and targets are scanned in canonical
 * ({@link World.canonicalEntities}) order with a Manhattan-distance + ascending-id tie-break, and the
 * weapon/damage/hostility joins are pure reads over content. No-ops without a terrain graph (a mapless
 * sim has no cells to measure range over — the golden is untouched). Inert on the goldens/slice: no
 * settler there carries `Health`, so the combatant scan finds nobody.
 */
export const combatSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure range over
  const terrain = ctx.terrain;
  for (const e of world.query(Settler, Health, Position)) {
    // Busy / mid-walk / already felled: leave it. A 0-HP attacker is dead-but-not-yet-reaped (cleanup
    // runs later this tick) — it must not get a free swing from beyond the grave.
    if (world.has(e, CurrentAtomic)) continue;
    if (world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow)) continue;
    if (world.get(e, Health).hitpoints <= 0) continue;

    const attacker = world.get(e, Settler);
    // A NON-hostile animal runs no attack drive at all (a passive cow/deer doesn't pick fights — and
    // animals don't war on each other here). "Hostile" is an aggressive animal (unprovoked) OR a
    // **provoked** one whose `Anger` timer is still live ({@link hostileAnimalNow}, which also reaps a
    // lapsed timer). A civilization OR a hostile animal drives; the per-target `mayAttack`/anger relation
    // below then decides each candidate. (An unknown-tribe combatant — no animal record — is not an
    // animal, so it falls through to the civ branch and drives.)
    if (isAnimalTribe(ctx.content, attacker.tribe) && !hostileAnimalNow(world, ctx, e, attacker.tribe)) {
      continue;
    }

    // An explicitly-equipped combatant wields its worn `Weapon` (resolved vs its own tribe); a bare one
    // falls back to its class's default `(tribe, jobType)` weapon.
    const wornWeaponTypeId = world.tryGet(e, Weapon)?.weaponTypeId;
    const weapon = attackerWeapon(ctx, attacker.tribe, attacker.jobType, wornWeaponTypeId);
    if (weapon === null) continue; // no resolvable weapon — this combatant can't attack (approximated)

    const here = entityCell(world, terrain, e);
    const pick = nearestEnemyTarget(
      world,
      terrain,
      ctx,
      here,
      e,
      attacker.tribe,
      attacker.jobType,
      weapon.minRange,
      weapon.maxRange,
    );
    if (pick === null) continue; // no enemy/prey in range this tick

    // Resolve the net damage against THE TARGET's armor class (class 0 if it wears no `Armor`): the
    // attacker's weapon `damage[targetClass]` minus that class's `blockingValue` — the per-class
    // `weapontypes`×`armortypes` join, not a fixed unarmored value.
    const damage = netDamageVs(ctx, weapon.weapon, targetArmorClass(world, pick.target));
    startAttack(world, ctx, attacker, e, pick.target, damage);
  }
};

/** The armor class a target wears — its {@link Armor} component's `armorClass`, or **0** (unarmored)
 *  when it carries none (every animal, every bare settler). A negative/out-of-table class still reads
 *  here; {@link netDamageVs} resolves it as unarmored (no `[armortype]` record → no mitigation). */
function targetArmorClass(world: World, target: Entity): number {
  return world.tryGet(target, Armor)?.armorClass ?? 0;
}

/**
 * The **net** damage `weapon` lands on a target wearing `armorClass` — `max(0, weapon.damage[armorClass]
 * - blockingValue)`, the verbatim `weapontypes`×`armortypes` join {@link combatDamage} tabulates, but
 * computed for the single class actually hit (no need to walk every class). Class **0** (unarmored) and
 * any class with **no `[armortype]` record** (the out-of-table 6/7, or a bad stamped value) mitigate
 * nothing (`blockingValue 0`) — the same "armor the data doesn't define blocks nothing rather than
 * crashing" stance {@link combatDamage} takes. Clamped at 0 (a hit never heals).
 *
 * Determinism: a pure read of `weapon.damage` + a `content.armor` scan for the class's record, no RNG /
 * wall-clock. The `armor.find` is the array-not-Map stance the read side keeps; `content.armor` is a
 * small flat table (4 rows), so a per-hit scan is cheap and avoids threading a prebuilt map.
 */
function netDamageVs(ctx: SystemContext, weapon: WeaponType, armorClass: number): number {
  const rawDamage = weapon.damage[String(armorClass)] ?? 0; // weapon's listed damage vs this class
  const armor = ctx.content.armor.find((a) => a.typeId === armorClass); // its `[armortype]` record, if any
  const blockingValue = armor?.blockingValue ?? 0; // class 0 / out-of-table → no mitigation
  return Math.max(0, rawDamage - blockingValue);
}

/**
 * Whether the animal entity `e` (of `tribe`) is **hostile right now** — an always-`aggressive` animal,
 * OR a passive `getAngry` animal that has been **provoked** and whose {@link Anger} timer is still live
 * (`ctx.tick < anger.until`). This is the per-entity layer the content-only {@link mayAttack} can't
 * carry: aggression-by-record is a content fact, but provoked anger is per-entity state.
 *
 * Side effect: a **lapsed** timer (`ctx.tick >= until`) is **removed** here — the animal has cooled
 * off, so it reverts to passive and the stale component is reaped (keeping the hash from accumulating
 * dead timers). Removing on read is safe: the combatant scan visits each entity once per tick, and an
 * expired timer carries no remaining meaning. Pure of RNG/wall-clock — the live/lapsed test is the
 * exact integer `tick < until`.
 */
function hostileAnimalNow(world: World, ctx: SystemContext, e: Entity, tribe: number): boolean {
  if (isAggressiveAnimal(ctx.content, tribe)) return true; // unconditionally hostile
  const anger = world.tryGet(e, Anger);
  if (anger === undefined) return false; // never provoked
  if (ctx.tick < anger.until) return true; // still angry
  world.remove(e, Anger); // cooled off — revert to passive, reap the stale timer
  return false;
}

/**
 * The nearest **enemy or prey** the attacker may swing at: a {@link Health}-bearing {@link Settler}
 * on a positioned cell within the attacker's weapon **reach band** `[minRange, maxRange]` Manhattan
 * cells of `here` — a target **closer than `minRange`** is too near to hit (a bow can't fire on an
 * adjacent target) and one **past `maxRange`** is out of reach — with a living (`hitpoints > 0`) pool,
 * for which {@link mayTarget}`(self → target)` holds — a hostile civilization, the cross-species enemy
 * (when self is a civ / an aggressive animal), OR (when self is a {@link HUNTER_JOB} hunter) a
 * {@link isCatchableAnimal} prey animal. Scanned in canonical entity-id order with a Manhattan-distance
 * + ascending-id tie-break, so the choice never depends on store insertion history. Returns the target
 * entity, or null if no enemy/prey is in the band.
 *
 * The attacker itself is excluded (`t === self`); whether a candidate is friendly, an exempt
 * decorative animal, non-catchable wild fauna, huntable prey, or a valid enemy is the {@link mayTarget}
 * relation, which composes {@link mayAttack} (static hostility — the same relation the attacker-eligibility
 * loop above consults) with the per-entity provoked-anger layer (a struck `getAngry` animal carrying a
 * live {@link Anger} timer is a valid target even though its record alone is passive) **and** the
 * {@link mayHunt} predation relation (a hunter may strike catchable prey). The directions of a civ⇄animal
 * fight stay consistent.
 */
function nearestEnemyTarget(
  world: World,
  terrain: TerrainGraph,
  ctx: SystemContext,
  here: CellId,
  self: Entity,
  selfTribe: number,
  selfJob: number | null,
  minRange: number,
  maxRange: number,
): { target: Entity } | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestId = Number.POSITIVE_INFINITY;
  for (const t of world.canonicalEntities()) {
    if (t === self) continue; // never swing at oneself
    if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) continue;
    const targetTribe = world.get(t, Settler).tribe;
    if (!mayTarget(world, ctx, self, selfTribe, selfJob, t, targetTribe)) continue; // not a valid target for this attacker
    if (world.get(t, Health).hitpoints <= 0) continue; // already felled — not a target
    const cell = entityCell(world, terrain, t);
    const dist = manhattan(terrain, here, cell);
    // Out of the weapon's reach BAND this tick: too far past `maxRange`, or too close inside `minRange`
    // (a ranged weapon can't fire on a target right next to it). No advance/retreat-to-range drive yet.
    if (dist > maxRange || dist < minRange) continue;
    if (dist < bestDist || (dist === bestDist && t < bestId)) {
      best = t;
      bestDist = dist;
      bestId = t;
    }
  }
  return best === null ? null : { target: best };
}

/**
 * Whether the attacker entity `self` (of `attackerTribe`, job `attackerJob`) may swing at the target
 * entity `t` (of `targetTribe`) — three composed relations, ORed:
 *
 *  1. the content-only {@link mayAttack} **hostility** relation (same-tribe friendly, civ⇄civ enemies,
 *     civ→aggressive-animal, animals don't fight each other);
 *  2. the **predation** relation {@link mayHunt} — a {@link HUNTER_JOB} hunter may strike a
 *     {@link isCatchableAnimal} prey animal (a cow/deer a non-hunter combatant leaves alone). Gated by
 *     the attacker's *job*, not tribe hostility, this is what lets a hunter target passive prey
 *     `mayAttack` excludes; the strike then provokes a `getAngry` prey through the combat `Anger` path;
 *  3. the per-entity **provoked-anger** layer — a **provoked** `getAngry` animal (a live {@link Anger}
 *     timer) makes a civ⇄animal fight valid in **both** directions, the case `mayAttack` (content-only)
 *     can't see:
 *      - a **civ attacker → angry-animal target**: the *target's* anger makes it hittable, so a civ can
 *        strike back the animal harassing it (a passive boar it would otherwise leave alone);
 *      - an **angry-animal attacker → civ target**: the *attacker's* own anger makes it eligible to swing
 *        at the civ (`mayAttack` alone would skip a non-aggressive animal attacker).
 *     This override is gated to a **civilization-vs-animal** pair with the **animal side** carrying a
 *     live timer — it never lets two animals fight, nor changes the civ⇄civ rules. (The
 *     attacker-eligibility loop already vetted `self` as hostile via {@link hostileAnimalNow}; this is the
 *     per-candidate target check, consistent with it.)
 *
 * Determinism: a pure read of `content` + the relevant entity's `Anger` against `ctx.tick` (the exact
 * integer `tick < until`), no RNG/wall-clock. A lapsed timer is NOT reaped here (a const-time candidate
 * check); the once-per-tick reaping is {@link hostileAnimalNow} on the attacker pass — an expired timer
 * simply reads as not-angry, so it never falsely marks a target.
 */
function mayTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attackerTribe: number,
  attackerJob: number | null,
  t: Entity,
  targetTribe: number,
): boolean {
  if (mayAttack(ctx.content, attackerTribe, targetTribe)) return true; // static hostility
  if (mayHunt(ctx.content, attackerJob, targetTribe)) return true; // a hunter striking catchable prey
  const attackerIsAnimal = isAnimalTribe(ctx.content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(ctx.content, targetTribe);
  // The anger override only bridges a civilization-vs-animal pair — never animal-vs-animal, never
  // civ-vs-civ (those are fully decided by mayAttack above).
  if (attackerIsAnimal === targetIsAnimal) return false;
  // The ANIMAL side of the pair must carry a live anger timer (a provoked getAngry animal). Whichever
  // of attacker/target is the animal is the one whose anger is read.
  const animalEntity = attackerIsAnimal ? self : t;
  const anger = world.tryGet(animalEntity, Anger);
  return anger !== undefined && ctx.tick < anger.until;
}

/**
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content. Returns its reach as
 * a `[minRange, maxRange]` band (Manhattan cells) and the resolved {@link WeaponType} itself, so the
 * caller can compute the net damage **against the picked target's armor class** ({@link netDamageVs}) —
 * the per-class `weapontypes`×`armortypes` join, not a fixed unarmored value. Null when no weapon
 * resolves (an unarmed combatant — it does no damage, the approximated stance).
 *
 * **The reach is a band, not just a ceiling.** `maxRange` is the far reach (floored at 1, so even a
 * `maxRange 0` weapon still reaches an adjacent cell). `minRange` is the *near* reach a **ranged**
 * weapon can't fire below — the original's `hunter_bow` is `minimumrange 3, maximumrange 17` (verified
 * in the mod's `DataCnmd/types/weapons.ini`), so a bow can't hit an adjacent target; a melee weapon is
 * `minRange 1` (the common case — it hits from one cell away). Both ends are floored at 1, so a target
 * sharing the attacker's own cell (Manhattan distance 0) is below every weapon's near reach and is not
 * hit — only a real concern when the herd scatter stacks entities (entities share tiles freely). The
 * band is clamped sane (`1 ≤ minRange ≤ maxRange`) so a malformed weapon never reads as never-able-to-hit.
 *
 * Three resolution paths, mirroring how the original keys a weapon (the worn override takes precedence):
 *
 *  - **An explicitly-equipped combatant** (`wornWeaponTypeId` set — a settler carrying a {@link Weapon}) →
 *    the {@link WeaponType} matching its **own tribe + that `typeId`**, overriding the `(tribe, jobType)`
 *    default below. This is what lets one settler of a soldier-class hold a *specific* weapon from the
 *    several its class may wield (`weaponsForJob`); a worn id that resolves to no record leaves it unarmed
 *    for the tick (rather than silently falling back to the default), the "the data doesn't define it →
 *    it does nothing" stance {@link Armor} takes for an out-of-table class.
 *  - **A settler with a `jobType`** (a civilization soldier/hunter, or a bound combatant) → the
 *    {@link WeaponType} whose `tribeType` matches the attacker's tribe **and** whose `jobType` matches
 *    the attacker's job, exactly as the original binds a weapon to a *job*.
 *  - **A jobless animal** (`jobType === null` on a {@link isAnimalTribe} tribe — what `spawnAnimalHerd`
 *    places: an animal isn't born into a trade) → the tribe's weapon keyed by **`tribeType` alone**.
 *    An animal's combat identity IS its tribe (each animal tribe carries essentially one attack weapon
 *    — `claw`/`bearfist`/`wolvefist`, all at `typeId 1`); the weapon's `jobType` in the real data is the
 *    creature's monster combat-class, not a player-assignable trade, so a spawned animal can't match on
 *    job. Without this a spawned aggressive animal resolves no weapon and does no damage despite
 *    {@link mayAttack} engaging it.
 *
 * Determinism: a pure scan of `content.weapons` returning the FIRST match in source-array order (a
 * `(tribeType, jobType)` pair — and an animal tribe's weapon set — may have more than one row; source
 * order is the stable choice, the same determinism stance the extractor keeps and {@link combatDamage}
 * documents — no Map keyed on a non-unique identity). The worn-weapon path keys on `(tribe, typeId)`,
 * which can still recur across animal weapons, so it too takes the first source-order match.
 */
function attackerWeapon(
  ctx: SystemContext,
  tribe: number,
  jobType: number | null,
  wornWeaponTypeId?: number,
): { minRange: number; maxRange: number; weapon: WeaponType } | null {
  // An equipped combatant wields its WORN weapon (its own tribe + that typeId), overriding the default
  // class weapon. A worn id with no matching record leaves it unarmed for the tick (the data-doesn't-define
  // -it → does-nothing stance) rather than falling through to the default.
  if (wornWeaponTypeId !== undefined) {
    const worn = ctx.content.weapons.find((w) => w.tribeType === tribe && w.typeId === wornWeaponTypeId);
    return worn === undefined ? null : withReach(worn);
  }
  // A JOBLESS combatant carries a weapon only if it is an animal tribe (whose weapon keys by tribe, not
  // job — `spawnAnimalHerd` places jobless animals); a jobless civilian is unarmed. Resolved once, since
  // it is invariant across the weapon scan below.
  if (jobType === null && !isAnimalTribe(ctx.content, tribe)) return null;
  // A settler with a job binds its weapon by (tribe, job); a jobless animal by tribe alone (its combat
  // identity IS its tribe). First match in source-array order (the array-not-Map stance).
  const weapon = ctx.content.weapons.find(
    (w) => w.tribeType === tribe && (jobType === null || w.jobType === jobType),
  );
  if (weapon === undefined) return null; // unarmed — no resolvable weapon for this combatant
  return withReach(weapon);
}

/** Resolve a {@link WeaponType}'s reach band, clamped sane (`1 ≤ minRange ≤ maxRange`): `maxRange` floored
 *  at 1 (a weapon always reaches at least its own cell), `minRange` floored at 1 and never exceeding the
 *  far reach, so a malformed band can't read as "can never hit". A ranged weapon (the hunter's bow) keeps
 *  its `minRange > 1` near floor — it can't fire on an adjacent target. */
function withReach(weapon: WeaponType): { minRange: number; maxRange: number; weapon: WeaponType } {
  const maxRange = Math.max(1, weapon.maxRange);
  const minRange = Math.min(Math.max(1, weapon.minRange), maxRange);
  return { minRange, maxRange, weapon };
}

/** Start an `attack` {@link CurrentAtomic} on `attacker` against `target`, carrying the pre-resolved
 *  net `damage` (the AtomicSystem's `attack` effect just subtracts it from the target's hitpoints).
 *  `duration` is the attack animation's length, resolved through the attacker's `setatomic` binding
 *  like every other atomic (`atomicDuration`); `targetEntity` records the object for render/inspection. */
function startAttack(
  world: World,
  ctx: SystemContext,
  attacker: { tribe: number; jobType: number | null },
  e: Entity,
  target: Entity,
  damage: number,
): void {
  world.add(e, CurrentAtomic, {
    atomicId: ATTACK_ATOMIC_ID,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: atomicDuration(ctx, attacker, ATTACK_ATOMIC_ID),
    effect: { kind: 'attack', target, damage },
    targetEntity: target,
    targetTile: null,
  });
}

/**
 * The numeric atomic id a combatant runs to attack — the original's `setatomic <job> 81 "..._attack"`
 * (id 81 is the attack slot across every fighting job's bindings; e.g. `viking_soldier_attack_*`,
 * `viking_hunter_attack` — verified in `DataCnmd/tribetypes12/tribetypes.ini`). Like the other atomic
 * ids it is the content cross-reference / animation join key; the typed `attack` effect is the behavior
 * (drain the target's hitpoints, AtomicSystem).
 */
const ATTACK_ATOMIC_ID = 81;

/**
 * Resolve the attack atomic's duration (animation length in ticks) through the data, exactly like the
 * AI planner's `atomicDuration`: the attacker's tribe binds `(jobType, atomicId)` to an animation name
 * (`setatomic`, last-wins) and `atomicAnimations` gives that name's `length`. Falls back to
 * {@link DEFAULT_ATTACK_DURATION} when the chain doesn't resolve (a test fixture may bind neither) — a
 * missing timing must not hang or zero-out the swing. (Kept local rather than shared with ai.ts: the
 * planner's copy is private to that module; duplicating this tiny resolver avoids widening the
 * cross-system `shared.ts` leaf for one more reader — refactor to a shared helper if a third appears.)
 */
function atomicDuration(
  ctx: SystemContext,
  settler: { tribe: number; jobType: number | null },
  atomicId: number,
): number {
  if (settler.jobType === null) return DEFAULT_ATTACK_DURATION;
  const tribe = ctx.content.tribes.find((t) => t.typeId === settler.tribe);
  if (tribe === undefined) return DEFAULT_ATTACK_DURATION;
  let animation: string | undefined;
  for (const b of tribe.atomicBindings) {
    if (b.jobType === settler.jobType && b.atomicId === atomicId) animation = b.animation; // last-wins
  }
  if (animation === undefined) return DEFAULT_ATTACK_DURATION;
  const anim = ctx.content.atomicAnimations.find((a) => a.name === animation);
  const length = anim?.length ?? 0;
  return length > 0 ? length : DEFAULT_ATTACK_DURATION;
}

/** Duration (ticks) used when the attack atomic→animation→length chain doesn't resolve — a non-zero
 *  default so an unresolved swing still takes visible time rather than landing instantly. */
const DEFAULT_ATTACK_DURATION = 4;

/** The cell an entity occupies — its {@link Position} snapped to a cell. */
function entityCell(world: World, terrain: TerrainGraph, e: Entity): CellId {
  const p = world.get(e, Position);
  return terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
}

/** Integer Manhattan distance between two cells (the planner's cheap reach heuristic). */
function manhattan(terrain: TerrainGraph, a: CellId, b: CellId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}
