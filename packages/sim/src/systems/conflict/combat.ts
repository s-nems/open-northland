import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import { standingFighterNodes } from '../movement/separation.js';
import {
  HUNTER_JOB,
  MILITARY_MODE,
  defaultStanceForJob,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import {
  NodeBuckets,
  canonicalById,
  clearNavState,
  entityNode,
  isTravelling,
  manhattan,
} from '../spatial.js';
import { fleeDrive } from './flee.js';
import { SIGHT_RADIUS_NODES, hostileAnimalNow, isHuntTarget, isValidTarget } from './targeting.js';
import { attackerWeapon, startAttack, targetMaterial } from './weapons.js';

// Re-exported so the public surface (the systems barrel + tests) keeps its single combat import
// site after the conflict/ split (targeting.ts and flee.ts stay internal).
export { SIGHT_RADIUS_NODES } from './targeting.js';

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
 *  2. **Spatial index** — all combatants are bucketed by tile ONCE ({@link NodeBuckets}), so a seeker's
 *     "nearest enemy" query is a bounded grid RING SEARCH ({@link NodeBuckets.nearest}) instead of an
 *     O(entities) full scan per seeker (the historical plan tier-3 ring-search consumer).
 *  3. **Per combatant** ({@link engageCombatant}) — act on the unit's {@link Stance} military mode (owned
 *     units; the original's `MILITARY_MODE`): **ATTACK** auto-acquires the nearest enemy in sight and
 *     swings (in the weapon reach band) or chases (beyond it, throttled to {@link REPATH_CADENCE});
 *     **DEFEND** engages only within {@link DEFEND_RADIUS_NODES} of an anchor and never chases past
 *     {@link DEFEND_LEASH_NODES}, returning to post when clear; **IGNORE** never auto-engages (a hunter
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
 * approximated {@link SIGHT_RADIUS_NODES} is how far an owned combatant SPOTS an enemy to advance on. An
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
  const index = new NodeBuckets(world, combatants);

  // The tick's MELEE-SLOT state (see {@link approachCell}): `standing` is the standing-collider node
  // set (built lazily — a tick with no chaser pays nothing), `claimed` the approach cells already
  // dealt out this tick. Chasers are served in the canonical combatant order, so slot assignment is
  // deterministic; the sets are per-tick derived state, never hashed.
  const slots: MeleeSlots = { claimed: new Set() };
  for (const e of combatants) {
    engageCombatant(world, ctx, terrain, index, slots, e);
  }
};

/** Per-combat-tick melee-slot state: the lazily-built standing-body node set plus this tick's
 *  already-claimed approach cells. */
interface MeleeSlots {
  standing?: ReadonlySet<NodeId>;
  readonly claimed: Set<NodeId>;
}

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one — the
 * chase repath throttle. A chaser tracks a MOVING enemy by re-pathing periodically, not every tick; a
 * per-tick full re-path of every chaser would be the RTS-scale regression golden rule 7 forbids (and
 * would eat the pathfinder's per-tick node budget — `routing.ts`). Between repaths the unit
 * keeps walking its last route toward the enemy, and the swing check is distance-based (independent of the
 * path goal), so a slightly-stale route still delivers it into reach. OUR design (no oracle) —
 * source basis "Combat chase / repath cadence".
 */
export const REPATH_CADENCE = 8;

/**
 * DEFEND stance — how far (Manhattan half-cell nodes) from its **anchor** a defender auto-acquires an
 * enemy: it engages only threats inside this radius of the node the DEFEND stance was set on, ignoring
 * anything beyond (it holds its post rather than roaming). APPROXIMATED — the original's exact defend
 * radius is unreadable (source basis "Combat stances"); calibration-by-observation pending. Doubled
 * with the half-cell migration (same on-screen radius as the old 4-cell value).
 */
export const DEFEND_RADIUS_NODES = 8;

/**
 * DEFEND stance — the **leash**: the farthest (Manhattan nodes) from its anchor a defender will step to
 * strike an in-radius enemy. Kept a little above {@link DEFEND_RADIUS_NODES} so a melee defender can walk
 * up to a threat at the radius edge, but never chases far — a target reachable only by breaking the leash
 * is left alone and the defender returns to its anchor. APPROXIMATED (source basis).
 */
export const DEFEND_LEASH_NODES = 12;

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
 *  - **live player MOVE order** (a {@link PlayerOrder}, not an {@link AttackOrder}) → EN ROUTE it suppresses
 *    ALL auto-behavior (engage AND flee — the reposition is authoritative); once ARRIVED, the timed hold
 *    keeps gating only a PASSIVE (IGNORE/FLEE) unit — an ATTACK/DEFEND fighter keeps its combat drive and
 *    engaging hands the unit from the order to combat (it never stands waiting a timer out under attack);
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
  index: NodeBuckets,
  slots: MeleeSlots,
  e: Entity,
): void {
  if (world.has(e, CurrentAtomic)) return; // mid-swing / mid-need: play it out
  if (world.get(e, Health).hitpoints <= 0) return; // dead, not yet reaped — no free swing

  const owned = world.has(e, Owner);
  let ordered = world.has(e, AttackOrder);
  const attacker = world.get(e, Settler);
  // A live PLAYER MOVE order (a {@link PlayerOrder}, and NOT an explicit {@link AttackOrder}) is the human's
  // authoritative "go there" command. EN ROUTE (the hold hasn't begun) it suppresses ALL auto-behavior —
  // engage AND flee — so the reposition is carried out (ordering units PAST an enemy line routes around it,
  // never into a fight). Once ARRIVED, the hold gates only a PASSIVE unit: a fighter holding on
  // ATTACK/DEFEND keeps its combat drive — an enemy walks up and beats a timer-waiting unit to death
  // otherwise — and when it does engage, the chase/swing state it creates ends the order through
  // {@link playerOrderSystem}'s own rules (a clean handoff). `moveUnit` clears any prior
  // Engagement/AttackOrder/Fleeing, so an ordered unit starts its walk cleanly; an explicit AttackOrder is
  // the OPPOSITE intent (fight THAT one) and always engages.
  const moveOrder = world.tryGet(e, PlayerOrder);
  if (moveOrder !== undefined && !ordered) {
    if (moveOrder.expiresAt === null) return; // still walking the order out — the reposition is authoritative
    const mode = stanceMode(world, e, attacker.jobType);
    if (mode !== MILITARY_MODE.ATTACK && mode !== MILITARY_MODE.DEFEND) return; // passive: hold the spot blindly
  }
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
  const travelling = isTravelling(world, e);
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

  const here = entityNode(world, terrain, e);
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
  if (dist >= weapon.minRange && dist <= weapon.maxRange && !travelling) {
    // In the reach band AND standing: swing. The standstill gate matters for the FEEL of the swing —
    // node distances round to the nearest node, so a walker enters the band MID-STRIDE (half an edge
    // out); starting the swing there froze it off any node centre and the wind-up read as a glide/
    // teleport. Gated, the walker finishes its (braked) last leg onto the slot's centre and swings
    // from a standstill; an unowned unit never travels into combat, so its swing-in-place behaviour
    // is untouched. The clearChase is then just stale-goal hygiene for the owned arrival.
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
  chase(world, ctx, terrain, slots, e, here, target, weapon, ordered, spec.defend);
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
 *  - **DEFEND** (auto, not ordered) → accept only hostile targets within {@link DEFEND_RADIUS_NODES} of the
 *    anchor, spot within `radius + leash`, and carry the anchor+leash so {@link chase} never pursues past it.
 *  - **IGNORE hunter** → accept only catchable **prey** ({@link isHuntTarget}) — the predation that survives
 *    the IGNORE gate — spotted within the sight radius.
 *  - **ATTACK / ordered / unowned** → general hostility ({@link isValidTarget}); an owned unit spots within
 *    its {@link SIGHT_RADIUS_NODES} (it advances), an unowned one only within weapon reach (swing-in-place).
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
  const sight = Math.max(weapon.maxRange, SIGHT_RADIUS_NODES);

  if (owned && !ordered && stance === MILITARY_MODE.DEFEND) {
    const anchor = defendAnchor(world, terrain, e);
    const accept = (t: Entity): boolean =>
      generalAccept(t) && manhattan(terrain, anchor, entityNode(world, terrain, t)) <= DEFEND_RADIUS_NODES;
    return {
      accept,
      minDist,
      searchRadius: DEFEND_RADIUS_NODES + DEFEND_LEASH_NODES,
      defend: { anchorCell: anchor, leash: DEFEND_LEASH_NODES },
    };
  }

  if (owned && !ordered && stance === MILITARY_MODE.IGNORE && attacker.jobType === HUNTER_JOB) {
    const accept = (t: Entity): boolean => isHuntTarget(world, ctx, t, attacker.jobType);
    return { accept, minDist, searchRadius: sight, defend: null };
  }

  return { accept: generalAccept, minDist, searchRadius: owned ? sight : weapon.maxRange, defend: null };
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
  readonly defend: { readonly anchorCell: NodeId; readonly leash: number } | null;
}

/** The DEFEND anchor cell — the {@link Stance}'s captured `anchorCell` (the tile the stance was set on),
 *  falling back to the unit's own cell if it somehow carries none (a DEFEND stamped before it had a tile). */
function defendAnchor(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const anchor = world.tryGet(e, Stance)?.anchorCell;
  return (anchor ?? entityNode(world, terrain, e)) as NodeId;
}

/** Send a DEFEND unit back to its anchor when no enemy is in its defend radius: drop the {@link Engagement}
 *  (it is no longer fighting) and either hold in place (already home — clear any stale route) or walk home
 *  (a fresh {@link MoveGoal} to the anchor). Combined with the leash in {@link chase}, this is the "engage
 *  in a radius, don't chase far, return to post" behaviour of the DEFEND mode. */
function returnToAnchor(world: World, e: Entity, here: NodeId, anchorCell: NodeId): void {
  world.remove(e, Engagement);
  clearChase(world, e);
  if (here !== anchorCell) world.add(e, MoveGoal, { cell: anchorCell });
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
  index: NodeBuckets,
  self: Entity,
  here: NodeId,
  attacker: { tribe: number; jobType: number | null },
  spec: EngageSpec,
): { target: Entity; dist: number } | null {
  if (world.has(self, AttackOrder)) {
    const focus = world.get(self, AttackOrder).target;
    // An ordered target is chased regardless of sight, so measure its real distance (the ring search's
    // `searchRadius` cap does not apply); the swing/chase decision is on this distance.
    if (isValidTarget(world, ctx, self, attacker, focus)) {
      return { target: focus, dist: manhattan(terrain, here, entityNode(world, terrain, focus)) };
    }
    world.remove(self, AttackOrder); // target gone / no longer hostile — abandon the order, auto-engage
  }
  const { x, y } = terrain.coordsOf(here);
  const found = index.nearest(x, y, spec.minDist, spec.searchRadius, spec.accept);
  return found === null ? null : { target: found.entity, dist: found.distance };
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
  slots: MeleeSlots,
  e: Entity,
  here: NodeId,
  target: Entity,
  weapon: { minRange: number; maxRange: number },
  ordered: boolean,
  defend: { anchorCell: NodeId; leash: number } | null,
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

  const travelling = isTravelling(world, e);
  if (travelling && ctx.tick < engagement.repathAt) return; // still closing on a live route — don't re-path

  const dest = approachCell(
    terrain,
    here,
    entityNode(world, terrain, target),
    weapon.minRange,
    weapon.maxRange,
    (cell) => {
      slots.standing ??= standingFighterNodes(world, terrain);
      return slots.standing.has(cell) || slots.claimed.has(cell);
    },
  );
  if (dest === null) {
    // Every walkable cell of the target's reach band is a TAKEN SLOT (a standing body, or dealt to
    // an earlier chaser this tick): SECOND RANK. Stand fast behind the fight — a stationary body,
    // not a walker grinding into the first rank's backs — and re-ask at the chase cadence; the slot
    // check naturally admits it the moment a front-liner falls or steps off. This (with the id-order
    // slot deal above) is what turns a converging mass into ranks instead of a pile.
    clearChase(world, e);
    engagement.repathAt = ctx.tick + REPATH_CADENCE;
    return;
  }
  // DEFEND leash: never step past `leash` tiles from the anchor to reach an enemy — a target hittable only
  // by breaking the leash is left alone, and the defender walks back to its post instead of pursuing.
  if (defend !== null && manhattan(terrain, defend.anchorCell, dest) > defend.leash) {
    returnToAnchor(world, e, here, defend.anchorCell);
    return;
  }
  if (dest === here && !travelling) {
    // STANDING on its own best approach cell yet out of range (else it would have swung, not chased) —
    // the target can't be closed on (boxed into an unwalkable pocket, or the two are stacked on one
    // cell with no free approach). Give up rather than loop engaged-but-frozen: `disengage` drops the
    // Engagement + chase state AND any AttackOrder (an unreachable ordered target). Next tick the unit
    // re-acquires another enemy, or the economy relocates it (which also breaks a shared-tile stall) —
    // so it never stays stuck. Only reachable on obstructed terrain when standing: an all-walkable map
    // always yields a band cell. A TRAVELLING unit whose truncated node already reads as a free band
    // cell (mid-stride onto it) is NOT boxed in — it falls through and aims its live route there, so
    // it finishes the step, stops on the centre, and swings next pass (the standstill-swing rule).
    disengage(world, e);
    return;
  }
  // Re-aim the LIVE route instead of dropping it — the moveUnit redirect pattern: keep any PathFollow
  // (the walker keeps full stride this tick), drop only a stale in-flight request, and swap the goal;
  // the navigation planner re-routes from where the walker stands and the routing splice carries the
  // gait + heading through the turn (movement inertia). Clearing the nav state here instead reset the
  // gait to zero every {@link REPATH_CADENCE} ticks, so a chaser lurched cell-by-cell — accelerate,
  // brake, stall — rather than running its target down (the reported chase stutter). An unchanged
  // goal is left entirely alone so a same-dest request keeps its place in the routing queue.
  if (world.tryGet(e, MoveGoal)?.cell !== dest) {
    world.remove(e, PathRequest);
    world.add(e, MoveGoal, { cell: dest });
  }
  slots.claimed.add(dest); // this slot is dealt — the tick's later chasers aim at the next free cell
  engagement.repathAt = ctx.tick + REPATH_CADENCE;
}

/** The cell a chaser should walk to in order to bring `target` into its weapon band: the FREE walkable
 *  cell (not a taken melee slot — `isTaken`: a standing body, or already dealt to an earlier chaser this
 *  tick) whose Manhattan distance to the target is in `[minRange, maxRange]` and which is CLOSEST to the
 *  unit (`from`), canonical (min distance, then min cell id). So a melee unit stops one cell short of the
 *  enemy (distance in-band, hittable) instead of walking onto it (distance 0, below every weapon's near
 *  reach — which would deadlock), and a MASS of chasers is dealt DISTINCT contact cells around the target
 *  instead of all converging on the same one — the melee-slot rule that spreads a large fight along the
 *  whole band. Returns `null` when the band has walkable cells but every one is taken (a full front —
 *  the chaser should hold as a second rank); falls back to the target's own cell when NO in-band cell is
 *  walkable at all (a boxed-in target; the chase then closes and the swing/disengage logic re-decides).
 *  A bounded scan of the band box around the target — O((2·maxRange+1)²), tiny for melee — deterministic
 *  (fixed order + min-id tie-break). */
function approachCell(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  minRange: number,
  maxRange: number,
  isTaken: (cell: NodeId) => boolean,
): NodeId | null {
  const t = terrain.coordsOf(targetCell);
  const f = terrain.coordsOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let anyWalkable = false;
  for (let dy = -maxRange; dy <= maxRange; dy++) {
    for (let dx = -maxRange; dx <= maxRange; dx++) {
      const band = Math.abs(dx) + Math.abs(dy);
      if (band < minRange || band > maxRange) continue; // not in the target's reach band
      const x = t.x + dx;
      const y = t.y + dy;
      if (!terrain.inBounds(x, y)) continue;
      const cell = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(cell)) continue;
      anyWalkable = true;
      if (isTaken(cell)) continue; // an occupied melee slot — someone already fights (or was dealt) here
      const d = Math.abs(x - f.x) + Math.abs(y - f.y); // distance from the unit to this candidate cell
      if (d < bestDist || (d === bestDist && (best === null || cell < best))) {
        best = cell;
        bestDist = d;
      }
    }
  }
  if (best !== null) return best;
  return anyWalkable ? null : targetCell;
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
  clearNavState(world, e);
}
