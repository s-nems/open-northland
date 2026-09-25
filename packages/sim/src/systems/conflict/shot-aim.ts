import { PathFollow, PathRoute, Position } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { worldDistance } from '../../nav/world-metric.js';
import type { SystemContext } from '../context.js';
import { stepTowardPoint } from '../movement/stepping.js';
import { walkPacePerTick } from '../movement/system.js';

/**
 * How many tiles a projectile advances per tick per unit of the weapon's extracted `WeaponType.speed` - the
 * mapping of the unreadable `speed` unit onto the sim's tile/tick grid. A bow's `speed 8` gives 1 tile/tick,
 * 18x a settler's walk; a catapult's `speed 3` gives ⅜ tile/tick. An ⅛-tile-per-unit step keeps every real
 * `speed` (3..8) on an integer fraction of ONE, so no rounding drift enters and two runs stay byte-identical.
 * Tiles here are raw grid units, which makes this the east-west pace: the flight does not weight a row
 * step, and one draws 38 px against a column's 68.
 *
 * Approximated, calibration-pending (source basis "Combat ranged projectiles"): the source carries `speed`'s
 * value verbatim but not its unit, so this scale is tuned by eye against the drawn flight, not a data param.
 */
export const PROJECTILE_TILES_PER_SPEED_UNIT: Fixed = fx.div(fx.fromInt(1), fx.fromInt(8)); // ⅛ tile/tick per speed unit

/** The per-tick tile step a projectile of extracted `speed` advances. The launch gate guarantees a positive
 *  `speed`, so the step is positive and a projectile always closes on its target. */
export function projectileStep(speed: number): Fixed {
  return fx.mul(fx.fromInt(speed), PROJECTILE_TILES_PER_SPEED_UNIT);
}

/** The ticks a shot loosed at `from` takes to strike at `to`: its flight, plus the tick it rests at the
 *  bow before the flight and the tick it is held at the aim before contact. */
function flightTicks(from: { x: Fixed; y: Fixed }, to: { x: Fixed; y: Fixed }, speed: number): number {
  const dx = fx.sub(to.x, from.x);
  const dy = fx.sub(to.y, from.y);
  const chord = fx.isqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
  return Math.ceil(chord / projectileStep(speed)) + 1;
}

/**
 * Where a walking `target` will stand when a shot loosed from `from` comes down: its position carried
 * along its route by the pace it walks for the flight's ticks. Original behavior: a settler leads a
 * moving target along its walk; a defence-mode building does not. Following the route rather than the
 * current heading is an approximation.
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
  let budget = fx.mul(pace, fx.fromInt(flightTicks(from, at, speed)));
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
