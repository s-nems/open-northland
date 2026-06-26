import {
  CurrentAtomic,
  Health,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Settler,
} from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { fx } from '../fixed.js';
import type { CellId, TerrainGraph } from '../terrain.js';
import type { System, SystemContext } from './context.js';
import { isAggressiveAnimal, isAnimalTribe, mayAttack } from './readviews/index.js';

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
 *    still attack. A **passive** animal (a cow, a deer) is no combat target — hunting prey is the
 *    separate `catchable`/hunter mechanic, not hostility — and animals don't fight each other here.
 *
 * For each idle, living combatant (no `CurrentAtomic` running, not travelling, `hitpoints > 0`), in
 * deterministic store order, the system finds the nearest valid target within the attacker's weapon
 * **range** (Manhattan cells, canonical entity-id tie-break), resolves the **net damage** that hit
 * deals — the attacker's weapon ({@link attackerWeapon}, keyed by the attacker's tribe+job for a
 * settler, or by tribe alone for a jobless spawned animal) versus an unarmored target (class 0 —
 * settlers/animals wear no armor), the verbatim `weapontypes`×`armortypes` join {@link combatDamage}
 * computes — and starts an `attack` atomic carrying that resolved damage.
 *
 * The attacker stays put and swings (combat is in-place at range — no walk-into-melee drive yet; an
 * out-of-range enemy is simply not a target this tick, the original's "advance on the enemy" is a
 * later movement slice). The attack atomic id is {@link ATTACK_ATOMIC_ID} (the original's
 * `setatomic <job> 81 "..._attack"`, bound per job to a weapon-specific animation — see
 * docs/FIDELITY.md); its `duration` is resolved through that binding like every other atomic.
 *
 * FIDELITY: the **net-damage amount** is the faithful `weapontypes`×`armortypes` param join (the same
 * pin as the `attack` effect / `combatDamage` read view); the **civ-vs-animal hostility gate** reads
 * the faithful `aggressive`/`cannotbeattacked` params, and the **playable-vs-animal split** is the
 * faithful tech-graph signature ({@link isAnimalTribe}). **Approximated (no oracle):** *who* a
 * combatant picks (nearest enemy in range), the *swing cadence* (re-target each idle tick), and that an
 * unarmed combatant does no damage are *our* deterministic design — the original's target-acquisition
 * AI is the undocumented "soul" (docs/FIDELITY.md). The **provoked**-anger half (`getAngry`/
 * `angryGameTime` — a passive animal turned hostile after being struck) is **deferred** (it needs a
 * per-entity anger timer the combat slice doesn't yet model; see docs/FIDELITY.md).
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
    // A NON-aggressive animal runs no attack drive at all (a passive cow/deer doesn't pick fights — and
    // animals don't war on each other here). A civilization OR an aggressive animal does drive: the
    // per-target `mayAttack` relation below then decides each candidate. (An unknown-tribe combatant —
    // no animal record — is not an animal, so it falls through to the civ branch and drives.)
    if (isAnimalTribe(ctx.content, attacker.tribe) && !isAggressiveAnimal(ctx.content, attacker.tribe)) {
      continue;
    }

    const weapon = attackerWeapon(ctx, attacker.tribe, attacker.jobType);
    if (weapon === null) continue; // no resolvable weapon — this combatant can't attack (approximated)

    const here = entityCell(world, terrain, e);
    const pick = nearestEnemyTarget(world, terrain, ctx, here, e, attacker.tribe, weapon.range);
    if (pick === null) continue; // no enemy in range this tick

    startAttack(world, ctx, attacker, e, pick.target, weapon.netDamageUnarmored);
  }
};

/**
 * The nearest **enemy** combatant the attacker may swing at: a {@link Health}-bearing {@link Settler}
 * on a positioned cell within `range` Manhattan cells of `here`, with a living (`hitpoints > 0`) pool,
 * for which {@link mayAttack}`(self → target)` holds — a hostile civilization, or (when self is a civ /
 * an aggressive animal) the cross-species enemy. Scanned in canonical entity-id order with a
 * Manhattan-distance + ascending-id tie-break, so the choice never depends on store insertion history.
 * Returns the target entity, or null if no enemy is in range.
 *
 * The attacker itself is excluded (`t === self`); whether a candidate is friendly, an exempt
 * decorative animal, passive prey, or a valid enemy is the single {@link mayAttack} relation (the same
 * relation the attacker-eligibility loop above consults), so the two directions of a civ⇄animal fight
 * stay consistent.
 */
function nearestEnemyTarget(
  world: World,
  terrain: TerrainGraph,
  ctx: SystemContext,
  here: CellId,
  self: Entity,
  selfTribe: number,
  range: number,
): { target: Entity } | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestId = Number.POSITIVE_INFINITY;
  for (const t of world.canonicalEntities()) {
    if (t === self) continue; // never swing at oneself
    if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) continue;
    const targetTribe = world.get(t, Settler).tribe;
    if (!mayAttack(ctx.content, selfTribe, targetTribe)) continue; // not a valid target for this attacker
    if (world.get(t, Health).hitpoints <= 0) continue; // already felled — not a target
    const cell = entityCell(world, terrain, t);
    const dist = manhattan(terrain, here, cell);
    if (dist > range) continue; // out of weapon reach this tick (no advance-on-enemy drive yet)
    if (dist < bestDist || (dist === bestDist && t < bestId)) {
      best = t;
      bestDist = dist;
      bestId = t;
    }
  }
  return best === null ? null : { target: best };
}

/**
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content. Returns its `range`
 * (Manhattan reach, the weapon's `maxRange`, at least 1 so even a `maxRange 0` weapon strikes its own
 * cell) and its **net damage against an unarmored target** (`damage["0"]`, clamped at ≥0 — settlers
 * wear no armor yet, so every hit lands on armor class 0). Null when no weapon resolves (an unarmed
 * combatant — it does no damage, the approximated stance).
 *
 * Two resolution paths, mirroring how the original keys a weapon:
 *
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
 * documents — no Map keyed on a non-unique identity).
 */
function attackerWeapon(
  ctx: SystemContext,
  tribe: number,
  jobType: number | null,
): { range: number; netDamageUnarmored: number } | null {
  const weapon =
    jobType === null
      ? // A jobless combatant resolves a weapon only if it is an animal tribe (whose weapon keys by
        // tribe, not job); a jobless civilian carries nothing. First match in source-array order.
        isAnimalTribe(ctx.content, tribe)
        ? ctx.content.weapons.find((w) => w.tribeType === tribe)
        : undefined
      : ctx.content.weapons.find((w) => w.tribeType === tribe && w.jobType === jobType);
  if (weapon === undefined) return null; // unarmed — no resolvable weapon for this combatant
  const range = Math.max(1, weapon.maxRange); // a weapon always reaches at least its own cell
  const rawUnarmored = weapon.damage['0'] ?? 0; // armor class 0 = unarmored (settlers wear no armor yet)
  return { range, netDamageUnarmored: Math.max(0, rawUnarmored) };
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
