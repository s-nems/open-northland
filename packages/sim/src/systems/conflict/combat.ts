import {
  Anger,
  AttackOrder,
  Building,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import {
  HUNTER_JOB,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  MILITARY_MODE,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import { canonicalById, clearNavState, entityNode, isTravelling, NodeBuckets } from '../spatial.js';
import { chase, disengage, type MeleeSlots, returnToAnchor } from './chase.js';
import { type CombatantStance, engageSpec, resolveTarget, stanceMode } from './engagement.js';
import { fleeDrive } from './flee.js';
import { HostilePresence } from './presence.js';
import { type BuildingBodyNodeCache, buildingBodyNodes, combatTargetNode } from './target-node.js';
import { hostileAnimalNow, isValidTarget } from './targeting.js';
import { attackerWeapon, startAttack, targetMaterial } from './weapons.js';

// Re-exported so the public surface (the systems barrel + tests) keeps its single combat import
// site after the conflict/ split (targeting.ts, flee.ts, engagement.ts, and chase.ts stay internal).
export { REPATH_CADENCE } from './chase.js';
export { DEFEND_LEASH_NODES, DEFEND_RADIUS_NODES } from './engagement.js';
export { SIGHT_RADIUS_NODES } from './targeting.js';

/**
 * CombatSystem — the combat loop's decision stage: for each combatant, pick who to fight and either swing at
 * an enemy in reach or advance on one spotted but out of reach. The AtomicSystem's `attack` effect lands the
 * hit and the CleanupSystem reaps the felled. A combatant is a {@link Settler} carrying a {@link Health}
 * pool, so the system is inert on non-combat settlers. Each tick:
 *
 *  1. Dormancy gate ({@link combatPossible}) — one cheap pass decides whether any hostile pair (or any
 *     lingering combat state to clean up) exists; if not, a map of peaceful settlers, or an all-one-player
 *     field, costs nothing (the RTS-scale budget).
 *  2. Spatial index — all combatants are bucketed by tile once ({@link NodeBuckets}), so a seeker's
 *     "nearest enemy" query is a bounded grid ring search ({@link NodeBuckets.nearest}) instead of an
 *     O(entities) full scan per seeker. The search finishes the whole minimum-distance band and picks
 *     (distance, then id) — the same winner a full scan would, so the pick stays order-independent.
 *  3. Per combatant ({@link engageCombatant}) — act on the unit's {@link Stance} military mode (owned units;
 *     the original's `MILITARY_MODE`): ATTACK auto-acquires the nearest enemy in sight and swings (in the
 *     weapon reach band) or chases (beyond it, throttled to {@link REPATH_CADENCE}); DEFEND engages only
 *     within {@link DEFEND_RADIUS_NODES} of an anchor and never chases past {@link DEFEND_LEASH_NODES},
 *     returning to post when clear; IGNORE never auto-engages (a hunter still hunts prey); FLEE paths away
 *     from the nearest threat ({@link fleeDrive}). An explicit {@link AttackOrder} overrides the mode.
 *     Unowned combatants carry no Stance and swing in place.
 *
 * Two hostility axes compose into the {@link mayTarget} relation:
 *  - Owner (player) hostility — two owned combatants of different players are enemies, same player friendly,
 *    so a player's mixed-tribe army never fights itself. Binary: no diplomacy/alliances.
 *  - Tribe hostility + predation + provoked anger ({@link mayAttack}/{@link mayHunt}/{@link Anger}) — the
 *    content relations for any pair where at least one side is unowned: civ-vs-civ by tribe,
 *    civ⇄aggressive-animal, hunter→catchable-prey, and a struck `getAngry` animal fighting back.
 *
 * Two reach radii: the weapon's extracted `[minRange, maxRange]` band is where a swing lands, while the
 * approximated {@link SIGHT_RADIUS_NODES} is how far an owned combatant spots an enemy to advance on. An
 * unowned combatant has no advance drive (its search radius is just `maxRange`).
 */
export const combatSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure reach over
  const terrain = ctx.terrain;

  // The dormancy gate runs over the raw (unsorted) query: it is order-independent (Set membership + a
  // boolean any-match), so an idle standing army pays only an O(combatants) scan, not the O(c log c)
  // canonical sort, on a tick with no fight.
  if (!combatPossible(world, ctx, world.query(Settler, Health, Position))) return;

  // The seekers (who decide + swing) are settlers; the SCAN order and the ring-search index are built from
  // the canonical (ascending-id) list, so a distance/first-match tie-break lands on the same winner.
  const combatants = canonicalById(world.query(Settler, Health, Position));
  // Attackable buildings JOIN the target index (never the seeker loop): a warrior can strike an enemy
  // building, but a building never engages. Both index and presence bucket a building at its wall cells
  // (buildingBodyNodes) — the faces a warrior reaches it from — so the reach math and the coarse early-out
  // agree with the chase target. The merged list stays canonical so ring-search ties are stable.
  const buildingTargets = attackableBuildings(world);
  const targets = canonicalById([...combatants, ...buildingTargets]);
  // A building never moves within a tick, so its wall nodes are memoized once and shared by the index/
  // presence build and every chaser's reach + chase resolution (combatTargetNode), instead of re-translating
  // the footprint per lookup.
  const bodyNodes: BuildingBodyNodeCache = new Map();
  // A unit buckets at its own node; a building at EVERY wall cell (buildingBodyNodes), so a ring search
  // finds it at the distance to its nearest face and a seeker near any side wakes to it — the siege spreads
  // around the whole footprint instead of queueing at one door.
  const nodesOf = (e: Entity): { x: number; y: number }[] => {
    if (!world.has(e, Building)) return [terrain.coordsOf(entityNode(world, terrain, e))];
    return buildingBodyNodes(world, ctx, terrain, e, bodyNodes).map((n) => terrain.coordsOf(n));
  };
  const index = new NodeBuckets(world, targets, undefined, nodesOf);
  // The coarse presence grid — the owned seekers' "any enemy possibly in range?" early-out, so a
  // standing army on a peaceful two-player map skips its per-fighter ring searches (golden rule 6). It
  // spans buildings too, so a lone army near an undefended enemy base still wakes to raze it.
  const presence = new HostilePresence(world, targets, undefined, nodesOf);

  // The tick's melee-slot state (see {@link approachCell}); `standing` is built lazily, so a tick with no
  // chaser pays nothing. Chasers are served in the canonical combatant order, so slot assignment is
  // deterministic; the sets are per-tick derived state, never hashed.
  const slots: MeleeSlots = { claimed: new Set() };
  for (const e of combatants) {
    engageCombatant(world, ctx, terrain, index, presence, slots, bodyNodes, e);
  }
};

/** The live enemy-attackable buildings this tick — a built or half-built structure carrying a Health pool
 *  still above 0. They join the combat TARGET index (a warrior may strike them) but never the seeker loop
 *  (a building never fights back — defensive fire is a separate, deferred feature). Canonical ascending-id. */
function attackableBuildings(world: World): Entity[] {
  return canonicalById(world.query(Building, Health, Position)).filter(
    (e) => world.get(e, Health).hitpoints > 0,
  );
}

/**
 * The dormancy gate: whether any combat work is possible this tick — a cheap single pass over the combatants.
 * Combat runs if any of:
 *  - a combatant already carries combat state ({@link Engagement}/{@link AttackOrder}/{@link Anger}) that
 *    must be resolved (disengaged, cleared, or an expired anger timer reaped) even with no live enemy;
 *  - **≥2 distinct player owners** are present (a possible player-vs-player fight);
 *  - **≥2 distinct civilization tribes** are present (a possible civ-vs-civ fight — the unowned scenarios);
 *  - a **hostile (aggressive) animal** and a **civilization** are both present (civ⇄animal aggression);
 *  - a **hunter** and a **catchable** animal are both present (a possible hunt).
 *
 * Conservative — it may pass on a tick where the two hostile sides are out of range (combat then simply finds
 * no target), but it never skips a tick where a fight or a cleanup is due.
 */
function combatPossible(world: World, ctx: SystemContext, combatants: Iterable<Entity>): boolean {
  const owners = new Set<number>();
  const civTribes = new Set<number>();
  let hasCiv = false;
  let hasHostileAnimal = false;
  let hasHunter = false;
  let hasCatchable = false;
  for (const e of combatants) {
    // Lingering combat state must be resolved (disengage / reap / clear the order / wind a flee cool-down
    // down) even with no live enemy left, so its presence alone keeps the system awake this tick.
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
  // A warrior sieging an enemy building is a fight even with no enemy UNIT present: an owned unit plus an
  // attackable building of a different player wakes the system. Reached only when no unit-vs-unit / animal
  // trigger fired above, and skipped entirely when no owned unit exists (buildings ≪ units — a cheap tail).
  if (owners.size >= 1) {
    for (const b of world.query(Building, Health, Position)) {
      const owner = world.tryGet(b, Owner);
      if (owner === undefined || world.get(b, Health).hitpoints <= 0) continue;
      for (const u of owners) if (u !== owner.player) return true;
    }
  }
  return false;
}

/**
 * Resolve and act on one combatant's engagement this tick — stance-gated for owned units: pick a target and
 * swing / chase / defend / flee / disengage per its {@link Stance} military mode. The gates, in order:
 *  - **busy** (a {@link CurrentAtomic} running) or **dead** (`hitpoints <= 0`) → leave it (a mid-swing unit
 *    plays out; a felled-but-unreaped one gets no swing from beyond the grave);
 *  - **live player move order** (a {@link PlayerOrder}, not an {@link AttackOrder}) → it suppresses all
 *    auto-behavior en route (engage and flee — the reposition is authoritative) and dies on arrival, so the
 *    unit's own stance takes over at the spot;
 *  - **FLEE** ({@link Stance} `FLEE`, no attack order) → run from the nearest threat ({@link fleeDrive}),
 *    re-evaluated even while travelling (to track a moving threat / wind the cool-down down);
 *  - **IGNORE** (or the passive `NONE`) → never auto-engage; a hunter is the exception (its catchable-prey
 *    predation survives the IGNORE gate), everything else disengages and waits for an explicit order;
 *  - **travelling and neither engaged nor ordered** → leave it (don't hijack an economy walk; an engaged /
 *    ordered / DEFEND-returning unit is re-evaluated so a chaser stops-and-swings the instant it's in reach);
 *  - **attacker eligibility** — an unowned passive animal runs no attack drive (also reaps a lapsed
 *    {@link Anger}); **unarmed** → disengage;
 *  - else resolve a target under the stance's {@link engageSpec} (ATTACK: sight; DEFEND: anchor radius;
 *    IGNORE-hunter: prey) and swing (in reach) / chase (owned, leashed for DEFEND) / return-to-anchor
 *    (DEFEND, none) / disengage (none).
 * Unowned combatants carry no Stance and keep the content-relation behaviour (swing-in-place).
 */
function engageCombatant(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: NodeBuckets,
  presence: HostilePresence,
  slots: MeleeSlots,
  bodyNodes: BuildingBodyNodeCache,
  e: Entity,
): void {
  if (world.has(e, CurrentAtomic)) return; // mid-swing / mid-need: play it out
  if (world.get(e, Health).hitpoints <= 0) return; // dead, not yet reaped — no free swing

  const owned = world.has(e, Owner);
  let ordered = world.has(e, AttackOrder);
  const attacker = world.get(e, Settler);
  // The move-order gate (see the ladder above); `moveUnit` clears any prior Engagement/AttackOrder/Fleeing,
  // so an ordered unit starts its walk cleanly.
  if (world.has(e, PlayerOrder) && !ordered) return;
  // An explicit attack order that has outlived its target (dead / no longer a valid hostile) is dropped
  // before the stance dispatch, so the unit re-decides by its stance this tick instead of the order's stale
  // general-hostility spec falling through to a one-tick ATTACK-style re-acquire regardless of stance.
  if (ordered && !isValidTarget(world, ctx, e, attacker, world.get(e, AttackOrder).target)) {
    world.remove(e, AttackOrder);
    ordered = false;
  }
  // An unowned combatant carries no Stance — modelled as a `null` mode. Derived once here and handed whole
  // to engageSpec/chase, which only ever read the three together.
  const mode = owned ? stanceMode(world, e, attacker.jobType) : null;
  const stance: CombatantStance = { owned, ordered, mode };

  // A unit that has stopped fleeing (stance changed, or an order took over) sheds the flee state + its run
  // route.
  const willFlee = mode === MILITARY_MODE.FLEE && !ordered;
  if (world.has(e, Fleeing) && !willFlee) {
    world.remove(e, Fleeing);
    clearNavState(world, e);
  }
  if (willFlee) {
    // A fleeing unit is not attack-engaged: shed any Engagement left from a prior ATTACK/DEFEND chase. A
    // stale marker would outlive the flee — `fleeDrive` drops `Fleeing` but not `Engagement` — benching the
    // unit (aiSystem skips it) and keeping combat awake forever.
    world.remove(e, Engagement);
    fleeDrive(world, ctx, terrain, index, presence, e, attacker);
    return;
  }

  // The passive NONE is normalized to IGNORE by {@link stanceMode}. A hunter is exempt: its catchable-prey
  // predation is an economic drive independent of the military mode, so it falls through to the engage path
  // (with a predation-only target filter, {@link engageSpec}).
  if (mode === MILITARY_MODE.IGNORE && !ordered && attacker.jobType !== HUNTER_JOB) {
    disengage(world, e);
    return;
  }

  const engaged = world.has(e, Engagement);
  const travelling = isTravelling(world, e);
  // A travelling unit that is not yet fighting is walking under another drive (an economy walk, or a DEFEND
  // unit heading back to its anchor) — don't yank it into combat.
  if (travelling && !engaged && !ordered) return;

  // An unowned passive animal drives no attack (and a lapsed anger timer is reaped here); an owned unit is
  // always an aggressor.
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
  const spec = engageSpec(world, ctx, terrain, e, stance, attacker, weapon);
  const found = resolveTarget(world, ctx, terrain, index, presence, e, here, attacker, spec);
  if (found === null) {
    // No target: a DEFEND unit walks back to its anchor (holding its post); everyone else disengages back
    // to the economy.
    if (spec.defend !== null) returnToAnchor(world, e, here, spec.defend.anchorCell);
    else disengage(world, e);
    return;
  }

  const { target, dist } = found;
  if (dist >= weapon.minRange && dist <= weapon.maxRange && !travelling) {
    // In the reach band and standing: swing. The standstill gate: node positions truncate to the lattice
    // (`nodeOfPosition`), so a walker can read as in-band mid-stride (up to half an edge short of a centre)
    // and swinging there would freeze it off any node centre, reading as a glide. Gated, the walker finishes
    // its braked last leg onto the slot's centre first; clearing the nav state is then stale-goal hygiene.
    clearNavState(world, e);
    // The Engagement marker (economy-skip + chase throttle) is owned-only: an unowned combatant swings in
    // place with no advance drive, so stamping it there would give it a spurious economy-skip and perturb
    // its hash. It only matters in the idle tick between swings (mid-swing, `CurrentAtomic` already gates
    // the unit off the economy), where it keeps an owned unit engaged instead of re-tasked.
    if (owned) world.add(e, Engagement, { repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick });
    const damage = weaponDamageVsMaterial(weapon.weapon, targetMaterial(world, ctx, target));
    startAttack(world, ctx, attacker, e, target, damage, weapon.weapon);
    return;
  }

  // Beyond reach: only an owned combatant advances. An unowned one's resolveTarget radius was capped at
  // maxRange, so its branch here is unreachable — kept explicit rather than assumed away.
  if (!owned) {
    disengage(world, e);
    return;
  }
  // Advance on the target's combat node — its own node for a unit, its nearest wall cell for a building —
  // the same node resolveTarget measured the distance to, so the chase walks toward where the swing lands.
  // A building's full wall list rides along so a chaser whose nearest face is manned encircles to another.
  const targetNode = combatTargetNode(world, ctx, terrain, here, target, bodyNodes);
  const targetBody = world.has(target, Building)
    ? buildingBodyNodes(world, ctx, terrain, target, bodyNodes)
    : null;
  chase(world, ctx, terrain, slots, e, here, targetNode, targetBody, weapon, stance, spec.defend);
}
