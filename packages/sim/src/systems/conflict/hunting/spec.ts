import { Health, HuntFocus } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { openGatherGoods } from '../../economy/gather-goods.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import type { CombatIndex } from '../combat-index.js';
import type { EngageSpec } from '../engagement.js';
import { isHuntTarget } from '../targeting.js';
import { groundDistance, HUNT_CHASE_SLACK_NODES, huntingGround } from './ground.js';
import { huntingGroundHoldsCarcass } from './kill-claim.js';
import { preyHeldByOthers } from './prey-holds.js';

// The prey-acquisition policy an owned IGNORE hunter engages under.

/**
 * Original behavior: a candidate scores its map-point distance from the hunter plus its hit points, and
 * one scoring this much or more is never picked, so a tough animal such as the chicken is left alone.
 */
export const HUNT_PREY_SCORE_CEILING = 10000;

/**
 * The hunter's target-acquisition spec, and the owner of the one-kill-at-a-time rule: while the ground
 * holds a harvestable carcass the hunter takes no new target. Original behavior: the hunter plucks a
 * cadaver first, keeps the animal it already drew on while that stays valid, and otherwise searches its
 * ground (fog unread) for the game {@link pickPrey} ranks. A hunter with neither flag nor workplace hunts
 * by plain sight, unanchored.
 *
 * The hunter's own pick fills the `lock`, so the generic nearest search is given no band: anything it
 * could find, the pick has already weighed. The lock holds the animal out to the chase leash rather than
 * the acquisition radius: prey bolts on the first arrow, so expiring at the acquisition line would drop
 * the very animal the hunter is shooting at. Building the spec mutates - a lock the rules no longer admit
 * is reaped as it is read.
 */
export function hunterEngageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
  hereNode: NodeId,
  jobType: number | null,
  givenUp: ((t: Entity) => boolean) | undefined,
  minDist: number,
  sight: number,
): EngageSpec {
  const hunterComponent = terrain.componentOf(hereNode);
  // Lazily resolved on the first candidate: a hunter that never reaches one pays nothing for the lookup.
  let colleagueHolds: ((t: Entity) => boolean) | null = null;
  const heldByColleague = (t: Entity): boolean => {
    colleagueHolds ??= preyHeldByOthers(world, e);
    return colleagueHolds(t);
  };
  const reachablePrey = (t: Entity): boolean => preyOnBank(world, ctx, terrain, t, jobType, hunterComponent);
  // A hunter whose production counters stop every good it plucks takes no game at all; resolved on first
  // use like the colleague lookup.
  let huntsAny: boolean | null = null;
  const hunts = (): boolean => {
    if (huntsAny === null) {
      const open = jobType === null ? undefined : openGatherGoods(world, ctx, e, jobType);
      huntsAny = open === undefined || open.size > 0;
    }
    return huntsAny;
  };
  const acceptPrey = (t: Entity): boolean =>
    hunts() && reachablePrey(t) && !heldByColleague(t) && (givenUp === undefined || !givenUp(t));
  // `player` is null in every hunter spec: a hunter is never presence-gated, in any stance.
  const ground = huntingGround(world, terrain, e);
  if (ground === null) {
    // Unanchored (an unposted fixture): plain sight bounds the acquisition, so it bounds the hold too.
    const inSight = (t: Entity): boolean =>
      hexNodeDistance(terrain, hereNode, entityNode(world, terrain, t)) <= sight;
    const held = livePrey(world, e, (t) => acceptPrey(t) && inSight(t));
    const target =
      held ?? (hunts() ? pickPrey(world, terrain, index, hereNode, hereNode, sight, acceptPrey) : null);
    return {
      accept: acceptPrey,
      minDist,
      searchRadius: 0,
      player: null,
      preySeeker: true,
      lowPriority: noLowerTier,
      lock: { target },
      defend: null,
    };
  }
  // Probed at most once per engage.
  let carcassWork: boolean | null = null;
  const groundHasCarcassWork = (): boolean =>
    (carcassWork ??= huntingGroundHoldsCarcass(world, ctx, terrain, e, jobType, ground));
  const within = (t: Entity, reach: number): boolean =>
    groundDistance(terrain, ground.anchorCell, entityNode(world, terrain, t)) <= reach;
  const accept = (t: Entity): boolean => acceptPrey(t) && within(t, ground.radius);
  const leash = ground.radius + HUNT_CHASE_SLACK_NODES;
  const held = livePrey(world, e, (t) => acceptPrey(t) && within(t, leash) && !groundHasCarcassWork());
  const target =
    held ??
    (hunts() && !groundHasCarcassWork()
      ? pickPrey(world, terrain, index, hereNode, ground.anchorCell, ground.radius, accept)
      : null);
  return {
    accept,
    minDist,
    searchRadius: 0,
    player: null,
    preySeeker: true,
    lowPriority: noLowerTier,
    lock: { target },
    defend: { anchorCell: ground.anchorCell, leash, hold: false },
  };
}

const noLowerTier = (): boolean => false;

/** Every candidate in the band is weighed, so the take never stops early. */
const ALL_CANDIDATES = Number.POSITIVE_INFINITY;

/**
 * The game a hunter standing on `here` draws on among those `accept` admits within `radius` of `center`.
 * Original behavior: the lowest map-point distance from the hunter plus current hit points wins, so a
 * weak animal beats a near tough one, and nothing scores at or past {@link HUNT_PREY_SCORE_CEILING}.
 * Approximation: a tie goes to the candidate nearest `center`, then the lowest id.
 */
function pickPrey(
  world: World,
  terrain: TerrainGraph,
  index: CombatIndex,
  here: NodeId,
  center: NodeId,
  radius: number,
  accept: (t: Entity) => boolean,
): Entity | null {
  const { x, y } = terrain.coordsOf(center);
  let best: Entity | null = null;
  let bestScore = HUNT_PREY_SCORE_CEILING;
  // Game is a settler, so no building or vehicle node need enter the band.
  const game = index.nearestFew(x, y, 0, radius, accept, ALL_CANDIDATES, null, radius, 'hex', true);
  for (const { entity } of game) {
    const score = preyScore(world, terrain, here, entity);
    if (score < bestScore) {
      best = entity;
      bestScore = score;
    }
  }
  return best;
}

/** Prey `t`'s rank for a hunter standing on `here`, lower first: its map-point distance plus its hit
 *  points. Only a score below {@link HUNT_PREY_SCORE_CEILING} is ever picked. */
export function preyScore(world: World, terrain: TerrainGraph, here: NodeId, t: Entity): number {
  const hitpoints = world.tryGet(t, Health)?.hitpoints ?? 0;
  return hexNodeDistance(terrain, here, entityNode(world, terrain, t)) + hitpoints;
}

/**
 * Whether `t` is game `jobType` may hunt standing on terrain component `bank`. Original behavior: the
 * search takes only animals in the hunter's own walk sector, so game across a static terrain seam is not
 * this hunter's, and a kill it cannot walk to is a carcass no hunter may ever bank.
 */
export function preyOnBank(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  t: Entity,
  jobType: number | null,
  bank: number,
): boolean {
  return isHuntTarget(world, ctx, t, jobType) && terrain.componentOf(entityNode(world, terrain, t)) === bank;
}

/** Commit `target` as this hunter's prey - the write half of the `lock` the spec reads back. A stance that
 *  re-acquires freely instead sheds a hold left from an earlier one. A hold already on `target` is left
 *  untouched, keeping a long chase off the store's change generations; a new prey keeps the need-break pace. */
export function holdPrey(world: World, e: Entity, spec: EngageSpec, target: Entity): void {
  if (spec.lock === null) {
    world.remove(e, HuntFocus);
    return;
  }
  const held = world.tryGet(e, HuntFocus);
  if (held?.target === target) return;
  const needBreakAt = held?.needBreakAt;
  world.add(e, HuntFocus, needBreakAt === undefined ? { target } : { target, needBreakAt });
}

/** The prey this hunter is still committed to - its {@link HuntFocus} target while `holds` admits it, else
 *  null with the lapsed lock reaped here. `holds` runs only when a lock exists, keeping the carcass probe
 *  it closes over off the empty-handed path. */
function livePrey(world: World, e: Entity, holds: (t: Entity) => boolean): Entity | null {
  const focus = world.tryGet(e, HuntFocus);
  if (focus === undefined) return null;
  if (holds(focus.target)) return focus.target;
  world.remove(e, HuntFocus);
  return null;
}
