import { type WalkDirection, WalkFacing } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { ROW_STEP, worldX } from '../../nav/world-metric.js';

// the original: an original routine an original address enables eight-direction turning;
// VE_HexagonDirection_NextDirection 0x10013bd30 confirms the ring and opposite-heading ties.
const TURN_RING: readonly WalkDirection[] = [0, 1, 7, 2, 3, 4, 6, 5];

export function nextWalkDirection(from: WalkDirection, to: WalkDirection): WalkDirection {
  if (from === to) return to;
  const start = TURN_RING.indexOf(from);
  let delta = TURN_RING.indexOf(to) - start;
  if (Math.abs(delta) > 4) delta -= Math.sign(delta) * 8;
  // Opposite E/W turns pass south; opposite N/S turns pass east.
  if (Math.abs(delta) === 4 && (from === 6 || from === 7)) delta = -delta;
  return TURN_RING[(start + Math.sign(delta) + 8) % 8] ?? to;
}

type Point = { readonly x: Fixed; readonly y: Fixed };

export function beginWalkTurn(world: World, e: Entity, from: Point, to: Point): void {
  const dx = worldX(to.x, to.y) - worldX(from.x, from.y);
  const dy = fx.mul(fx.sub(to.y, from.y), ROW_STEP);
  // Nearest screen octant for an off-node recovery leg. 4142/10000 approximates tan(22.5°);
  // lattice edges lie well away from those boundaries, so their eight headings are exact.
  const horizontal = Math.abs(dy) * 10000 <= Math.abs(dx) * 4142;
  const vertical = Math.abs(dx) * 10000 <= Math.abs(dy) * 4142;
  const target: WalkDirection = horizontal
    ? dx > 0
      ? 0
      : 3
    : vertical
      ? dy > 0
        ? 7
        : 6
      : dy > 0
        ? dx > 0
          ? 1
          : 2
        : dx > 0
          ? 5
          : 4;
  const facing = world.tryGet(e, WalkFacing);
  // an original routine (0x10013e4e0) initializes the orientation to SW.
  if (facing === undefined) world.add(e, WalkFacing, { direction: 2, target });
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
