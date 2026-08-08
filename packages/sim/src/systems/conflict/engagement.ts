import { AttackOrder, Owner, type SettlerIdentity, Stance } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import {
  isAnimalTribe,
  isHunterJob,
  isLowPriorityBuildingTarget,
  MILITARY_MODE,
  type MilitaryMode,
  stanceMode,
} from '../readviews/index.js';
import { entityNode, manhattan, type NodeBuckets } from '../spatial/nodes.js';
import { playerSeesEntity } from '../vision/index.js';
import { hunterEngageSpec } from './hunting/index.js';
import type { CombatPass } from './pass.js';
import { type BuildingBodyNodeCache, combatTargetNode } from './target-node.js';
import { ANIMAL_AGGRO_RADIUS_NODES, isValidTarget, SIGHT_RADIUS_NODES } from './targeting.js';

// Re-exported so the combat modules keep one import site for the stance ladder.
export { stanceMode };

/**
 * DEFEND stance - how far (Manhattan half-cell nodes) from its anchor a defender auto-acquires an enemy.
 * Approximated (source basis "Combat stances").
 */
export const DEFEND_RADIUS_NODES = 8;

/**
 * DEFEND stance - the farthest (Manhattan nodes) from its anchor a defender steps to strike an in-radius
 * enemy; a target reachable only past it is left alone. Approximated (source basis "Combat stances").
 */
export const DEFEND_LEASH_NODES = 12;

/**
 * How many of the nearest enemies a GARRISON fans its fire across: every settler manning one building stands
 * on the same node, so without this a full tower would empty itself into one raider. Approximation - no
 * readable record carries a fire-distribution rule.
 */
export const GARRISON_SPREAD_TARGETS = 4;

export interface CombatantStance {
  /** Whether the unit has an {@link Owner}; an unowned combatant has no fog and carries no {@link Stance}. */
  readonly owned: boolean;
  /** Whether an explicit {@link AttackOrder} is in flight - it overrides `mode`'s auto-behavior. */
  readonly ordered: boolean;
  /** The {@link MILITARY_MODE} the unit acts under, or null for an unowned combatant. */
  readonly mode: MilitaryMode | null;
  /** The tower the unit is manning, or null. A garrison shoots from cover and never leaves, so the post
   *  overrides whatever `mode` would otherwise do. */
  readonly post: Entity | null;
  /** The defence-mode building a CIVILIAN mans instead and its `seat` in that garrison, else null. It
   *  shoots the house bow from cover, measured from the building, and neither flees nor steps out to
   *  chase, whatever its stance says. */
  readonly shelter: { readonly building: Entity; readonly seat: number } | null;
}

/**
 * How a combatant acquires a target this tick, resolved from its stance: the ring-search `accept` filter, the
 * near/far reach band (`minDist`/`searchRadius`), and the anchor leash the chase respects (a DEFEND post, a
 * hunter's ground).
 */
export function engageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: NodeBuckets,
  e: Entity,
  stance: CombatantStance,
  attacker: SettlerIdentity,
  weapon: { minRange: number; maxRange: number },
): EngageSpec {
  const { owned, ordered } = stance;
  // Fog gate: an owned unit auto-acquires only targets its player currently sees. The explicit-AttackOrder
  // path stays ungated - an ordered chase follows its target into fog. Unowned combatants have no fog.
  const viewer = owned ? world.tryGet(e, Owner) : undefined;
  const seesTarget = (t: Entity): boolean =>
    viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t);
  const generalAccept = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t) && seesTarget(t);
  // The default deprioritized tier: plain buildings fall behind units and high-value structures.
  const lowPriorityBuildings = (t: Entity): boolean => isLowPriorityBuildingTarget(world, ctx, t);
  const minDist = weapon.minRange;
  const sight = Math.max(weapon.maxRange, SIGHT_RADIUS_NODES);

  const hunts = isHunterJob(ctx.content, attacker.jobType);
  // A hunter is never presence-gated, in any stance: its prey filter admits the passive wildlife the
  // presence grid discounts.
  const player = hunts ? null : (viewer?.player ?? null);

  // A garrison outranks every stance: its search band is the tower-boosted reach (`weapon` already carries
  // the bonus), never the advance sight radius. A sheltering civilian reads the same way, anchor-less
  // because a DEFEND post's walk-back would march it out of the building it is holding.
  if (stance.post !== null || stance.shelter !== null) {
    return {
      accept: generalAccept,
      minDist,
      searchRadius: weapon.maxRange,
      player,
      // Only the sheltering crowd fans its fire; a tower's posted archers still stack on the nearest man.
      ...(stance.shelter === null
        ? {}
        : { spread: { seat: stance.shelter.seat, group: garrisonGroup(viewer?.player, attacker, hunts) } }),
      lowPriority: lowPriorityBuildings,
      lock: null,
      defend: null,
    };
  }

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
      lock: null,
      defend: { anchorCell: anchor, leash: DEFEND_LEASH_NODES, hold: true },
    };
  }

  if (
    owned &&
    !ordered &&
    stance.mode === MILITARY_MODE.IGNORE &&
    isHunterJob(ctx.content, attacker.jobType)
  ) {
    return hunterEngageSpec(world, ctx, terrain, index, e, attacker.jobType, seesTarget, minDist, sight);
  }

  // An unowned hostile animal advances like a soldier within its shorter ambush radius; any other unowned
  // combatant (a scenario civ) swings in place, its search capped at weapon reach.
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
    lock: null,
    defend: null,
  };
}

/**
 * The seeker inputs a garrison's `accept` keys on: the fog owner, the tribe the hostility relation reads,
 * and whether the trade hunts - a trade reaches that filter only through `mayHunt`, so the flag is the
 * whole of it. Two occupants agreeing on all three admit the same targets, so one search answers both.
 */
function garrisonGroup(player: number | undefined, attacker: SettlerIdentity, hunts: boolean): string {
  return `${player}/${attacker.tribe}/${hunts}`;
}

export interface EngageSpec {
  /** The ring-search per-candidate hostility/predation filter. */
  readonly accept: (t: Entity) => boolean;
  /** Near reach - the ring search ignores anything closer (a ranged weapon's dead zone). */
  readonly minDist: number;
  /** Far reach - how far the unit spots a target to swing at / advance on. */
  readonly searchRadius: number;
  /** The seeker's player for the coarse presence early-out; null when the seeker must never skip the
   *  search - an unowned one, or a hunter in any stance. */
  readonly player: number | null;
  /** A hostile wild animal seeking - gates on the presence grid's civilian count instead. */
  readonly animalSeeker?: boolean;
  /** This seeker's place in the firing line it shares a node with: `seat` is its offset into the nearest
   *  {@link GARRISON_SPREAD_TARGETS}, and `group` identifies the occupants whose search it is the same as.
   *  Absent means take the nearest. */
  readonly spread?: { readonly seat: number; readonly group: string };
  /** The deprioritized tier among accepted targets, searched only when the primary tier finds nothing in
   *  sight. It splits RAW ring-search candidates ahead of {@link EngageSpec.accept}, so it must stay total
   *  and pure over any indexed entity - a friendly unit, an own building, a carcass. */
  readonly lowPriority: (t: Entity) => boolean;
  /** Target commitment: non-null for a stance that holds one target across ticks instead of re-acquiring
   *  the nearest candidate. `target` is the live hold, null when nothing is committed yet. */
  readonly lock: { readonly target: Entity | null } | null;
  /** Anchor leash: the chase never walks past `leash` of `anchorCell`; null when the chase is unbounded.
   *  `hold` walks the unit back to the anchor with no target in sight, false hands it back to the economy. */
  readonly defend: { readonly anchorCell: NodeId; readonly leash: number; readonly hold: boolean } | null;
}

/** The DEFEND anchor cell - the {@link Stance}'s captured `anchorCell`, falling back to the unit's own
 *  cell when it carries none. */
function defendAnchor(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const anchor = world.tryGet(e, Stance)?.anchorCell;
  return anchor ?? entityNode(world, terrain, e);
}

/**
 * The enemy this combatant fights this tick with its Manhattan distance from `here`, or null. An
 * {@link AttackOrder} focus and a live `spec.lock` resolve ahead of the ring search - a focus that died
 * drops the order and falls through to auto-engagement. Otherwise the nearest target `spec.accept` admits
 * within `[spec.minDist, spec.searchRadius]`, with the `spec.lowPriority` tier searched only when the
 * primary tier finds nothing in sight.
 */
export function resolveTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  attacker: SettlerIdentity,
  spec: EngageSpec,
): { target: Entity; dist: number } | null {
  const { bodyNodes, index, presence } = pass;
  if (world.has(self, AttackOrder)) {
    const focus = world.get(self, AttackOrder).target;
    // An ordered target is chased regardless of sight, so measure its real distance, uncapped by the ring
    // search's band. A building is measured at its nearest wall cell, the same node the chase walks to.
    if (isValidTarget(world, ctx, self, attacker, focus)) {
      return focusedOn(world, ctx, terrain, here, focus, bodyNodes);
    }
    world.remove(self, AttackOrder); // target gone / no longer hostile - abandon the order, auto-engage
  }
  const { x, y } = terrain.coordsOf(here);
  const locked = spec.lock?.target ?? null;
  if (locked !== null) {
    // A commitment ignores `minDist`: prey that closes inside the weapon's dead zone is backed off by the
    // chase, not dropped. The tier rule still outranks it, so a hold on the deprioritized tier yields to
    // any primary-tier target in sight.
    const preempt = spec.lowPriority(locked)
      ? index.nearest(x, y, spec.minDist, spec.searchRadius, (t) => !spec.lowPriority(t) && spec.accept(t))
      : null;
    if (preempt !== null) return { target: preempt.entity, dist: preempt.distance };
    return focusedOn(world, ctx, terrain, here, locked, bodyNodes);
  }
  // Idle early-out (perf-only): when the coarse presence grid proves no not-mine combatant or building can
  // be in the search band, both ring searches would return null.
  if (spec.player !== null && !presence.othersWithin(spec.player, x, y, spec.searchRadius)) return null;
  // The animal seeker's twin: no civ in the band proves both empty.
  if (spec.animalSeeker === true && !presence.civsWithin(x, y, spec.searchRadius)) return null;
  // A nearer tier-2 target never preempts a tier-1 target in sight.
  const primary = pickInBand(pass, spec, x, y, 'primary');
  if (primary !== null) return primary;
  return pickInBand(pass, spec, x, y, 'low');
}

type TargetTier = 'primary' | 'low';

/** One priority tier's pick from the search band: the nearest target the stance admits, or the seat's own
 *  share of the nearest {@link GARRISON_SPREAD_TARGETS} for a seeker carrying a `spread`. */
function pickInBand(
  pass: CombatPass,
  spec: EngageSpec,
  x: number,
  y: number,
  tier: TargetTier,
): { target: Entity; dist: number } | null {
  const wantsLowPriority = tier === 'low';
  const accept = (t: Entity): boolean => spec.lowPriority(t) === wantsLowPriority && spec.accept(t);
  const spread = spec.spread;
  if (spread === undefined) {
    const found = pass.index.nearest(x, y, spec.minDist, spec.searchRadius, accept);
    return found === null ? null : { target: found.entity, dist: found.distance };
  }
  // One search per garrison, not per seat: `spread.group`, the centre and the reach name every input the
  // walk reads. The `t === self` exclusion is the one they cannot, and it never decides a garrison's band -
  // `isValidTarget` already refuses every manning settler.
  const key = `${x},${y},${spec.minDist},${spec.searchRadius},${spread.group},${tier}`;
  let band = pass.bands.get(key);
  if (band === undefined) {
    band = pass.index.nearestFew(x, y, spec.minDist, spec.searchRadius, accept, GARRISON_SPREAD_TARGETS);
    pass.bands.set(key, band);
  }
  if (band.length === 0) return null;
  const share = band[spread.seat % band.length];
  return share === undefined ? null : { target: share.entity, dist: share.distance };
}

/** A focused target and its real distance from `here`, uncapped by the ring search's band - a building
 *  measured at the wall the chase closes on. */
function focusedOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  target: Entity,
  bodyNodes: BuildingBodyNodeCache | undefined,
): { target: Entity; dist: number } {
  return {
    target,
    dist: manhattan(terrain, here, combatTargetNode(world, ctx, terrain, here, target, bodyNodes)),
  };
}
