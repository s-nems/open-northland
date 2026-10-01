import {
  NODE_PROGRESS_FULL,
  type ShipHelm,
  Vehicle,
  VehicleDrive,
  WALK_DIRECTION,
  type WalkDirection,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import { headingToward, nextWalkDirection, walkTurnSteps } from '../movement/turning.js';

/** The ticks a vehicle takes to swing through one step of its heading ring (original behavior per
 *  hexagon direction; a human takes 1). Approximation: the ring here has eight headings, N and S
 *  between the diagonals, so a half turn takes 8 ticks where the original's six-direction one takes 6. */
export const VEHICLE_TURN_TICKS_PER_DIRECTION = 2;

/**
 * The heading a vehicle faces along a lattice step, the screen octant a walker would face: a vertical
 * half-row step is N or S, so a vehicle sails straight up or down on its drawn N/S frames. A zero step
 * keeps east.
 */
export function facingOfStep(from: HalfCellNode, to: HalfCellNode): WalkDirection {
  return headingToward(positionOfNode(from.hx, from.hy), positionOfNode(to.hx, to.hy)) ?? WALK_DIRECTION.E;
}

// A ship turns under way (owner's choice; the original pivots every vehicle on its node): it steers for a
// node a few legs ahead, so a lattice zigzag reads as one course, its hull swings one heading step per
// turn period while it keeps moving, and its way eases toward the most the angle between its hull and
// its leg allows, braking into a sharp change of course and onto its goal. The values are an
// approximation tuned by eye.

/** How many legs ahead a ship aims its course. */
const SHIP_AIM_LEGS = 3;

/** A ship's way at full speed: a tick adds the leg's whole increment. */
export const SHIP_FULL_WAY = 1000;
/** The most way a ship keeps with its hull this many heading steps off the leg it travels, 0..4: a
 *  lattice zigzag costs little, a reversal nearly stops it while the hull swings round. */
const SHIP_WAY_BY_SWING: readonly number[] = [SHIP_FULL_WAY, 850, 600, 200, 50];
/** The way a ship gathers or loses in one tick: from rest to full in under a second. */
const SHIP_WAY_GAIN = 100;
const SHIP_WAY_LOSS = 150;
/** The way a ship brakes to at its goal, so it glides onto it. */
const SHIP_LANDFALL_WAY = 300;
/** The leg progress left at which a ship starts braking into a change of course, and onto its goal:
 *  landfall brakes over the whole last leg, since the way sheds at most {@link SHIP_WAY_LOSS} a tick. */
const SHIP_CORNER_BRAKING = NODE_PROGRESS_FULL / 2;
const SHIP_LANDFALL_BRAKING = NODE_PROGRESS_FULL;

/** The course a ship steers from `from` with `route` the nodes to enter from index `step` on: toward
 *  the node {@link SHIP_AIM_LEGS} legs on, or the last one. Null with nothing ahead. */
export function shipCourse(
  from: HalfCellNode,
  route: readonly HalfCellNode[],
  step: number,
): WalkDirection | null {
  if (step >= route.length) return null;
  const aim = route[Math.min(step + SHIP_AIM_LEGS, route.length) - 1];
  return aim === undefined ? null : facingOfStep(from, aim);
}

/** The helm of a ship starting a drive from rest, facing `facing`. */
export function restingHelm(facing: WalkDirection): ShipHelm {
  return { heading: facing, way: 0, swing: VEHICLE_TURN_TICKS_PER_DIRECTION };
}

function wayForSwing(steps: number): number {
  return SHIP_WAY_BY_SWING[steps] ?? SHIP_WAY_BY_SWING[SHIP_WAY_BY_SWING.length - 1] ?? SHIP_FULL_WAY;
}

/** Swing a live `helm`'s hull one tick toward its heading; returns the facing after the tick. */
export function swingHull(world: World, e: Entity, helm: ShipHelm): WalkDirection {
  const facing = world.get(e, Vehicle).facing;
  if (facing === helm.heading) {
    helm.swing = VEHICLE_TURN_TICKS_PER_DIRECTION;
    return facing;
  }
  helm.swing--;
  if (helm.swing > 0) return facing;
  helm.swing = VEHICLE_TURN_TICKS_PER_DIRECTION;
  const swung = nextWalkDirection(facing, helm.heading);
  world.mut(e, Vehicle).facing = swung;
  return swung;
}

/** The most way a ship keeps `remaining` progress before a leg end it must cross at `endWay`: full
 *  until braking starts `braking` progress out, then down in a straight line to `endWay`. */
function approachWay(remaining: number, endWay: number, braking: number): number {
  if (remaining >= braking) return SHIP_FULL_WAY;
  return endWay + Math.floor(((SHIP_FULL_WAY - endWay) * remaining) / braking);
}

/**
 * One tick of a ship's leg along `travel`: the hull swings, the way eases toward the most the hull's
 * angle to `travel` and the approach to the leg's end allow (the change onto `nextCourse`, or the goal
 * when it is null), and the leg gains its increment scaled by that way. A leg just `entered` drops at
 * once to what the hull's angle allows, so a reversed leg never runs backwards at speed. Clears `from`
 * once the leg is complete.
 */
export function sailLeg(
  world: World,
  e: Entity,
  travel: WalkDirection,
  nextCourse: WalkDirection | null,
  entered: boolean,
): void {
  const drive = world.mut(e, VehicleDrive);
  const helm = drive.helm;
  if (helm === null) throw new Error(`vehicle ${e} sails without a helm`);
  const facing = swingHull(world, e, helm);
  const hullLimit = wayForSwing(walkTurnSteps(facing, travel));
  if (entered && helm.way > hullLimit) helm.way = hullLimit;
  const remaining = NODE_PROGRESS_FULL - drive.progress;
  const approach =
    nextCourse === null
      ? approachWay(remaining, SHIP_LANDFALL_WAY, SHIP_LANDFALL_BRAKING)
      : approachWay(remaining, wayForSwing(walkTurnSteps(helm.heading, nextCourse)), SHIP_CORNER_BRAKING);
  const target = Math.min(hullLimit, approach);
  helm.way =
    helm.way < target
      ? Math.min(target, helm.way + SHIP_WAY_GAIN)
      : Math.max(target, helm.way - SHIP_WAY_LOSS);
  drive.progress += Math.floor((drive.increment * helm.way) / SHIP_FULL_WAY);
  if (drive.progress >= NODE_PROGRESS_FULL) {
    drive.from = null;
    drive.progress = 0;
  }
}
