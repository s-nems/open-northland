import {
  type CurrentAtomicState,
  HarvestFocus,
  Position,
  Settler,
  type SettlerIdentity,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { atomicDuration } from '../../readviews/animations.js';

/**
 * What follows a counted stroke that leaves its node standing. Original behavior: after a transform
 * stroke (tree, herb, wheat) the same clip plays once more and lands nothing, one of the three short idle
 * clips follows, and the gatherer then picks its target and stance afresh; a split-up stroke (stone, clay,
 * ore) keeps the target, so the next clip starts at once from the same stance and counts.
 */

/** The running atomic's clock, as `world.mut(e, AtomicClock)` hands it out. */
interface Clock {
  elapsed: number;
}

/** The three short idle slots (`setatomic <job> 2..4`) a stroke's rest is drawn from. */
export const STROKE_REST_ATOMIC_IDS: readonly number[] = [2, 3, 4];

/** Remember the part-worked node on the settler, dropping any stance, so its next plan returns to the
 *  node from a fresh stance. */
export function rememberHarvestNode(world: World, settler: Entity, node: Entity): void {
  world.add(settler, HarvestFocus, { node });
}

/** Remember the part-worked node together with the stance the stroke was struck from, so the next plan
 *  takes the node up again without moving. */
export function holdHarvestStance(world: World, ctx: SystemContext, settler: Entity, node: Entity): void {
  const terrain = ctx.terrain;
  const position = world.tryGet(settler, Position);
  if (terrain === undefined || position === undefined) {
    world.add(settler, HarvestFocus, { node });
    return;
  }
  const { hx, hy } = nodeOfPosition(position.x, position.y);
  world.add(settler, HarvestFocus, { node, stance: terrain.nodeAtClamped(hx, hy) });
}

/** Re-arm the just-completed counted stroke as its follow-through: the same clip, no effect. */
export function armStrokeFollowThrough(atomic: CurrentAtomicState, clock: Clock, node: Entity): void {
  atomic.effect = { kind: 'harvestFollowThrough', resource: node };
  clock.elapsed = 0;
}

/** Re-arm the just-completed follow-through as the stroke's rest: a short idle slot drawn from the
 *  sim's stream, timed by the settler's own clip for it. */
export function armStrokeRest(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: CurrentAtomicState,
  clock: Clock,
): void {
  const identity: SettlerIdentity = world.get(settler, Settler);
  const atomicId = STROKE_REST_ATOMIC_IDS[ctx.rng.int(STROKE_REST_ATOMIC_IDS.length)];
  if (atomicId === undefined) throw new Error('the stroke rest slots are never empty');
  atomic.atomicId = atomicId;
  atomic.duration = atomicDuration(ctx.content, identity, atomicId);
  atomic.effect = { kind: 'idle' };
  atomic.targetEntity = null;
  clock.elapsed = 0;
}
