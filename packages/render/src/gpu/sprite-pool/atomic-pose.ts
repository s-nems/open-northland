import { clamp01 } from '../../data/math.js';
import type { DrawItem } from '../../data/scene/index.js';

export interface AtomicPoseTrack {
  tick: number;
  item: DrawItem | undefined;
}

/** Own-art work advances within the current sim tick, including the final planner-gap tick. */
export function interpolateAtomicPose(item: DrawItem, alpha: number): DrawItem {
  if (
    item.kind !== 'settler' ||
    item.state !== 'acting' ||
    item.atomicId === undefined ||
    item.elapsed === undefined ||
    item.inHouse === true ||
    item.craftClip !== undefined ||
    item.frozen === true ||
    item.ghost === true
  )
    return item;
  return { ...item, elapsed: Math.max(1, item.elapsed + clamp01(alpha)) };
}

/** The executor retires a completed atomic one tick before the planner can start its successor. */
export function atomicPose(item: DrawItem, tick: number, track: AtomicPoseTrack): DrawItem {
  if (item.kind !== 'settler' || item.inHouse === true || item.frozen === true || item.ghost === true) {
    track.item = undefined;
    return item;
  }
  if (item.state === 'acting' && item.atomicId !== undefined && item.elapsed !== undefined) {
    track.tick = tick;
    track.item = item;
    return item;
  }
  const last = track.item;
  if (
    last !== undefined &&
    last.atomicId !== undefined &&
    last.elapsed !== undefined &&
    item.state === 'idle' &&
    tick === track.tick + 1 &&
    item.x === last.x &&
    item.y === last.y &&
    item.jobType === last.jobType &&
    item.tribe === last.tribe &&
    item.carrying === last.carrying &&
    item.carryGood === last.carryGood &&
    item.engaged === last.engaged &&
    item.weaponGood === last.weaponGood &&
    item.armorGood === last.armorGood &&
    item.young === last.young
  ) {
    return {
      ...item,
      state: 'acting',
      atomicId: last.atomicId,
      elapsed: last.elapsed + 1,
      ...(last.atomicRest === true ? { atomicRest: true } : {}),
      ...(last.facing === undefined ? {} : { facing: last.facing }),
    };
  }
  track.item = undefined;
  return item;
}
