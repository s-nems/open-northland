import { WALK_DIRECTION, type WalkDirection, WalkFacing } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { ROW_STEP, worldX } from '../../nav/world-metric.js';

const { E, SE, SW, W, NW, NE, N, S } = WALK_DIRECTION;

// The original enables eight-direction turning for humans, with this ring and these
// opposite-heading ties.
const TURN_RING: readonly WalkDirection[] = [E, SE, S, SW, W, NW, N, NE];
const RING_SIZE = TURN_RING.length;
const HALF_TURN = RING_SIZE / 2;

/** The original's initial orientation for a walker that has never turned. */
const INITIAL_DIRECTION: WalkDirection = SW;

/** tan(22.5°) in parts per {@link OCTANT_TAN_SCALE}: a heading within it of an axis snaps to that axis. */
const OCTANT_EDGE_TAN = 4142;
const OCTANT_TAN_SCALE = 10000;

export function nextWalkDirection(from: WalkDirection, to: WalkDirection): WalkDirection {
  if (from === to) return to;
  const start = TURN_RING.indexOf(from);
  let delta = TURN_RING.indexOf(to) - start;
  if (Math.abs(delta) > HALF_TURN) delta -= Math.sign(delta) * RING_SIZE;
  // Opposite E/W turns pass south; opposite N/S turns pass east.
  if (Math.abs(delta) === HALF_TURN && (from === N || from === S)) delta = -delta;
  return TURN_RING[(start + Math.sign(delta) + RING_SIZE) % RING_SIZE] ?? to;
}

type Point = { readonly x: Fixed; readonly y: Fixed };

export function beginWalkTurn(world: World, e: Entity, from: Point, to: Point): void {
  if (from.x === to.x && from.y === to.y) return;
  const dx = worldX(to.x, to.y) - worldX(from.x, from.y);
  const dy = fx.mul(fx.sub(to.y, from.y), ROW_STEP);
  // Nearest screen octant for an off-node recovery leg; lattice edges lie well away from the octant
  // boundaries, so their eight headings are exact.
  const horizontal = Math.abs(dy) * OCTANT_TAN_SCALE <= Math.abs(dx) * OCTANT_EDGE_TAN;
  const vertical = Math.abs(dx) * OCTANT_TAN_SCALE <= Math.abs(dy) * OCTANT_EDGE_TAN;
  const target: WalkDirection = horizontal
    ? dx > 0
      ? E
      : W
    : vertical
      ? dy > 0
        ? S
        : N
      : dy > 0
        ? dx > 0
          ? SE
          : SW
        : dx > 0
          ? NE
          : NW;
  const facing = world.tryGet(e, WalkFacing);
  if (facing === undefined) world.add(e, WalkFacing, { direction: INITIAL_DIRECTION, target });
  else if (facing.target !== target) world.mut(e, WalkFacing).target = target;
}

/** The last turn tick also advances the step accumulator; earlier turn ticks hold it. */
export function finishWalkTurn(world: World, e: Entity): boolean {
  const facing = world.tryGet(e, WalkFacing);
  if (facing === undefined || facing.direction === facing.target) return true;
  const next = nextWalkDirection(facing.direction, facing.target);
  world.mut(e, WalkFacing).direction = next;
  return next === facing.target;
}
