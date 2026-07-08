import type { WeaponType } from '@vinland/data';
import {
  Anger,
  Armor,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Weapon,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import { atomicAnimationName, atomicDurationForName } from '../readviews/animations.js';
import {
  ARMOR_MATERIAL,
  ATOMIC_EVENT_TYPE_ATTACK,
  HUNTER_JOB,
  MILITARY_MODE,
  armorMaterialForClass,
  atomicEventFrame,
  defaultStanceForJob,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isRangedWeapon,
  mayAttack,
  mayHunt,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import { TileBuckets, canonicalById, entityCell, manhattan } from '../spatial.js';

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
 *     O(entities) full scan per seeker (the historical plan tier-3 ring-search consumer).
 *  3. **Per combatant** ({@link engageCombatant}) — act on the unit's {@link Stance} military mode (owned
 *     units; the original's `MILITARY_MODE`): **ATTACK** auto-acquires the nearest enemy in sight and
 *     swings (in the weapon reach band) or chases (beyond it, throttled to {@link REPATH_CADENCE});
 *     **DEFEND** engages only within {@link DEFEND_RADIUS_TILES} of an anchor and never chases past
 *     {@link DEFEND_LEASH_TILES}, returning to post when clear; **IGNORE** never auto-engages (a hunter
 *     still hunts prey); **FLEE** runs from the nearest threat at the run gait ({@link fleeDrive}). An
 *     explicit {@link AttackOrder} overrides the mode (fight THAT one). Unowned combatants carry no Stance
 *     and keep the legacy swing-in-place behaviour.
 *
 * **Two hostility axes.** *Who* is an enemy is the {@link mayTarget} relation, which composes:
 *  - **Owner (player) hostility** — two OWNED combatants of DIFFERENT players are enemies; SAME player are
 *    friendly (a player's mixed-tribe army never fights itself). This is the axis battle scenes key on
 *    (viking-vs-viking told apart by player). Binary, no diplomacy/alliances (source basis).
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
 * radius the walk-into-melee drive searches within. APPROXIMATED (source basis "Combat sight radius"):
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
 * source basis "Combat chase / repath cadence".
 */
export const REPATH_CADENCE = 8;

/**
 * DEFEND stance — how far (Manhattan tiles) from its **anchor** a defender auto-acquires an enemy: it
 * engages only threats inside this radius of the tile the DEFEND stance was set on, ignoring anything
 * beyond (it holds its post rather than roaming). APPROXIMATED — the original's exact defend radius is
 * unreadable (source basis "Combat stances"); calibration-by-observation pending.
 */
export const DEFEND_RADIUS_TILES = 4;

/**
 * DEFEND stance — the **leash**: the farthest (Manhattan tiles) from its anchor a defender will step to
 * strike an in-radius enemy. Kept a little above {@link DEFEND_RADIUS_TILES} so a melee defender can walk
 * up to a threat at the radius edge, but never chases far — a target reachable only by breaking the leash
 * is left alone and the defender returns to its anchor. APPROXIMATED (source basis).
 */
export const DEFEND_LEASH_TILES = 6;

/**
 * FLEE stance — how many tiles a fleeing unit runs **away** from the nearest threat each time it re-aims:
 * the flee destination is the walkable cell this far off in the best away-direction. APPROXIMATED — no
 * readable flee-distance (source basis "Combat flee").
 */
export const FLEE_STEP_TILES = 6;

/**
 * FLEE stance — how many ticks a fleeing unit holds its current run route before re-aiming away from the
 * (moving) threat. The flee twin of {@link REPATH_CADENCE}: a per-tick re-path of every fleer would be the
 * RTS-scale regression golden rule 7 forbids; between re-aims the unit runs its last route (the run gait
 * keeps it ahead of a walking pursuer). OUR design (source basis "Combat flee").
 */
export const FLEE_REPATH_CADENCE = 6;

/**
 * FLEE stance — how many ticks a fleeing unit must go with **no threat in sight** before it stops running
 * and returns to the economy (the cool-down). Prevents a unit twitching in and out of flee as a threat
 * flickers at the sight edge. APPROXIMATED (source basis "Combat flee").
 */
export const FLEE_COOLDOWN_TICKS = 40;

/**
 * The need level (fixed-point, in [0, ONE]) at or above which a **collapsing** hunger/fatigue overrides the
 * FLEE drive — a settler this close to starving/collapsing stops to eat/sleep even in danger (the AISystem's
 * need drive then owns it), while every lesser need yields to the flee. Set well ABOVE the ¾ eat/sleep
 * thresholds (a fleeing settler skips normal meals but not a near-death one). APPROXIMATED (source basis
 * "Combat flee"): the original's flee-vs-need arbitration is unreadable.
 */
const NEED_COLLAPSE_THRESHOLD: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20)); // 0.95·ONE

/** The eight compass directions (canonical order) a fleeing unit considers running toward — the best
 *  (farthest-from-threat, walkable) one is chosen, so an obstacle in the straight-away direction diverts
 *  the run deterministically rather than freezing it. Mirrors the herd-scatter direction set. */
const FLEE_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

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
    // Lingering combat state must always be resolved (disengage / reap / clear the order / wind a flee
    // cool-down down), independent of whether a live enemy remains — so its presence alone keeps the
    // system awake this tick.
    if (world.has(e, Engagement) || world.has(e, AttackOrder) || world.has(e, Anger) || world.has(e, Fleeing))
      return true;
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
 * Resolve and act on one combatant's engagement this tick — now **stance-gated** for owned units: pick a
 * target and swing / chase / defend / flee / disengage per its {@link Stance} military mode. The gates:
 *  - **busy** (a {@link CurrentAtomic} running) or **dead** (`hitpoints <= 0`) → leave it (a mid-swing unit
 *    plays out; a felled-but-unreaped one gets no swing from beyond the grave);
 *  - **live player MOVE order** (a {@link PlayerOrder}, not an {@link AttackOrder}) → leave it (the human's
 *    "go there and hold" suppresses ALL auto-behavior — engage AND flee — until the hold lapses);
 *  - **FLEE** ({@link Stance} `FLEE`, no attack order) → run from the nearest threat ({@link fleeDrive}),
 *    re-evaluated even while travelling (to track a moving threat / wind the cool-down down);
 *  - **IGNORE** (or the passive `NONE`) → never auto-engage; a HUNTER is the exception (its catchable-prey
 *    predation survives the IGNORE gate), everything else disengages and waits for an explicit order;
 *  - **travelling and neither engaged nor ordered** → leave it (don't hijack an economy walk; an engaged /
 *    ordered / DEFEND-returning unit IS re-evaluated so a chaser stops-and-swings the instant it's in reach);
 *  - **attacker eligibility** — an unowned passive animal runs no attack drive (also reaps a lapsed
 *    {@link Anger}); **unarmed** → disengage;
 *  - else resolve a target under the stance's {@link engageSpec} (ATTACK: sight; DEFEND: anchor radius;
 *    IGNORE-hunter: prey) and swing (in reach) / chase (owned, leashed for DEFEND) / return-to-anchor
 *    (DEFEND, none) / disengage (none).
 * Unowned combatants carry no Stance and keep the legacy content-relation behaviour (swing-in-place).
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
  let ordered = world.has(e, AttackOrder);
  // A live PLAYER MOVE order (a {@link PlayerOrder}, and NOT an explicit {@link AttackOrder}) is the human's
  // authoritative "go there and HOLD" command — it SUPPRESSES auto-behavior (auto-engage AND flee) so the
  // unit carries the order out. `moveUnit` clears any prior Engagement/AttackOrder/Fleeing, so an ordered
  // unit holds cleanly; an explicit AttackOrder is the OPPOSITE intent (fight THAT one) and still engages.
  if (world.has(e, PlayerOrder) && !ordered) return;

  const attacker = world.get(e, Settler);
  // An explicit attack order that has OUTLIVED its target (dead / no longer a valid hostile) is dropped
  // HERE, before the stance dispatch, so the unit re-decides by its STANCE this tick — an IGNORE scout goes
  // back to ignoring, a FLEE civilian to fleeing, a DEFEND guard to its post — instead of the order's
  // now-stale general-hostility spec falling through to a one-tick ATTACK-style re-acquire regardless of
  // stance. An ATTACK unit still re-acquires the nearest enemy the SAME tick (its own stance path does).
  if (ordered && !isValidTarget(world, ctx, e, attacker, world.get(e, AttackOrder).target)) {
    world.remove(e, AttackOrder);
    ordered = false;
  }
  // The unit's military stance drives its auto-behavior. Unowned combatants carry no Stance — modelled as
  // `null`, they keep the legacy content-relation behaviour (swing an in-reach enemy, no advance/flee).
  const stance = owned ? stanceMode(world, e, attacker.jobType) : null;

  // FLEE — run from the nearest threat. Runs even while travelling (re-evaluated each tick to track a
  // moving threat and wind the cool-down down). An explicit attack order overrides the flee mode. A unit
  // that has STOPPED fleeing (stance changed, or an order took over) sheds the flee state + its run route.
  const willFlee = stance === MILITARY_MODE.FLEE && !ordered;
  if (world.has(e, Fleeing) && !willFlee) {
    world.remove(e, Fleeing);
    clearChase(world, e);
  }
  if (willFlee) {
    // A fleeing unit is NOT attack-engaged: shed any Engagement left from a prior ATTACK/DEFEND chase (e.g.
    // `setStance(FLEE)` issued mid-chase). Without this the stale marker outlives the flee — once the threat
    // clears, `fleeDrive` drops `Fleeing` but not `Engagement`, benching the unit (aiSystem skips it) and
    // keeping combat awake forever. The `Fleeing` marker (not `Engagement`) is what holds a fleer off the economy.
    world.remove(e, Engagement);
    fleeDrive(world, ctx, terrain, index, e, attacker);
    return;
  }

  // IGNORE (and the passive NONE, normalized to IGNORE by {@link stanceMode}) — never auto-engage a hostile
  // enemy; only an explicit attack order fights. A HUNTER is exempt: its catchable-prey predation is an
  // economic drive independent of the military mode, so it falls through to the engage path (with a
  // predation-only target filter, {@link engageSpec}).
  if (stance === MILITARY_MODE.IGNORE && !ordered && attacker.jobType !== HUNTER_JOB) {
    disengage(world, e);
    return;
  }

  const engaged = world.has(e, Engagement);
  const travelling = world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
  // A travelling unit that is not yet fighting is walking under another drive (an economy walk, or a DEFEND
  // unit heading back to its anchor) — don't yank it into combat. An engaged/ordered unit is re-checked
  // even while moving.
  if (travelling && !engaged && !ordered) return;

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
  const spec = engageSpec(world, ctx, terrain, e, owned, ordered, stance, attacker, weapon);
  const found = resolveTarget(world, ctx, terrain, index, e, here, attacker, spec);
  if (found === null) {
    // No target: a DEFEND unit walks back to its anchor (holding its post); everyone else disengages back
    // to the economy.
    if (spec.defend !== null) returnToAnchor(world, e, here, spec.defend.anchorCell);
    else disengage(world, e);
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
  // branch is unreachable for unowned — kept explicit for the owned chase). A DEFEND chase is leashed to
  // the anchor (`spec.defend`), so it never pursues far.
  if (!owned) {
    disengage(world, e);
    return;
  }
  chase(world, ctx, terrain, e, here, target, weapon, ordered, spec.defend);
}

/**
 * The military mode an owned combatant acts under — its {@link Stance} `mode`, or (defensively, if the
 * component is somehow missing) the job's {@link defaultStanceForJob}. `NONE` (an unset mode the defaults
 * never produce) is normalized to the passive {@link MILITARY_MODE.IGNORE} so a stray value never becomes
 * an accidental aggressor. Pure component read, no RNG/wall-clock.
 */
function stanceMode(world: World, e: Entity, jobType: number | null): number {
  const s = world.tryGet(e, Stance);
  const mode = s === undefined ? defaultStanceForJob(jobType) : s.mode;
  return mode === MILITARY_MODE.NONE ? MILITARY_MODE.IGNORE : mode;
}

/**
 * How a combatant acquires a target this tick, resolved from its stance — the ring-search `accept` filter,
 * the near/far reach band (`minDist`/`searchRadius`), and (DEFEND only) the anchor leash the chase respects.
 *  - **DEFEND** (auto, not ordered) → accept only hostile targets within {@link DEFEND_RADIUS_TILES} of the
 *    anchor, spot within `radius + leash`, and carry the anchor+leash so {@link chase} never pursues past it.
 *  - **IGNORE hunter** → accept only catchable **prey** ({@link isHuntTarget}) — the predation that survives
 *    the IGNORE gate — spotted within the sight radius.
 *  - **ATTACK / ordered / unowned** → general hostility ({@link isValidTarget}); an owned unit spots within
 *    its {@link SIGHT_RADIUS_TILES} (it advances), an unowned one only within weapon reach (swing-in-place).
 * The `minDist` is the weapon's near reach (a ranged weapon's dead zone) in every case.
 */
function engageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  owned: boolean,
  ordered: boolean,
  stance: number | null,
  attacker: { tribe: number; jobType: number | null },
  weapon: { minRange: number; maxRange: number },
): EngageSpec {
  const generalAccept = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t);
  const minDist = weapon.minRange;
  const sight = Math.max(weapon.maxRange, SIGHT_RADIUS_TILES);

  if (owned && !ordered && stance === MILITARY_MODE.DEFEND) {
    const anchor = defendAnchor(world, terrain, e);
    const accept = (t: Entity): boolean =>
      generalAccept(t) && manhattan(terrain, anchor, entityCell(world, terrain, t)) <= DEFEND_RADIUS_TILES;
    return {
      accept,
      minDist,
      searchRadius: DEFEND_RADIUS_TILES + DEFEND_LEASH_TILES,
      defend: { anchorCell: anchor, leash: DEFEND_LEASH_TILES },
    };
  }

  if (owned && !ordered && stance === MILITARY_MODE.IGNORE && attacker.jobType === HUNTER_JOB) {
    const accept = (t: Entity): boolean => isHuntTarget(world, ctx, t, attacker.jobType);
    return { accept, minDist, searchRadius: sight, defend: null };
  }

  return { accept: generalAccept, minDist, searchRadius: owned ? sight : weapon.maxRange, defend: null };
}

/** The DEFEND anchor cell — the {@link Stance}'s captured `anchorCell` (the tile the stance was set on),
 *  falling back to the unit's own cell if it somehow carries none (a DEFEND stamped before it had a tile). */
function defendAnchor(world: World, terrain: TerrainGraph, e: Entity): CellId {
  const anchor = world.tryGet(e, Stance)?.anchorCell;
  return (anchor ?? entityCell(world, terrain, e)) as CellId;
}

/** Send a DEFEND unit back to its anchor when no enemy is in its defend radius: drop the {@link Engagement}
 *  (it is no longer fighting) and either hold in place (already home — clear any stale route) or walk home
 *  (a fresh {@link MoveGoal} to the anchor). Combined with the leash in {@link chase}, this is the "engage
 *  in a radius, don't chase far, return to post" behaviour of the DEFEND mode. */
function returnToAnchor(world: World, e: Entity, here: CellId, anchorCell: CellId): void {
  world.remove(e, Engagement);
  clearChase(world, e);
  if (here !== anchorCell) world.add(e, MoveGoal, { cell: anchorCell });
}

/**
 * The FLEE drive — run a unit away from the nearest threat (the civilian raid reaction). Reuses the combat
 * ring-search index (no new scan, golden rule 7): the nearest hostile within {@link SIGHT_RADIUS_TILES} is
 * the threat. Then, in order:
 *  - **no threat in sight** → wind the cool-down down: start it on the first clear tick, and after
 *    {@link FLEE_COOLDOWN_TICKS} clear with none, shed {@link Fleeing} + the run route so the economy
 *    re-tasks the unit; while cooling down it holds its last route. A unit that was never fleeing does
 *    nothing (the economy owns it).
 *  - **a collapsing need** ({@link needCollapsing}) → a near-death hunger/fatigue overrides the flee: on the
 *    transition out of fleeing (Fleeing still set) shed the marker + run route so the AISystem's eat/sleep
 *    drive owns the unit; once yielded, leave that need-walk untouched (don't cancel it each tick).
 *  - **flee** → stamp/refresh {@link Fleeing} (calmUntil null = in danger), and — throttled to
 *    {@link FLEE_REPATH_CADENCE}, or immediately on a failed route — re-aim to a walkable cell
 *    {@link FLEE_STEP_TILES} away in the best direction AWAY from the threat ({@link fleeDestination}). The
 *    MovementSystem walks a Fleeing unit at the faster run gait, so it outpaces a walking pursuer.
 */
function fleeDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: TileBuckets,
  e: Entity,
  attacker: { tribe: number; jobType: number | null },
): void {
  // A COLLAPSING need (near-death hunger/fatigue) overrides the flee whether or not a threat is in sight —
  // the settler stops to eat/sleep even in danger, and doesn't sit idle through the cool-down after a
  // threat leaves. Yield only on the transition (Fleeing still set): shed the marker + the run route so the
  // AISystem re-tasks the unit; once yielded (no marker) leave the need-walk alone so we don't cancel the
  // eat/sleep goal the AI sets each tick. (Checked FIRST so it wins over both the threat and the cool-down.)
  if (needCollapsing(world, e)) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearChase(world, e);
    }
    return;
  }

  const here = entityCell(world, terrain, e);
  const { x, y } = terrain.coordsOf(here);
  const accept = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t);
  // Near bound 0 (not the weapon-reach floor of 1): fear has no dead zone — a fleeing unit reacts to a
  // hostile on its very tile too (entities share tiles freely), not just one a step away.
  const threat = index.nearest(x, y, 0, SIGHT_RADIUS_TILES, accept);
  const fleeing = world.tryGet(e, Fleeing);

  if (threat === null) {
    if (fleeing === undefined) return; // never in danger — the economy owns this unit
    if (fleeing.calmUntil === null) fleeing.calmUntil = ctx.tick + FLEE_COOLDOWN_TICKS;
    if (ctx.tick >= fleeing.calmUntil) {
      world.remove(e, Fleeing); // safe long enough — return to work
      clearChase(world, e);
    }
    return;
  }

  const f = world.add(e, Fleeing, { repathAt: fleeing?.repathAt ?? ctx.tick, calmUntil: null });
  const travelling = world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
  if (world.tryGet(e, PathRequest)?.failed) {
    clearChase(world, e); // the last flee route was unreachable — re-aim now
  } else if (travelling && ctx.tick < f.repathAt) {
    return; // still running a live route — re-aim only on the throttle
  }

  const dest = fleeDestination(terrain, here, entityCell(world, terrain, threat.entity));
  clearChase(world, e);
  if (dest !== here) world.add(e, MoveGoal, { cell: dest }); // dest === here ⇒ boxed in, stand and hope
  f.repathAt = ctx.tick + FLEE_REPATH_CADENCE;
}

/** The cell a fleeing unit should run to: the walkable cell {@link FLEE_STEP_TILES} away (of the eight
 *  compass directions) that is FARTHEST from the threat, tie-broken by min cell id. It must strictly
 *  increase the distance from the threat over staying put, so a boxed-in unit (no away-cell walkable /
 *  in-bounds) returns its own cell (`here`) and stays rather than running toward the threat. A bounded
 *  8-way scan — deterministic (fixed direction order + min-id tie-break), no RNG. */
function fleeDestination(terrain: TerrainGraph, here: CellId, threatCell: CellId): CellId {
  const h = terrain.coordsOf(here);
  const t = terrain.coordsOf(threatCell);
  let best: CellId = here;
  let bestScore = Math.abs(h.x - t.x) + Math.abs(h.y - t.y); // a candidate must beat staying put
  for (const [dx, dy] of FLEE_DIRECTIONS) {
    const x = h.x + dx * FLEE_STEP_TILES;
    const y = h.y + dy * FLEE_STEP_TILES;
    if (!terrain.inBounds(x, y)) continue;
    const cell = terrain.cellAt(x, y);
    if (!terrain.isWalkable(cell)) continue;
    const score = Math.abs(x - t.x) + Math.abs(y - t.y);
    if (score > bestScore || (score === bestScore && best !== here && cell < best)) {
      best = cell;
      bestScore = score;
    }
  }
  return best;
}

/** Whether `t` is catchable **prey** a hunter of `hunterJob` may strike — the predation-only target filter
 *  an IGNORE hunter uses (its animal-hunt drive survives the IGNORE gate, but it ignores player-hostility).
 *  A live, positioned, Health-bearing settler for which {@link mayHunt} holds. */
function isHuntTarget(world: World, ctx: SystemContext, t: Entity, hunterJob: number | null): boolean {
  if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  return mayHunt(ctx.content, hunterJob, world.get(t, Settler).tribe);
}

/** Whether a settler's hunger or fatigue has reached the {@link NEED_COLLAPSE_THRESHOLD} — a near-death
 *  need that overrides the FLEE drive (the settler stops to eat/sleep even in danger). */
function needCollapsing(world: World, e: Entity): boolean {
  const s = world.get(e, Settler);
  return s.hunger >= NEED_COLLAPSE_THRESHOLD || s.fatigue >= NEED_COLLAPSE_THRESHOLD;
}

/** How a combatant acquires + reaches a target this tick, derived from its stance ({@link engageSpec}). */
interface EngageSpec {
  /** The ring-search per-candidate hostility/predation filter. */
  readonly accept: (t: Entity) => boolean;
  /** Near reach — the ring search ignores anything closer (a ranged weapon's dead zone). */
  readonly minDist: number;
  /** Far reach — how far the unit spots a target to swing at / advance on. */
  readonly searchRadius: number;
  /** DEFEND leash: the chase never walks past `leash` of `anchorCell`; null for every non-DEFEND mode. */
  readonly defend: { readonly anchorCell: CellId; readonly leash: number } | null;
}

/**
 * The enemy this combatant fights this tick (with its Manhattan distance from `here`, so the caller
 * needn't recompute it), or null:
 *  - under an explicit {@link AttackOrder} → that focused `target`, chased regardless of sight, as long as
 *    it is a live, hostile combatant; a target that has died / become an invalid target drops the order and
 *    falls through to auto-engagement (so the unit re-acquires a nearby enemy rather than going idle);
 *  - otherwise → the nearest target the ring search finds within `[spec.minDist, spec.searchRadius]` that
 *    the stance's `spec.accept` filter admits (general hostility for ATTACK/unowned, anchor-bounded for
 *    DEFEND, catchable prey for an IGNORE hunter — see {@link engageSpec}).
 */
function resolveTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: TileBuckets,
  self: Entity,
  here: CellId,
  attacker: { tribe: number; jobType: number | null },
  spec: EngageSpec,
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
  const found = index.nearest(x, y, spec.minDist, spec.searchRadius, spec.accept);
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
  defend: { anchorCell: CellId; leash: number } | null,
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
  // DEFEND leash: never step past `leash` tiles from the anchor to reach an enemy — a target hittable only
  // by breaking the leash is left alone, and the defender walks back to its post instead of pursuing.
  if (defend !== null && manhattan(terrain, defend.anchorCell, dest) > defend.leash) {
    returnToAnchor(world, e, here, defend.anchorCell);
    return;
  }
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
  const animation = atomicAnimationName(ctx.content, attacker, ATTACK_ATOMIC_ID);
  const hitAt =
    animation === undefined ? undefined : atomicEventFrame(ctx.content, animation, ATOMIC_EVENT_TYPE_ATTACK);
  // A RANGED weapon (a bow/catapult — `munitiontype` present) with a positive travel `speed` fires a
  // PROJECTILE at the release frame instead of landing the blow in place. The `projectile` payload rides
  // on the `attack` effect so the executor launches it at `hitAt`; a ranged weapon missing its `speed`
  // (malformed content) or a melee weapon falls back to the in-place hit (no `projectile` key).
  const projectile =
    isRangedWeapon(weapon) &&
    weapon.speed !== undefined &&
    weapon.speed > 0 &&
    weapon.munitionType !== undefined
      ? { munitionType: weapon.munitionType, speed: weapon.speed }
      : undefined;
  world.add(e, CurrentAtomic, {
    atomicId: ATTACK_ATOMIC_ID,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: atomicDurationForName(ctx.content, animation),
    effect: {
      kind: 'attack',
      target,
      damage,
      // Omit an absent hit-frame / mainType / projectile so a melee weapon+animation that carries none
      // yields the exact `{ kind, target, damage }` effect (no `undefined`-valued keys) — the
      // fallback-to-completion, no-XP, and melee-hit paths are the absence of the field, not a sentinel.
      ...(hitAt !== undefined ? { hitAt } : {}),
      ...(weapon.mainType !== undefined ? { weaponMainType: weapon.mainType } : {}),
      ...(projectile !== undefined ? { projectile } : {}),
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
