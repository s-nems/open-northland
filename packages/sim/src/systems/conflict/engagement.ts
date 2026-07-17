import { AttackOrder, Owner, type SettlerIdentity, Stance } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { defaultStanceForJob, HUNTER_JOB, MILITARY_MODE, type MilitaryMode } from '../readviews/index.js';
import { entityNode, manhattan, type NodeBuckets } from '../spatial.js';
import { playerSeesEntity } from '../vision/index.js';
import type { HostilePresence } from './presence.js';
import { isHuntTarget, isValidTarget, SIGHT_RADIUS_NODES } from './targeting.js';

// Target acquisition: which enemy an owned combatant may auto-engage this tick, resolved from its
// military stance, and the near/far reach band + DEFEND anchor leash the chase respects. Internal to
// conflict/; {@link combatSystem} composes this with ./chase.ts (the walk-into-melee half).

/**
 * DEFEND stance — how far (Manhattan half-cell nodes) from its anchor a defender auto-acquires an enemy: it
 * engages only threats inside this radius of the node the DEFEND stance was set on, ignoring anything beyond.
 * Approximated — the original's exact defend radius is unreadable (source basis "Combat stances"); doubled with
 * the half-cell migration (same on-screen radius as the old 4-cell value).
 */
export const DEFEND_RADIUS_NODES = 8;

/**
 * DEFEND stance — the leash: the farthest (Manhattan nodes) from its anchor a defender will step to strike an
 * in-radius enemy. Kept a little above {@link DEFEND_RADIUS_NODES} so a melee defender can walk up to a threat
 * at the radius edge, but never chases far — a target reachable only by breaking the leash is left alone and the
 * defender returns to its anchor. Approximated (source basis).
 */
export const DEFEND_LEASH_NODES = 12;

/**
 * The military mode an owned combatant acts under — its {@link Stance} `mode`, or (defensively, if the component
 * is somehow missing) the job's {@link defaultStanceForJob}. `NONE` (an unset mode the defaults never produce)
 * is normalized to the passive {@link MILITARY_MODE.IGNORE} so a stray value never becomes an accidental
 * aggressor.
 */
export function stanceMode(world: World, e: Entity, jobType: number | null): MilitaryMode {
  const s = world.tryGet(e, Stance);
  const mode = s === undefined ? defaultStanceForJob(jobType) : s.mode;
  return mode === MILITARY_MODE.NONE ? MILITARY_MODE.IGNORE : mode;
}

/**
 * What a combatant acts under this tick — derived together in one place ({@link engageCombatant}) and passed
 * whole to {@link engageSpec} and {@link chase}, so the three values that only ever travel together cannot be
 * transposed at a call site.
 */
export interface CombatantStance {
  /** Whether the unit has an {@link Owner} — an owned unit advances on a spotted enemy; an unowned one
   *  (wildlife) swings in place, has no fog, and carries no {@link Stance}. */
  readonly owned: boolean;
  /** Whether an explicit {@link AttackOrder} is in flight — it overrides `mode`'s auto-behavior. */
  readonly ordered: boolean;
  /** The {@link MILITARY_MODE} the unit acts under ({@link stanceMode}), or null for an unowned combatant. */
  readonly mode: MilitaryMode | null;
}

/**
 * How a combatant acquires a target this tick, resolved from its stance — the ring-search `accept` filter, the
 * near/far reach band (`minDist`/`searchRadius`), and (DEFEND only) the anchor leash the chase respects.
 *  - **DEFEND** (auto, not ordered) → accept only hostile targets within {@link DEFEND_RADIUS_NODES} of the
 *    anchor, spot within `radius + leash`, and carry the anchor+leash so {@link chase} never pursues past it.
 *  - **IGNORE hunter** → accept only catchable prey ({@link isHuntTarget}) — the predation that survives the
 *    IGNORE gate — spotted within the sight radius.
 *  - **ATTACK / ordered / unowned** → general hostility ({@link isValidTarget}); an owned unit spots within its
 *    {@link SIGHT_RADIUS_NODES} (it advances), an unowned one only within weapon reach (swing-in-place).
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
  // currently sees — an enemy in the fog is invisible to the drive. Composed into every auto-acquire accept
  // below; the explicit-AttackOrder path (resolveTarget's direct isValidTarget) stays ungated — an ordered
  // chase follows its target into fog, and the UI can only order onto a drawn (visible) unit anyway. Unowned
  // combatants (wildlife) have no fog.
  const viewer = owned ? world.tryGet(e, Owner) : undefined;
  const seesTarget = (t: Entity): boolean =>
    viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t);
  const generalAccept = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t) && seesTarget(t);
  const minDist = weapon.minRange;
  const sight = Math.max(weapon.maxRange, SIGHT_RADIUS_NODES);

  const player = viewer?.player ?? null;

  if (owned && !ordered && stance.mode === MILITARY_MODE.DEFEND) {
    const anchor = defendAnchor(world, terrain, e);
    const accept = (t: Entity): boolean =>
      generalAccept(t) && manhattan(terrain, anchor, entityNode(world, terrain, t)) <= DEFEND_RADIUS_NODES;
    return {
      accept,
      minDist,
      searchRadius: DEFEND_RADIUS_NODES + DEFEND_LEASH_NODES,
      player,
      defend: { anchorCell: anchor, leash: DEFEND_LEASH_NODES },
    };
  }

  if (owned && !ordered && stance.mode === MILITARY_MODE.IGNORE && attacker.jobType === HUNTER_JOB) {
    const accept = (t: Entity): boolean => isHuntTarget(world, ctx, t, attacker.jobType) && seesTarget(t);
    // player: null — never presence-gate a hunter: isHuntTarget is owner-blind (own-player-owned prey
    // is valid), so the gate's "not mine" class is no superset of this filter. Hunters are a
    // handful per map; the ungated scan costs nothing at scale.
    return { accept, minDist, searchRadius: sight, player: null, defend: null };
  }

  return {
    accept: generalAccept,
    minDist,
    searchRadius: owned ? sight : weapon.maxRange,
    player,
    defend: null,
  };
}

/** How a combatant acquires + reaches a target this tick, derived from its stance ({@link engageSpec}). */
interface EngageSpec {
  /** The ring-search per-candidate hostility/predation filter. */
  readonly accept: (t: Entity) => boolean;
  /** Near reach — the ring search ignores anything closer (a ranged weapon's dead zone). */
  readonly minDist: number;
  /** Far reach — how far the unit spots a target to swing at / advance on. */
  readonly searchRadius: number;
  /** The seeker's player for the {@link HostilePresence} early-out; null when the seeker must never
   *  skip the search — an unowned one (its valid targets can share its "unowned" presence class) or
   *  an IGNORE hunter (its owner-blind prey filter admits the seeker's own player's animals). */
  readonly player: number | null;
  /** DEFEND leash: the chase never walks past `leash` of `anchorCell`; null for every non-DEFEND mode. */
  readonly defend: { readonly anchorCell: NodeId; readonly leash: number } | null;
}

/** The DEFEND anchor cell — the {@link Stance}'s captured `anchorCell` (the tile the stance was set on),
 *  falling back to the unit's own cell if it somehow carries none (a DEFEND stamped before it had a tile). */
function defendAnchor(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const anchor = world.tryGet(e, Stance)?.anchorCell;
  return anchor ?? entityNode(world, terrain, e);
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
  // Idle early-out (perf-only): when the coarse presence grid proves no not-mine combatant can be in
  // the search band, the ring search would return null — skip it (the standing-army flat cost).
  if (spec.player !== null && !presence.othersWithin(spec.player, x, y, spec.searchRadius)) return null;
  const found = index.nearest(x, y, spec.minDist, spec.searchRadius, spec.accept);
  return found === null ? null : { target: found.entity, dist: found.distance };
}
