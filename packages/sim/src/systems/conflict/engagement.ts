import {
  Age,
  AttackOrder,
  Building,
  Engagement,
  isWildlife,
  Owner,
  Person,
  Settler,
  type SettlerIdentity,
  Stance,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isTravelling } from '../movement/nav-state.js';
import { REFERENCE_STEP_TICKS } from '../movement/system.js';
import {
  isAnimalTribe,
  isFighterJob,
  isHunterJob,
  MILITARY_MODE,
  type MilitaryMode,
  stanceMode,
} from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { playerSeesEntity } from '../vision/index.js';
import { onStride, REPATH_CADENCE } from './chase.js';
import type { SearchMetric } from './combat-grid.js';
import type { CombatIndex } from './combat-index.js';
import { hunterEngageSpec } from './hunting/index.js';
import type { WeaponBand } from './melee-slots.js';
import type { CombatPass } from './pass.js';
import { combatTargetNode, reachableTargetGate } from './target-node.js';
import { ANIMAL_AGGRO_RADIUS_NODES, isValidTarget, SIGHT_RADIUS_NODES } from './targeting.js';
import { givenUpTargetVeto } from './unreachable-targets.js';

// Re-exported so the combat modules keep one import site for the stance ladder.
export { stanceMode };

/** DEFEND stance - how far (map points) from its anchor a defender looks for an enemy. Original behavior. */
export const DEFEND_RADIUS_NODES = 18;

/** DEFEND stance - how far (map points) from its anchor an enemy a defender already holds may go before it
 *  lets it go and walks back. Original behavior. */
export const DEFEND_LEASH_NODES = 40;

/** IGNORE stance - how far (map points) from its anchor an enemy a fighter already holds may go before it
 *  lets it go and walks back. Original behavior; the original also drops one nearer its anchor than the
 *  weapon's near reach, left out here as plainly odd. */
export const IGNORE_LEASH_NODES = 18;

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
}

/** The anchor a DEFEND or IGNORE unit guards: the {@link Stance}'s captured `anchorCell`, falling back to
 *  `here` when it carries none. */
function stanceAnchor(world: World, e: Entity, here: NodeId): NodeId {
  return world.tryGet(e, Stance)?.anchorCell ?? here;
}

/**
 * How a combatant acquires a target this tick, resolved from its stance: the nearest-search `accept` filter, the
 * near/far reach band (`minDist`/`searchRadius`), and the anchor leash the chase respects (a DEFEND post, a
 * hunter's ground).
 */
export function engageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
  here: NodeId,
  stance: CombatantStance,
  attacker: SettlerIdentity,
  weapon: WeaponBand,
): EngageSpec {
  const { owned, ordered } = stance;
  // Fog gate (authored): an owned unit auto-acquires only targets its player currently sees. The
  // explicit-AttackOrder path stays ungated - an ordered chase follows its target into fog. Unowned
  // combatants have no fog.
  const viewer = owned ? world.tryGet(e, Owner) : undefined;
  const seesTarget = (t: Entity): boolean =>
    viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t);
  // Probed last, behind the cheap hostility and fog reads: it can walk a candidate's whole reach band.
  const reachable = reachableTargetGate(world, ctx, terrain, here, weapon);
  const hostileInSight = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t) && seesTarget(t);
  const generalAccept = (t: Entity): boolean => hostileInSight(t) && reachable(t);
  // The default deprioritized tier: plain buildings fall behind units and high-value structures.
  const lowPriorityBuildings = (t: Entity): boolean => index.isLowPriorityBuilding(t);
  const minDist = weapon.minRange;
  const sight = Math.max(weapon.maxRange, SIGHT_RADIUS_NODES);
  // Original behavior: an advancing search starts at the unit's own node, so an archer sees an enemy inside
  // its dead zone and the chase steps it back out to its reach.
  const advanceNear = 0;

  const hunts = isHunterJob(ctx.content, attacker.jobType);
  // A hunter is never presence-gated, in any stance: its prey filter admits the passive wildlife the
  // presence grid discounts.
  const player = hunts ? null : (viewer?.player ?? null);

  // A held enemy stays held while it is still a live hostile it can reach, without the fog gate: the
  // original keeps its target until it is gone.
  const holdable = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t) && reachable(t);

  // A garrison outranks every stance: its search band is the tower-boosted reach (`weapon` already carries
  // the bonus), never the advance sight radius.
  if (stance.post !== null) {
    return {
      accept: adultOnly(world, generalAccept),
      minDist,
      searchRadius: weapon.maxRange,
      player,
      lowPriority: lowPriorityBuildings,
      lock: null,
      defend: null,
      hold: {
        keep: (t) => holdable(t) && inReachOf(terrain, world, ctx, here, t, weapon.maxRange),
        band: weapon,
      },
    };
  }

  // An advancing seeker also skips the enemies its chase gave up as sealed off, unless one stands inside its
  // band: only the walk is refused, so the swing lands the moment a defender steps out of its compound.
  const givenUp = givenUpTargetVeto(world, ctx, e);
  const inBand = (t: Entity): boolean => {
    const dist = hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, t));
    return dist >= weapon.minRange && dist <= weapon.maxRange;
  };
  const advanceAccept =
    givenUp === undefined
      ? generalAccept
      : (t: Entity): boolean => hostileInSight(t) && (!givenUp(t) || inBand(t)) && reachable(t);

  if (owned && !ordered && stance.mode === MILITARY_MODE.DEFEND) {
    const anchor = stanceAnchor(world, e, here);
    const nearAnchor = (t: Entity, reach: number): boolean =>
      hexNodeDistance(terrain, anchor, entityNode(world, terrain, t)) <= reach;
    // The radius clause leads: it is a subtraction, while `advanceAccept` ends in a walk of the candidate's
    // reach band.
    const accept = (t: Entity): boolean => nearAnchor(t, DEFEND_RADIUS_NODES) && advanceAccept(t);
    return {
      accept: adultOnly(world, accept),
      minDist: advanceNear,
      // Every node within the radius of the anchor lies within this of `here`.
      searchRadius: hexNodeDistance(terrain, here, anchor) + DEFEND_RADIUS_NODES,
      player,
      lowPriority: lowPriorityBuildings,
      lock: null,
      defend: { anchorCell: anchor, leash: DEFEND_LEASH_NODES + weapon.maxRange, metric: 'hex', hold: true },
      hold: { keep: (t) => nearAnchor(t, DEFEND_LEASH_NODES) && holdable(t), band: weapon },
    };
  }

  // Original behavior: a fighter under IGNORE strikes an enemy inside its weapon's reach where it stands,
  // and lets one go that strays past its leash.
  if (
    owned &&
    !ordered &&
    stance.mode === MILITARY_MODE.IGNORE &&
    isFighterJob(ctx.content, attacker.jobType)
  ) {
    const anchor = stanceAnchor(world, e, here);
    return {
      accept: adultOnly(world, (t) => inBand(t) && advanceAccept(t)),
      minDist,
      searchRadius: weapon.maxRange,
      player,
      lowPriority: lowPriorityBuildings,
      lock: null,
      defend: { anchorCell: anchor, leash: IGNORE_LEASH_NODES + weapon.maxRange, metric: 'hex', hold: true },
      hold: {
        keep: (t) =>
          hexNodeDistance(terrain, anchor, entityNode(world, terrain, t)) <= IGNORE_LEASH_NODES &&
          holdable(t),
        band: weapon,
      },
    };
  }

  if (
    owned &&
    !ordered &&
    stance.mode === MILITARY_MODE.IGNORE &&
    isHunterJob(ctx.content, attacker.jobType)
  ) {
    return hunterEngageSpec(
      world,
      ctx,
      terrain,
      index,
      e,
      here,
      attacker.jobType,
      seesTarget,
      givenUp,
      minDist,
      sight,
    );
  }

  // An unowned hostile animal advances like a soldier within its shorter ambush radius; any other unowned
  // combatant (a scenario civ) swings in place, its search capped at weapon reach.
  const animalSeeker = !owned && isAnimalTribe(ctx.content, attacker.tribe);
  if (owned) {
    return {
      accept: adultOnly(world, advanceAccept),
      minDist: advanceNear,
      searchRadius: sight,
      player,
      lowPriority: lowPriorityBuildings,
      lock: null,
      defend: null,
      hold: { keep: holdable, band: weapon },
    };
  }
  return {
    accept: advanceAccept,
    minDist,
    searchRadius: animalSeeker ? Math.max(weapon.maxRange, ANIMAL_AGGRO_RADIUS_NODES) : weapon.maxRange,
    player,
    animalSeeker,
    lowPriority: lowPriorityBuildings,
    lock: null,
    defend: null,
  };
}

/** `accept` narrowed to grown targets. Original behavior: a fighter picks no child for a target. */
function adultOnly(world: World, accept: (t: Entity) => boolean): (t: Entity) => boolean {
  return (t) => !world.has(t, Age) && accept(t);
}

/** Whether `t`'s combat node lies within `reach` map points of `here`. */
function inReachOf(
  terrain: TerrainGraph,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  t: Entity,
  reach: number,
): boolean {
  return hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, t)) <= reach;
}

export interface EngageSpec {
  /** The nearest search's per-candidate hostility/predation filter. */
  readonly accept: (t: Entity) => boolean;
  /** Near reach - the search ignores anything closer (a ranged weapon's dead zone). */
  readonly minDist: number;
  /** Far reach - how far the unit spots a target to swing at / advance on. Both reaches count map points,
   *  and the search orders its candidates by them. */
  readonly searchRadius: number;
  /** The seeker's player for the {@link CombatIndex.othersWithin} early-out; null when the seeker must
   *  never skip the search - an unowned one, or a hunter in any stance. */
  readonly player: number | null;
  /** A hostile wild animal seeking - gates on {@link CombatIndex.civsWithin} instead. */
  readonly animalSeeker?: boolean;
  /** A hunter seeking prey: its primary tier is always game {@link CombatIndex.gameWithin} tallies, so a hold
   *  on the deprioritized tier skips the search for something to yield to while none is in the band. */
  readonly preySeeker?: boolean;
  /** The deprioritized tier among accepted targets, searched only when the primary tier finds nothing in
   *  sight. It splits RAW search candidates ahead of {@link EngageSpec.accept}, so it must stay total
   *  and pure over any indexed entity - a friendly unit, an own building, a carcass. */
  readonly lowPriority: (t: Entity) => boolean;
  /** Target commitment: non-null for a stance that holds one target across ticks instead of re-acquiring
   *  the nearest candidate. `target` is the live hold, null when nothing is committed yet. */
  readonly lock: { readonly target: Entity | null } | null;
  /** Anchor leash: the chase never walks past `leash` of `anchorCell`, measured by `metric`; null when the
   *  chase is unbounded. `hold` walks the unit back to the anchor with no target in sight, false hands it
   *  back to the economy. */
  readonly defend: {
    readonly anchorCell: NodeId;
    readonly leash: number;
    readonly metric: SearchMetric;
    readonly hold: boolean;
  } | null;
  /** Present for an owned combatant that holds its enemy across ticks ({@link Engagement.target}) and picks
   *  a new one the original's way; `keep` says whether a held enemy is still held, and `band` is the reach
   *  it strikes one from. */
  readonly hold?: {
    readonly keep: (t: Entity) => boolean;
    readonly band: WeaponBand;
  };
}

/**
 * The enemy this combatant fights this tick with its reach from `here` in map points, or null. An
 * {@link AttackOrder} focus and a live `spec.lock` resolve ahead of the nearest search; a fighter's own
 * breach yields to a primary-tier target inside `weapon`'s band. Otherwise the nearest target `spec.accept`
 * admits within `[spec.minDist, spec.searchRadius]`, with the `spec.lowPriority` tier searched only when the
 * primary tier finds nothing in sight.
 */
export function resolveTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  spec: EngageSpec,
  weapon: WeaponBand,
): { target: Entity; dist: number } | null {
  const { index } = pass;
  const { x, y } = terrain.coordsOf(here);
  // The engage ladder already dropped an order whose target died or stopped being hostile this tick. An
  // ordered target is chased regardless of sight, so its real distance is measured, uncapped by the band.
  const order = world.tryGet(self, AttackOrder);
  if (order !== undefined) {
    // An enemy within a breaker's reach is fought first, and the wall taken up again once it is gone.
    const rival =
      order.breach?.enemy === undefined
        ? null
        : index.nearest(
            x,
            y,
            weapon.minRange,
            weapon.maxRange,
            (t) => !spec.lowPriority(t) && spec.accept(t),
            spec.player,
          );
    if (rival !== null) return { target: rival.entity, dist: rival.distance };
    return focusedOn(world, ctx, terrain, here, order.target);
  }
  if (spec.hold !== undefined) return heldOrPicked(world, ctx, terrain, pass, self, here, spec, spec.hold);
  const locked = spec.lock?.target ?? null;
  if (locked !== null) {
    // A commitment ignores `minDist`: prey that closes inside the weapon's dead zone is backed off by the
    // chase, not dropped. The tier rule still outranks it, so a hold on the deprioritized tier yields to
    // any primary-tier target in sight.
    const preempt =
      spec.lowPriority(locked) && (spec.preySeeker !== true || index.gameWithin(x, y, spec.searchRadius))
        ? index.nearest(
            x,
            y,
            spec.minDist,
            spec.searchRadius,
            (t) => !spec.lowPriority(t) && spec.accept(t),
            spec.player,
            SEARCH_METRIC,
          )
        : null;
    if (preempt !== null) return focusedOn(world, ctx, terrain, here, preempt.entity);
    return focusedOn(world, ctx, terrain, here, locked);
  }
  // Idle early-out (perf-only): when the coarse presence grid proves no member of a player at war with the
  // seeker either way, and no unowned one but passive wildlife, can be in the search band, both tier searches
  // would return null.
  if (spec.player !== null && !index.othersWithin(spec.player, x, y, spec.searchRadius)) return null;
  // The animal seeker's twin: no civ in the band proves both empty.
  if (spec.animalSeeker === true && !index.civsWithin(x, y, spec.searchRadius)) return null;
  // A nearer tier-2 target never preempts a tier-1 target in sight.
  const found = pickInBand(pass, spec, x, y, 'primary') ?? pickInBand(pass, spec, x, y, 'low');
  return found === null ? null : focusedOn(world, ctx, terrain, here, found.entity);
}

/** Every engage search counts map points, the metric weapon reach and the stances' radii share. */
const SEARCH_METRIC: SearchMetric = 'hex';

/** How many of the nearest candidates a pick draws among, and how much farther (map points) than the
 *  nearest one of them may stand. Original behavior. */
const PICK_CANDIDATES = 5;
const PICK_SPREAD_NODES = 3;

/**
 * The kinds of enemy a fighter looks for, in the order it looks: its first pass takes enemy fighters, then
 * military buildings, then wild animals; its second anyone else, then any building. Original behavior. The
 * military buildings here are the ones that are not {@link CombatIndex.isLowPriorityBuilding} (headquarters
 * and towers), an approximation of the original's own military house class. A vehicle joins the last pass on
 * a building's terms; where the original ranks a cart or ship is unconfirmed (approximation).
 */
const PICK_TIERS: readonly ((world: World, ctx: SystemContext, index: CombatIndex, t: Entity) => boolean)[] =
  [
    (world, ctx, _index, t) =>
      world.has(t, Person) && isFighterJob(ctx.content, world.get(t, Settler).jobType),
    (world, _ctx, index, t) => world.has(t, Building) && !index.isLowPriorityBuilding(t),
    (world, _ctx, _index, t) => isWildlife(world, t),
    (world, _ctx, _index, t) => world.has(t, Person),
    (world, _ctx, _index, t) => world.has(t, Building) || world.has(t, Vehicle),
  ];

/**
 * The enemy an owned combatant fights: the one it holds while its stance still keeps it, unless a rescan
 * finds one strictly nearer. Original behavior: a fighter keeps its target until it is gone or strays past
 * its leash, and a new scan takes over only a nearer enemy. It scans when it has no target, then while it
 * walks every tenth step ({@link RESCAN_WALK_STEPS}), and never between blows.
 */
function heldOrPicked(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  spec: EngageSpec,
  hold: NonNullable<EngageSpec['hold']>,
): { target: Entity; dist: number } | null {
  const heldTarget = world.tryGet(self, Engagement)?.target;
  const held =
    heldTarget !== undefined && world.isAlive(heldTarget) && hold.keep(heldTarget)
      ? focusedOn(world, ctx, terrain, here, heldTarget)
      : null;
  if (held !== null && !rescanDue(world, ctx, self, held.dist, hold.band)) return held;
  const { x, y } = terrain.coordsOf(here);
  if (
    held === null &&
    spec.player !== null &&
    !pass.index.othersWithin(spec.player, x, y, spec.searchRadius)
  ) {
    return null;
  }
  const picked = pickByTier(world, ctx, pass, spec, x, y);
  if (picked === null) return held;
  // A search hit lies at its distance to the nearest wall in the band; the reach check measures to the
  // nearest wall of all.
  const pickedAt = focusedOn(world, ctx, terrain, here, picked.entity);
  return held !== null && pickedAt.dist >= held.dist ? held : pickedAt;
}

/** How many walk steps a fighter takes between two looks for a nearer enemy. Original behavior. */
export const RESCAN_WALK_STEPS = 10;

/** {@link RESCAN_WALK_STEPS} in ticks: ten steps at the reference land pace of 8 ticks a step, 80 ticks,
 *  staggered by entity id. Approximation: the original counts the steps themselves, so here a walker slower
 *  than that pace looks a little more often per step and a faster one a little less, and a new enemy a look
 *  finds is walked toward from the chase's next re-path, up to {@link REPATH_CADENCE} ticks later. */
export const RESCAN_PERIOD_TICKS = RESCAN_WALK_STEPS * REFERENCE_STEP_TICKS;

/**
 * Whether a combatant holding a target `heldDist` map points off looks again this tick: every
 * {@link RESCAN_PERIOD_TICKS} while it walks, and never while it stands with the target in `band`. A unit
 * standing with its target out of reach, a second rank waiting for a side, looks every
 * {@link REPATH_CADENCE} ticks. Intentional deviation: in the original that unit would already be walking up
 * to fight from a taken side, so here it takes an enemy that steps up to it within about a step instead
 * of standing idle beside it.
 */
function rescanDue(
  world: World,
  ctx: SystemContext,
  self: Entity,
  heldDist: number,
  band: WeaponBand,
): boolean {
  if (isTravelling(world, self)) return onStride(ctx.tick, self, RESCAN_PERIOD_TICKS);
  if (heldDist >= band.minRange && heldDist <= band.maxRange) return false;
  return onStride(ctx.tick, self, REPATH_CADENCE);
}

/**
 * The original's pick: the first kind in {@link PICK_TIERS} with a candidate, and among its
 * {@link PICK_CANDIDATES} nearest within {@link PICK_SPREAD_NODES} of the nearest, one at random.
 */
function pickByTier(
  world: World,
  ctx: SystemContext,
  pass: CombatPass,
  spec: EngageSpec,
  x: number,
  y: number,
): { entity: Entity; distance: number } | null {
  for (const tier of PICK_TIERS) {
    const found = pass.index.nearestFew(
      x,
      y,
      spec.minDist,
      spec.searchRadius,
      (t) => tier(world, ctx, pass.index, t) && spec.accept(t),
      PICK_CANDIDATES,
      spec.player,
      PICK_SPREAD_NODES,
      SEARCH_METRIC,
    );
    if (found.length === 0) continue;
    const pick = found.length === 1 ? found[0] : found[ctx.rng.int(found.length)];
    if (pick !== undefined) return pick;
  }
  return null;
}

type TargetTier = 'primary' | 'low';

/** One priority tier's pick from the search band: the nearest target the stance admits. */
function pickInBand(
  pass: CombatPass,
  spec: EngageSpec,
  x: number,
  y: number,
  tier: TargetTier,
): { entity: Entity; distance: number } | null {
  const wantsLowPriority = tier === 'low';
  const accept = (t: Entity): boolean => spec.lowPriority(t) === wantsLowPriority && spec.accept(t);
  return pass.index.nearest(x, y, spec.minDist, spec.searchRadius, accept, spec.player, SEARCH_METRIC);
}

/** A focused target and its real distance from `here`, uncapped by the search band - a building
 *  measured at the wall the chase closes on. */
function focusedOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  target: Entity,
): { target: Entity; dist: number } {
  return {
    target,
    dist: hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, target)),
  };
}
