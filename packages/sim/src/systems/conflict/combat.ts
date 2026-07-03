import type { WeaponType } from '@vinland/data';
import {
  Anger,
  Armor,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Weapon,
} from '../../components/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import {
  ARMOR_MATERIAL,
  ATOMIC_EVENT_TYPE_ATTACK,
  HUNTER_JOB,
  armorMaterialForClass,
  atomicEventFrame,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  mayAttack,
  mayHunt,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import {
  TileBuckets,
  atomicAnimationName,
  atomicDurationForName,
  canonicalById,
  entityCell,
  manhattan,
} from '../shared.js';

/**
 * CombatSystem — the whole combat loop's **decision** stage: for each combatant, pick who to fight and
 * either **swing** at an enemy in reach or **advance** on one that is spotted but out of reach. It closes
 * the front half of the targeting→attack→hit→death loop (the AtomicSystem's `attack` effect lands the
 * hit, the CleanupSystem reaps the felled), and it now also drives the *engagement* half — walk-into-melee.
 *
 * A **combatant** is a {@link Settler} carrying a {@link Health} pool; a non-combat settler / the golden
 * slice carries none, so the whole system is inert on them (the hash stays untouched). Each tick:
 *
 *  1. **Dormancy gate** ({@link combatPossible}) — one cheap pass decides whether any hostile pair (or any
 *     lingering combat state to clean up) exists. If not, the system does **zero** further work: a map of
 *     peaceful settlers, or an all-one-player field, costs nothing (golden rule 7 — no full-world scan on
 *     an idle tick).
 *  2. **Spatial index** — all combatants are bucketed by tile ONCE ({@link TileBuckets}), so a seeker's
 *     "nearest enemy" query is a bounded grid RING SEARCH ({@link TileBuckets.nearest}) instead of an
 *     O(entities) full scan per seeker (the ROADMAP tier-3 ring-search consumer).
 *  3. **Per combatant** ({@link engageCombatant}) — resolve a target (an explicit {@link AttackOrder}, else
 *     the nearest enemy in sight), then: inside the weapon reach band `[minRange, maxRange]` → stop and
 *     start the `attack` atomic; beyond it (an OWNED unit only) → chase it with a {@link MoveGoal} toward
 *     an approach cell, throttled to {@link REPATH_CADENCE}; no target → disengage back to the economy.
 *
 * **Two hostility axes.** *Who* is an enemy is the {@link mayTarget} relation, which composes:
 *  - **Owner (player) hostility** — two OWNED combatants of DIFFERENT players are enemies; SAME player are
 *    friendly (a player's mixed-tribe army never fights itself). This is the axis battle scenes key on
 *    (viking-vs-viking told apart by player). Binary, no diplomacy/alliances (docs/FIDELITY.md).
 *  - **Tribe hostility + predation + provoked anger** ({@link mayAttack}/{@link mayHunt}/{@link Anger}) —
 *    the existing content relations for any pair where at least one side is unowned (wildlife, economy
 *    fixtures, the golden path): civ-vs-civ by tribe, civ⇄aggressive-animal, hunter→catchable-prey, and a
 *    struck `getAngry` animal fighting back. Unchanged for unowned combatants.
 *
 * **Two reach radii.** The weapon's extracted `[minRange, maxRange]` band is where a swing LANDS; an
 * approximated {@link SIGHT_RADIUS_TILES} is how far an owned combatant SPOTS an enemy to advance on. An
 * unowned combatant has no advance drive (its search radius is just `maxRange`), so its behaviour is
 * byte-identical to before — it swings an in-range enemy and otherwise does nothing.
 *
 * Determinism: no RNG, no wall-clock. Combatants are scanned in canonical ({@link canonicalById}) order;
 * the ring search finishes the whole minimum-distance band and picks (distance, then id) — the same winner
 * a full scan would, provably order-independent. No-op without a terrain graph.
 */
export const combatSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure reach over
  const terrain = ctx.terrain;

  // Dormancy gate FIRST, over the raw (unsorted) combatant query: it is order-independent (Set
  // membership + a boolean any-match), so an idle standing army pays only an O(combatants) scan, not the
  // O(c log c) canonical sort, on a tick with no fight. No possible hostile pair AND no combat state to
  // resolve ⇒ skip all combat work (golden rule 7 — zero cost when nothing can happen).
  if (!combatPossible(world, ctx, world.query(Settler, Health, Position))) return;

  // A fight (or cleanup) IS possible: now build the canonical (ascending-id) combatant list — the scan
  // order and the ring-search index are both built from it, so a distance/first-match tie-break lands on
  // the same winner every run — and the per-tick spatial bucket for the ring-search enemy query.
  const combatants = canonicalById(world.query(Settler, Health, Position));
  const index = new TileBuckets(world, combatants);

  for (const e of combatants) {
    engageCombatant(world, ctx, terrain, index, e);
  }
};

/**
 * How far (Manhattan tiles) an OWNED combatant can **spot** an enemy to advance on it — the aggro/advance
 * radius the walk-into-melee drive searches within. APPROXIMATED (docs/FIDELITY.md "Combat sight radius"):
 * humans carry NO readable sight/aggro field in the data (only animals have leash radii), so this is a
 * calibration-by-observation constant pending a look at the running original, not a pinned param. The
 * weapon's extracted `[minRange, maxRange]` band (where a swing lands) is separate and faithful.
 */
export const SIGHT_RADIUS_TILES = 8;

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one — the
 * chase repath throttle. A chaser tracks a MOVING enemy by re-pathing periodically, not every tick; a
 * per-tick full re-path of every chaser would be the RTS-scale regression golden rule 7 forbids (and the
 * pathfinding budget is only {@link PATHFINDING_BUDGET_PER_TICK}/tick anyway). Between repaths the unit
 * keeps walking its last route toward the enemy, and the swing check is distance-based (independent of the
 * path goal), so a slightly-stale route still delivers it into reach. OUR design (no oracle) —
 * docs/FIDELITY.md "Combat chase / repath cadence".
 */
export const REPATH_CADENCE = 8;

/**
 * The dormancy gate: whether any combat work is possible this tick — a cheap single pass over the
 * combatants. Combat runs if ANY of:
 *  - a combatant already carries combat state ({@link Engagement}/{@link AttackOrder}/{@link Anger}) that
 *    must be resolved (disengaged, cleared, or an expired anger timer reaped) even with no live enemy;
 *  - **≥2 distinct player owners** are present (a possible player-vs-player fight);
 *  - **≥2 distinct civilization tribes** are present (a possible civ-vs-civ fight — the unowned scenarios);
 *  - a **hostile (aggressive) animal** and a **civilization** are both present (civ⇄animal aggression);
 *  - a **hunter** and a **catchable** animal are both present (a possible hunt).
 *
 * It is CONSERVATIVE — it may pass on a tick where the two hostile sides are out of range (combat then
 * simply finds no target), but it never skips a tick where a fight or a cleanup is due. This is the lever
 * that makes a peaceful map, or an all-one-player field, cost ~0 (no per-seeker scan runs at all).
 */
function combatPossible(world: World, ctx: SystemContext, combatants: Iterable<Entity>): boolean {
  const owners = new Set<number>();
  const civTribes = new Set<number>();
  let hasCiv = false;
  let hasHostileAnimal = false;
  let hasHunter = false;
  let hasCatchable = false;
  for (const e of combatants) {
    // Lingering combat state must always be resolved (disengage / reap / clear the order), independent of
    // whether a live enemy remains — so its presence alone keeps the system awake this tick.
    if (world.has(e, Engagement) || world.has(e, AttackOrder) || world.has(e, Anger)) return true;
    const s = world.get(e, Settler);
    const owner = world.tryGet(e, Owner);
    if (owner !== undefined) owners.add(owner.player);
    if (isAnimalTribe(ctx.content, s.tribe)) {
      if (isAggressiveAnimal(ctx.content, s.tribe)) hasHostileAnimal = true;
      if (isCatchableAnimal(ctx.content, s.tribe)) hasCatchable = true;
    } else {
      hasCiv = true;
      civTribes.add(s.tribe);
      if (s.jobType === HUNTER_JOB) hasHunter = true;
    }
  }
  if (owners.size >= 2) return true; // two players → possible pvp
  if (civTribes.size >= 2) return true; // two civilizations → civ-vs-civ (unowned scenarios)
  if (hasHostileAnimal && hasCiv) return true; // an aggressive animal near a civilization
  if (hasHunter && hasCatchable) return true; // a hunter and huntable prey
  return false;
}

/**
 * Resolve and act on one combatant's engagement this tick: pick a target, then swing / chase / disengage.
 * The gates, in order:
 *  - **busy** (a {@link CurrentAtomic} running) or **dead** (`hitpoints <= 0`) → leave it (a mid-swing unit
 *    plays out; a felled-but-unreaped one gets no swing from beyond the grave);
 *  - **travelling and neither engaged nor under an attack order** → leave it (don't hijack a unit walking
 *    under a player move order / economy drive; an already-engaged or ordered unit IS re-evaluated while
 *    travelling, so a chaser can stop-and-swing the instant it steps into reach);
 *  - **attacker eligibility** — an unowned passive animal runs no attack drive (a cow doesn't pick fights;
 *    this also reaps a lapsed {@link Anger}); an owned combatant is always a driver ("attack stance");
 *  - **unarmed** (no resolvable weapon) → disengage;
 *  - then resolve a target and swing (in the reach band) / chase (owned, beyond it) / disengage (none).
 */
function engageCombatant(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: TileBuckets,
  e: Entity,
): void {
  if (world.has(e, CurrentAtomic)) return; // mid-swing / mid-need: play it out
  if (world.get(e, Health).hitpoints <= 0) return; // dead, not yet reaped — no free swing

  const owned = world.has(e, Owner);
  const ordered = world.has(e, AttackOrder);
  // A live PLAYER MOVE order (a {@link PlayerOrder}, and NOT an explicit {@link AttackOrder}) is the human's
  // authoritative "go there and HOLD" command — it SUPPRESSES auto-engagement so the unit carries the order
  // out instead of re-acquiring a nearby enemy and attacking (the reported "takes one step, then re-grabs
  // the target and swings"). `moveUnit` clears any prior Engagement/AttackOrder, so an ordered unit holds
  // cleanly with no stale combat state; an explicit AttackOrder is the OPPOSITE intent (fight THAT one) and
  // still engages. Once the hold lapses (playerOrderSystem drops the PlayerOrder) the unit auto-defends
  // again. This is the combat side of the soft-override philosophy the order handlers document.
  if (world.has(e, PlayerOrder) && !ordered) return;
  const engaged = world.has(e, Engagement);
  const travelling = world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
  // A travelling unit that is not yet fighting is walking under another drive (an economy walk) — don't
  // yank it into combat. An engaged/ordered unit is re-checked even while moving.
  if (travelling && !engaged && !ordered) return;

  const attacker = world.get(e, Settler);
  // An unowned passive animal drives no attack (and a lapsed anger timer is reaped here); an owned unit
  // is always an aggressor. `hostileAnimalNow` is only consulted for the unowned-animal case.
  if (!owned && !ordered && isAnimalTribe(ctx.content, attacker.tribe)) {
    if (!hostileAnimalNow(world, ctx, e, attacker.tribe)) {
      disengage(world, e);
      return;
    }
  }

  const wornWeaponTypeId = world.tryGet(e, Weapon)?.weaponTypeId;
  const weapon = attackerWeapon(ctx, attacker.tribe, attacker.jobType, wornWeaponTypeId);
  if (weapon === null) {
    disengage(world, e); // no resolvable weapon — this combatant can't fight (approximated)
    return;
  }

  const here = entityCell(world, terrain, e);
  const found = resolveTarget(world, ctx, terrain, index, e, here, attacker, weapon, owned);
  if (found === null) {
    disengage(world, e); // no enemy in reach/sight — return to the economy
    return;
  }

  const { target, dist } = found;
  if (dist >= weapon.minRange && dist <= weapon.maxRange) {
    // In the reach band: stop advancing and swing. Clearing the chase movement is a no-op for an unowned
    // unit (it never travels into combat) and drops the chase route for an owned one that just arrived.
    clearChase(world, e);
    // The Engagement marker (economy-skip + chase throttle) is OWNED-only — an unowned combatant swings
    // in place with no advance drive, so stamping it there would give it a spurious economy-skip AND
    // perturb its hash (it must stay byte-identical to the pre-engagement behaviour). During the swing the
    // unit is mid-`CurrentAtomic` anyway, which already gates it off the economy; the marker only matters
    // in the idle tick between swings, where it keeps an OWNED unit engaged instead of re-tasked.
    if (owned) world.add(e, Engagement, { repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick });
    const damage = weaponDamageVsMaterial(weapon.weapon, targetMaterial(world, ctx, target));
    startAttack(world, ctx, attacker, e, target, damage, weapon.weapon);
    return;
  }

  // Beyond reach. Only an OWNED combatant advances (the player's army walks into melee); an unowned one
  // simply has no target this tick (the resolveTarget search radius was capped at maxRange for it, so this
  // branch is unreachable for unowned — kept explicit for the owned chase).
  if (!owned) {
    disengage(world, e);
    return;
  }
  chase(world, ctx, terrain, e, here, target, weapon, ordered);
}

/**
 * The enemy this combatant fights this tick (with its Manhattan distance from `here`, so the caller
 * needn't recompute it), or null:
 *  - under an explicit {@link AttackOrder} → that focused `target`, chased regardless of sight, as long as
 *    it is a live, hostile combatant; a target that has died / become an invalid target drops the order and
 *    falls through to auto-engagement (so the unit re-acquires a nearby enemy rather than going idle);
 *  - otherwise → the nearest enemy the ring search finds within `[minRange, searchRadius]` — `searchRadius`
 *    is `maxRange` for an unowned combatant (swing-in-place only, the unchanged behaviour) and
 *    `max(maxRange, SIGHT_RADIUS_TILES)` for an owned one (so it also spots enemies to advance on).
 */
function resolveTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: TileBuckets,
  self: Entity,
  here: CellId,
  attacker: { tribe: number; jobType: number | null },
  weapon: { minRange: number; maxRange: number },
  owned: boolean,
): { target: Entity; dist: number } | null {
  if (world.has(self, AttackOrder)) {
    const focus = world.get(self, AttackOrder).target;
    // An ordered target is chased regardless of sight, so measure its real distance (the ring search's
    // `searchRadius` cap does not apply); the swing/chase decision is on this distance.
    if (isValidTarget(world, ctx, self, attacker, focus)) {
      return { target: focus, dist: manhattan(terrain, here, entityCell(world, terrain, focus)) };
    }
    world.remove(self, AttackOrder); // target gone / no longer hostile — abandon the order, auto-engage
  }
  const { x, y } = terrain.coordsOf(here);
  const searchRadius = owned ? Math.max(weapon.maxRange, SIGHT_RADIUS_TILES) : weapon.maxRange;
  const accept = (t: Entity): boolean => isValidTarget(world, ctx, self, attacker, t);
  const found = index.nearest(x, y, weapon.minRange, searchRadius, accept);
  return found === null ? null : { target: found.entity, dist: found.distance };
}

/** Whether `t` is a live combatant this attacker may swing at — a positioned, `Health`-bearing settler
 *  (not the attacker itself, `hitpoints > 0`) for which the {@link mayTarget} hostility relation holds.
 *  The shared predicate behind both the attack-order validity check and the ring-search filter. */
function isValidTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attacker: { tribe: number; jobType: number | null },
  t: Entity,
): boolean {
  if (t === self) return false;
  if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  const targetTribe = world.get(t, Settler).tribe;
  return mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, targetTribe);
}

/**
 * Advance an OWNED combatant on `target` it can't yet reach — the walk-into-melee drive. It keeps an
 * {@link Engagement} marker (so the AISystem leaves the unit to combat) and re-issues a {@link MoveGoal}
 * toward an {@link approachCell} (a cell in the weapon's reach band of the target, closest to the unit —
 * so a melee unit stops ADJACENT rather than walking onto the enemy) at most every {@link REPATH_CADENCE}
 * ticks. Between repaths it follows its live route; the swing check (distance-based) catches it the instant
 * it steps into reach. A dead route (an unreachable target) is dropped so it re-issues; an **ordered**
 * unit whose route can't resolve gives the order up (the "becomes unreachable" end of an attack order).
 */
function chase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: CellId,
  target: Entity,
  weapon: { minRange: number; maxRange: number },
  ordered: boolean,
): void {
  const engagement = world.add(e, Engagement, {
    repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick, // repath now on first engagement
  });

  // A failed chase route (unreachable target): drop the dead nav state so we re-issue below. For an
  // explicit attack order an unreachable target ends the order — the "until it dies or becomes unreachable".
  if (world.tryGet(e, PathRequest)?.failed) {
    clearChase(world, e);
    if (ordered) {
      world.remove(e, AttackOrder);
      world.remove(e, Engagement);
      return;
    }
  }

  const travelling = world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
  if (travelling && ctx.tick < engagement.repathAt) return; // still closing on a live route — don't re-path

  const dest = approachCell(
    terrain,
    here,
    entityCell(world, terrain, target),
    weapon.minRange,
    weapon.maxRange,
  );
  if (dest === here) {
    // No walkable cell in the target's weapon band is reachable, and the unit is out of range (else it
    // would have swung, not chased) — the target can't be closed on (boxed into an unwalkable pocket, or
    // the two are stacked on one cell with no free approach). Give up rather than loop engaged-but-frozen:
    // `disengage` drops the Engagement + chase state AND any AttackOrder (an unreachable ordered target).
    // Next tick the unit re-acquires another enemy, or the economy relocates it (which also breaks a
    // shared-tile stall) — so it never stays stuck. Only reachable on obstructed terrain: an all-walkable
    // map always yields a band cell, so combat on open ground is unaffected.
    disengage(world, e);
    return;
  }
  clearChase(world, e);
  world.add(e, MoveGoal, { cell: dest });
  engagement.repathAt = ctx.tick + REPATH_CADENCE;
}

/** The cell a chaser should walk to in order to bring `target` into its weapon band: the walkable cell
 *  whose Manhattan distance to the target is in `[minRange, maxRange]` and which is CLOSEST to the unit
 *  (`from`), canonical (min distance, then min cell id). So a melee unit stops one cell short of the enemy
 *  (distance in-band, hittable) instead of walking onto it (distance 0, below every weapon's near reach —
 *  which would deadlock). Falls back to the target's own cell when no in-band cell is walkable (a boxed-in
 *  target; the chase then closes and the swing/disengage logic re-decides). A bounded scan of the band box
 *  around the target — O((2·maxRange+1)²), tiny for melee — deterministic (fixed order + min-id tie-break). */
function approachCell(
  terrain: TerrainGraph,
  from: CellId,
  targetCell: CellId,
  minRange: number,
  maxRange: number,
): CellId {
  const t = terrain.coordsOf(targetCell);
  const f = terrain.coordsOf(from);
  let best: CellId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dy = -maxRange; dy <= maxRange; dy++) {
    for (let dx = -maxRange; dx <= maxRange; dx++) {
      const band = Math.abs(dx) + Math.abs(dy);
      if (band < minRange || band > maxRange) continue; // not in the target's reach band
      const x = t.x + dx;
      const y = t.y + dy;
      if (!terrain.inBounds(x, y)) continue;
      const cell = terrain.cellAt(x, y);
      if (!terrain.isWalkable(cell)) continue;
      const d = Math.abs(x - f.x) + Math.abs(y - f.y); // distance from the unit to this candidate cell
      if (d < bestDist || (d === bestDist && (best === null || cell < best))) {
        best = cell;
        bestDist = d;
      }
    }
  }
  return best ?? targetCell;
}

/** Drop the combatant's engagement, returning it to the economy: remove the {@link Engagement} marker and
 *  the chase movement it drove, and any {@link AttackOrder} (a dead/invalid focus). Only touches a unit
 *  that WAS engaged — a peaceful/economy unit with no marker keeps its own movement untouched. */
function disengage(world: World, e: Entity): void {
  if (world.has(e, Engagement)) {
    world.remove(e, Engagement);
    clearChase(world, e);
  }
  world.remove(e, AttackOrder);
}

/** Remove the nav state a chase drove (goal + in-flight route) so combat can re-aim or hand the unit back. */
function clearChase(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
}

/** The armor **material tier** a target wears — the column a weapon's `damagevalue[material]` selects.
 *  A target with an {@link Armor} tier resolves its `armorClass` to a material via
 *  {@link armorMaterialForClass} (== the class for the four base armors); one with **no** `Armor` (every
 *  animal, every bare settler) is unarmored, material **0**. The `weaponDamageVsMaterial` join reads that
 *  column verbatim — no mitigation is subtracted. */
function targetMaterial(world: World, ctx: SystemContext, target: Entity): number {
  const armor = world.tryGet(target, Armor);
  if (armor === undefined) return ARMOR_MATERIAL.NONE; // bare target — the unarmored column
  return armorMaterialForClass(ctx.content, armor.armorClass);
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
function hostileAnimalNow(world: World, ctx: SystemContext, e: Entity, tribe: number): boolean {
  if (isAggressiveAnimal(ctx.content, tribe)) return true; // unconditionally hostile
  const anger = world.tryGet(e, Anger);
  if (anger === undefined) return false; // never provoked
  if (ctx.tick < anger.until) return true; // still angry
  world.remove(e, Anger); // cooled off — revert to passive, reap the stale timer
  return false;
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
 *     alliances/diplomacy (docs/FIDELITY.md "Combat hostility axis").
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
function mayTarget(
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
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content. Returns its reach as
 * a `[minRange, maxRange]` band (Manhattan cells) and the resolved {@link WeaponType} itself, so the
 * caller can select the damage **column for the picked target's armor material**
 * ({@link weaponDamageVsMaterial}) and read the weapon's class for fight XP. Null when no weapon
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
 *  column `damage` (the AtomicSystem's `attack` hit just subtracts it from the target's hitpoints).
 *  `duration` is the attack animation's length, resolved through the attacker's `setatomic` binding
 *  like every other atomic (`atomicDuration`), and the swing REPEATS at that cadence — a survivor is
 *  re-targeted next idle tick and swings again. `hitAt` is the animation's ATTACK-event frame (the blow
 *  lands mid-animation, not at completion); it is omitted when the animation has no such event (the
 *  executor then falls back to completion). `weaponMainType` (the weapon's coarse class) is stamped so
 *  the swing accrues fight XP into that weapon's bucket; omitted when the weapon lists no `mainType`.
 *  `targetEntity` records the object for render/inspection. */
function startAttack(
  world: World,
  ctx: SystemContext,
  attacker: { tribe: number; jobType: number | null },
  e: Entity,
  target: Entity,
  damage: number,
  weapon: WeaponType,
): void {
  // Resolve the attack animation NAME once (the tribe's `setatomic 81` walk), then read BOTH its
  // duration and its ATTACK-event hit-frame off that single resolution — the swing-start is per-swing,
  // not per-tick, but re-walking the bindings twice for the same animation is a needless hot-loop cost.
  const animation = atomicAnimationName(ctx, attacker, ATTACK_ATOMIC_ID);
  const hitAt =
    animation === undefined ? undefined : atomicEventFrame(ctx.content, animation, ATOMIC_EVENT_TYPE_ATTACK);
  world.add(e, CurrentAtomic, {
    atomicId: ATTACK_ATOMIC_ID,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: atomicDurationForName(ctx, animation),
    effect: {
      kind: 'attack',
      target,
      damage,
      // Omit an absent hit-frame / mainType so a weapon/animation that carries neither yields the exact
      // `{ kind, target, damage }` effect (no `undefined`-valued keys) — the fallback-to-completion and
      // no-XP paths are the absence of the field, not a sentinel.
      ...(hitAt !== undefined ? { hitAt } : {}),
      ...(weapon.mainType !== undefined ? { weaponMainType: weapon.mainType } : {}),
    },
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
