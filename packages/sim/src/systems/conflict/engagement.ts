import type { ContentSet } from '@open-northland/data';
import { AttackOrder, Owner, type SettlerIdentity, Stance } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import {
  defaultStanceForJob,
  isAnimalTribe,
  isHunterJob,
  isLowPriorityBuildingTarget,
  MILITARY_MODE,
  type MilitaryMode,
} from '../readviews/index.js';
import { entityNode, manhattan, type NodeBuckets } from '../spatial/nodes.js';
import { playerSeesEntity } from '../vision/index.js';
import { hunterEngageSpec } from './hunting-ground.js';
import type { HostilePresence } from './presence.js';
import { type BuildingBodyNodeCache, combatTargetNode } from './target-node.js';
import { ANIMAL_AGGRO_RADIUS_NODES, isValidTarget, SIGHT_RADIUS_NODES } from './targeting.js';

// Target acquisition: which enemy an owned combatant may auto-engage this tick, resolved from its
// military stance, and the near/far reach band + DEFEND anchor leash the chase respects. Internal to
// conflict/; {@link combatSystem} composes this with ./chase.ts (the walk-into-melee half).

/**
 * DEFEND stance - how far (Manhattan half-cell nodes) from its anchor a defender auto-acquires an enemy: it
 * engages only threats inside this radius of the node the DEFEND stance was set on, ignoring anything beyond.
 * Approximated - the original's exact defend radius is unreadable (source basis "Combat stances"); doubled with
 * the half-cell migration (same on-screen radius as the old 4-cell value).
 */
export const DEFEND_RADIUS_NODES = 8;

/**
 * DEFEND stance - the leash: the farthest (Manhattan nodes) from its anchor a defender will step to strike an
 * in-radius enemy. Kept a little above {@link DEFEND_RADIUS_NODES} so a melee defender can walk up to a threat
 * at the radius edge, but never chases far - a target reachable only by breaking the leash is left alone and the
 * defender returns to its anchor. Approximated (source basis).
 */
export const DEFEND_LEASH_NODES = 12;

/**
 * The military mode an owned combatant acts under - its {@link Stance} `mode`, or (defensively, if the component
 * is somehow missing) the job's {@link defaultStanceForJob}. `NONE` (an unset mode the defaults never produce)
 * is normalized to the passive {@link MILITARY_MODE.IGNORE} so a stray value never becomes an accidental
 * aggressor.
 */
export function stanceMode(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): MilitaryMode {
  const s = world.tryGet(e, Stance);
  const mode = s === undefined ? defaultStanceForJob(content, jobType) : s.mode;
  return mode === MILITARY_MODE.NONE ? MILITARY_MODE.IGNORE : mode;
}

/**
 * What a combatant acts under this tick - derived together in one place ({@link engageCombatant}) and passed
 * whole to {@link engageSpec} and {@link chase}, so the three values that only ever travel together cannot be
 * transposed at a call site.
 */
export interface CombatantStance {
  /** Whether the unit has an {@link Owner} - an owned unit advances on a spotted enemy; an unowned one
   *  has no fog and carries no {@link Stance} (a hostile animal still ambushes within its aggro radius;
   *  an unowned civ swings in place). */
  readonly owned: boolean;
  /** Whether an explicit {@link AttackOrder} is in flight - it overrides `mode`'s auto-behavior. */
  readonly ordered: boolean;
  /** The {@link MILITARY_MODE} the unit acts under ({@link stanceMode}), or null for an unowned combatant. */
  readonly mode: MilitaryMode | null;
}

/**
 * How a combatant acquires a target this tick, resolved from its stance - the ring-search `accept` filter, the
 * near/far reach band (`minDist`/`searchRadius`), and the anchor leash the chase respects (a DEFEND
 * post, a hunter's ground).
 *  - **DEFEND** (auto, not ordered) → accept only hostile targets within {@link DEFEND_RADIUS_NODES} of the
 *    anchor, spot within `radius + leash`, and carry the anchor+leash so {@link chase} never pursues past it.
 *  - **IGNORE hunter** → the hunting-ground policy ({@link hunterEngageSpec}, ./hunting-ground.ts):
 *    huntable prey only, bounded to the work-flag / workplace ground with the flag as chase anchor,
 *    normal game before last-resort livestock, livestock gated on the ground holding no carcass work.
 *  - **ATTACK / ordered / unowned** → general hostility ({@link isValidTarget}); an owned unit spots within its
 *    {@link SIGHT_RADIUS_NODES} (it advances), a hostile wild animal within {@link ANIMAL_AGGRO_RADIUS_NODES}
 *    (the ambush lunge), an unowned civ only within weapon reach (swing-in-place).
 * The `minDist` is the weapon's near reach (a ranged weapon's dead zone) in every case.
 */
export function engageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  stance: CombatantStance,
  attacker: SettlerIdentity,
  weapon: { minRange: number; maxRange: number },
): EngageSpec {
  const { owned, ordered } = stance;
  // Fog gate (full sim enforcement, user decision): an owned unit auto-acquires only targets its player
  // currently sees - an enemy in the fog is invisible to the drive. Composed into every auto-acquire accept
  // below; the explicit-AttackOrder path (resolveTarget's direct isValidTarget) stays ungated - an ordered
  // chase follows its target into fog, and the UI can only order onto a drawn (visible) unit anyway. Unowned
  // combatants (wildlife) have no fog.
  const viewer = owned ? world.tryGet(e, Owner) : undefined;
  const seesTarget = (t: Entity): boolean =>
    viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t);
  const generalAccept = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t) && seesTarget(t);
  // The default deprioritized tier: plain buildings fall behind units and high-value structures. The
  // hunter overrides it with the last-resort-livestock tier below.
  const lowPriorityBuildings = (t: Entity): boolean => isLowPriorityBuildingTarget(world, ctx, t);
  const minDist = weapon.minRange;
  const sight = Math.max(weapon.maxRange, SIGHT_RADIUS_NODES);

  // A hunter is NEVER presence-gated, in any stance: its prey filter admits the passive wildlife the
  // grid discounts (see {@link HostilePresence}). Hunters are a handful per map - the scan is cheap.
  const player = isHunterJob(ctx.content, attacker.jobType) ? null : (viewer?.player ?? null);

  if (owned && !ordered && stance.mode === MILITARY_MODE.DEFEND) {
    const anchor = defendAnchor(world, terrain, e);
    const accept = (t: Entity): boolean =>
      generalAccept(t) && manhattan(terrain, anchor, entityNode(world, terrain, t)) <= DEFEND_RADIUS_NODES;
    return {
      accept,
      minDist,
      searchRadius: DEFEND_RADIUS_NODES + DEFEND_LEASH_NODES,
      player,
      lowPriority: lowPriorityBuildings,
      defend: { anchorCell: anchor, leash: DEFEND_LEASH_NODES, hold: true },
    };
  }

  if (
    owned &&
    !ordered &&
    stance.mode === MILITARY_MODE.IGNORE &&
    isHunterJob(ctx.content, attacker.jobType)
  ) {
    // The hunting-ground policy (where a hunter hunts, the prey tiers, the livestock gate) lives in
    // ./hunting-ground.ts; this dispatch only routes the stance to it.
    return hunterEngageSpec(world, ctx, terrain, e, attacker.jobType, seesTarget, minDist, sight);
  }

  // An unowned HOSTILE ANIMAL (the only unowned animal that reaches here - a passive one disengaged at
  // the attacker-eligibility gate) advances like a soldier, within its shorter ambush radius. Any other
  // unowned combatant (a scenario civ) keeps the swing-in-place read: search capped at weapon reach.
  const animalSeeker = !owned && isAnimalTribe(ctx.content, attacker.tribe);
  return {
    accept: generalAccept,
    minDist,
    searchRadius: owned
      ? sight
      : animalSeeker
        ? Math.max(weapon.maxRange, ANIMAL_AGGRO_RADIUS_NODES)
        : weapon.maxRange,
    player,
    animalSeeker,
    lowPriority: lowPriorityBuildings,
    defend: null,
  };
}

/** How a combatant acquires + reaches a target this tick, derived from its stance ({@link engageSpec}). */
export interface EngageSpec {
  /** The ring-search per-candidate hostility/predation filter. */
  readonly accept: (t: Entity) => boolean;
  /** Near reach - the ring search ignores anything closer (a ranged weapon's dead zone). */
  readonly minDist: number;
  /** Far reach - how far the unit spots a target to swing at / advance on. */
  readonly searchRadius: number;
  /** The seeker's player for the {@link HostilePresence} early-out; null when the seeker must never
   *  skip the search - an unowned one (its valid targets can share its "unowned" presence class) or
   *  a hunter in any stance (its owner-blind prey filter admits discounted passive wildlife). */
  readonly player: number | null;
  /** A hostile wild animal seeking - gates on {@link HostilePresence.civsWithin} instead (its accept
   *  admits only civilization settlers). */
  readonly animalSeeker?: boolean;
  /** The deprioritized tier among accepted targets - searched only when the primary tier finds nothing
   *  in sight: plain buildings for a soldier's stances, last-resort livestock for the hunter. */
  readonly lowPriority: (t: Entity) => boolean;
  /** Anchor leash: the chase never walks past `leash` of `anchorCell` (a DEFEND post, a hunter's
   *  ground); null when the chase is unbounded. `hold` - with no target in sight, walk back to the
   *  anchor and hold it (the DEFEND post duty); false hands the unit back to the economy instead (a
   *  hunter's between-hunts time belongs to its carcass-harvest drive, not to standing a post). */
  readonly defend: { readonly anchorCell: NodeId; readonly leash: number; readonly hold: boolean } | null;
}

/** The DEFEND anchor cell - the {@link Stance}'s captured `anchorCell` (the tile the stance was set on),
 *  falling back to the unit's own cell if it somehow carries none (a DEFEND stamped before it had a tile). */
function defendAnchor(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const anchor = world.tryGet(e, Stance)?.anchorCell;
  return anchor ?? entityNode(world, terrain, e);
}

/**
 * The enemy this combatant fights this tick (with its Manhattan distance from `here`, so the caller
 * needn't recompute it), or null:
 *  - under an explicit {@link AttackOrder} → that focused `target`, chased regardless of sight, as long as
 *    it is a live, hostile target; a target that has died / become invalid drops the order and falls
 *    through to auto-engagement (so the unit re-acquires a nearby enemy rather than going idle);
 *  - otherwise → the nearest target the ring search finds within `[spec.minDist, spec.searchRadius]` that
 *    the stance's `spec.accept` filter admits, in TWO priority tiers split by `spec.lowPriority`: the
 *    deprioritized tier is searched only when the first pass finds nothing in sight. For the soldier
 *    stances that tier is the plain `'other'` building (the autofocus priority: HQ / towers / enemy
 *    units on par, other buildings only when none of those remain - user rule); for the hunter it is
 *    last-resort livestock (normal game always wins - user rule). General hostility for ATTACK/unowned
 *    and anchor-bounded DEFEND both admit an enemy building (a DEFEND guard autonomously batters a
 *    structure inside its radius - deliberate: a defensive post contests enemy construction on its
 *    ground); only an IGNORE hunter's prey filter never admits one - see {@link engageSpec}.
 */
export function resolveTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: NodeBuckets,
  presence: HostilePresence,
  self: Entity,
  here: NodeId,
  attacker: SettlerIdentity,
  spec: EngageSpec,
  bodyNodes?: BuildingBodyNodeCache,
): { target: Entity; dist: number } | null {
  if (world.has(self, AttackOrder)) {
    const focus = world.get(self, AttackOrder).target;
    // An ordered target is chased regardless of sight, so measure its real distance (the ring search's
    // `searchRadius` cap does not apply); the swing/chase decision is on this distance. A building is
    // measured at its nearest wall cell (combatTargetNode, through the tick's wall memo - N warriors
    // ordered onto one building must not re-translate its footprint N times), the same node the chase
    // walks to.
    if (isValidTarget(world, ctx, self, attacker, focus)) {
      return {
        target: focus,
        dist: manhattan(terrain, here, combatTargetNode(world, ctx, terrain, here, focus, bodyNodes)),
      };
    }
    world.remove(self, AttackOrder); // target gone / no longer hostile - abandon the order, auto-engage
  }
  const { x, y } = terrain.coordsOf(here);
  // Idle early-out (perf-only): when the coarse presence grid proves no not-mine combatant/building can be
  // in the search band, both ring searches would return null - skip them (the standing-army flat cost).
  if (spec.player !== null && !presence.othersWithin(spec.player, x, y, spec.searchRadius)) return null;
  // The animal seeker's twin (see {@link HostilePresence}): no civ in the band proves both empty.
  if (spec.animalSeeker === true && !presence.civsWithin(x, y, spec.searchRadius)) return null;
  // Tier 1: everything the stance admits that is NOT deprioritized (units + HQ + towers for a soldier,
  // normal game for a hunter). A nearer tier-2 target never preempts a tier-1 target in sight.
  const primary = index.nearest(
    x,
    y,
    spec.minDist,
    spec.searchRadius,
    (t) => spec.accept(t) && !spec.lowPriority(t),
  );
  if (primary !== null) return { target: primary.entity, dist: primary.distance };
  // Tier 2 (fallback): the deprioritized targets, only when no tier-1 target was in sight.
  const fallback = index.nearest(
    x,
    y,
    spec.minDist,
    spec.searchRadius,
    (t) => spec.accept(t) && spec.lowPriority(t),
  );
  return fallback === null ? null : { target: fallback.entity, dist: fallback.distance };
}
