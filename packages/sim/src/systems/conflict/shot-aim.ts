import { PathFollow, PathRoute, Position } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { worldDistance } from '../../nav/world-metric.js';
import type { SystemContext } from '../context.js';
import { stepTowardPoint } from '../movement/stepping.js';
import { walkPacePerTick } from '../movement/system.js';

/** The map points a shot of `speed 1` crosses in eight ticks. Original behavior: a shot over `d` map points
 *  flies `d * 8 / speed` ticks, so a bow's `speed 8` crosses one map point a tick. */
const FLIGHT_TICKS_PER_POINT_AT_SPEED_ONE = 8;

/** The ticks a shot of extracted `speed` takes over `distance` map points; at least one, so it never lands
 *  on the tick it is loosed. Original behavior. */
export function shotFlightTicks(distance: number, speed: number): number {
  return Math.max(1, Math.trunc((distance * FLIGHT_TICKS_PER_POINT_AT_SPEED_ONE) / speed));
}

/** The map-point distance between two positions, measured node to node. */
export function mapPointDistance(from: { x: Fixed; y: Fixed }, to: { x: Fixed; y: Fixed }): number {
  return hexDistanceBetween(
    nodeHxOfPosition(from.x, from.y),
    nodeHyOfPosition(from.y),
    nodeHxOfPosition(to.x, to.y),
    nodeHyOfPosition(to.y),
  );
}

/**
 * Where a walking `target` will stand when a shot loosed from `from` comes down: its position carried
 * along its route by the pace it walks for the flight's ticks. Original behavior: a settler leads a
 * moving target by its step pace times the flight time to where it stands now, plus the part of its
 * current step already walked, which the target's position here already holds; a defence-mode building
 * does not lead. Following the route rather than the current heading is an approximation.
 */
export function leadPoint(
  world: World,
  ctx: SystemContext,
  from: { x: Fixed; y: Fixed },
  target: Entity,
  speed: number,
): { x: Fixed; y: Fixed } {
  const at = world.get(target, Position);
  const lead = { x: at.x, y: at.y };
  const pace = walkPacePerTick(world, ctx, target);
  const pf = world.tryGet(target, PathFollow);
  const stops = world.tryGet(target, PathRoute)?.waypoints;
  if (pace === null || pf === undefined || stops === undefined) return lead;
  let budget = fx.mul(pace, fx.fromInt(shotFlightTicks(mapPointDistance(from, at), speed)));
  for (let i = pf.index; i < stops.length && budget > 0; i++) {
    const stop = stops[i];
    if (stop === undefined) break;
    const leg = worldDistance(lead.x, lead.y, stop.x, stop.y);
    if (!stepTowardPoint(lead, stop, budget)) break;
    budget = fx.sub(budget, leg);
  }
  return lead;
}

/** A shot's scatter reaches up to a quarter of its range. Original behavior. */
const SCATTER_RANGE_DIVISOR = 4;

/** A settler's aim roll spans 0..99. A roll at or under its bow hits plus this base shoots true; a higher one
 *  scatters the more the further it overshoots. Original behavior. */
const AIM_ROLL_SPAN = 100;
const AIM_TRUE_BASE = 10;

/**
 * The scatter of a settler's shot over `distance` nodes, by the hits it has landed with a bow. A novice's
 * long shot mostly strays, and a bowman past 89 hits never does. Original behavior, which reads the bow
 * count for any ranged weapon; the caller spares a hero, who always shoots true.
 */
export function marksmanSpread(ctx: SystemContext, distance: number, bowHits: number): number {
  const roll = ctx.rng.int(AIM_ROLL_SPAN);
  const threshold = bowHits + AIM_TRUE_BASE;
  if (roll <= threshold) return 0;
  return Math.floor(((roll - threshold) * Math.floor(distance / SCATTER_RANGE_DIVISOR)) / roll);
}

/** A defence-mode building's scatter divides its reach by a roll of 1..30. Original behavior. */
const SHELTER_SCATTER_ROLL_SPAN = 30;

/** The scatter of a defence-mode building's shot over `distance` nodes: most land true and a long one
 *  sometimes lands a few nodes off. Original behavior. */
export function shelterSpread(ctx: SystemContext, distance: number): number {
  return Math.floor(
    Math.floor(distance / SCATTER_RANGE_DIVISOR) / (ctx.rng.int(SHELTER_SCATTER_ROLL_SPAN) + 1),
  );
}

/** `mark` shifted by a draw of up to `spread` nodes in each axis, centred on it. Original behavior. */
export function scatteredNode(
  ctx: SystemContext,
  terrain: TerrainGraph,
  mark: NodeId,
  spread: number,
): NodeId {
  if (spread <= 0) return mark;
  const half = Math.floor(spread / 2);
  const dx = ctx.rng.int(spread + 1) - half;
  const dy = ctx.rng.int(spread + 1) - half;
  return terrain.nodeAtClamped(terrain.xOf(mark) + dx, terrain.yOf(mark) + dy);
}
