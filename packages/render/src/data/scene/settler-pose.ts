import { ONE } from '../projection/index.js';
import type { SpriteState } from './draw-item.js';
import { TARGET_FACING_ATOMIC_IDS } from './snapshot-index.js';
import {
  facingTowardTile,
  readActingAtomic,
  readAtomicTargetEntity,
  readSpriteState,
} from './snapshot-readers/index.js';

export interface SettlerPose {
  readonly state: SpriteState;
  readonly actingAtomic: number | null;
  readonly targetFacing: number | undefined;
}

/** Motionless standing - what a non-settler draws, and what an indoor settler is forced to so a path or
 *  atomic left running from the tick it stepped inside cannot leave it walking or mid-swing. */
export const STANDING_POSE: SettlerPose = { state: 'idle', actingAtomic: null, targetFacing: undefined };

/** An outdoor settler's drawn pose. A mid-swing settler only turns: the swing frames carry their own
 *  advance in the per-frame foot offsets, so nudging the anchor toward the target would double it. */
export function settlerPose(
  components: Readonly<Record<string, unknown>>,
  tileX: number,
  tileY: number,
  targetPositions: ReadonlyMap<number, { x: number; y: number }>,
): SettlerPose {
  const actingAtomic = readActingAtomic(components);
  let targetFacing: number | undefined;
  if (actingAtomic !== null && TARGET_FACING_ATOMIC_IDS.has(actingAtomic)) {
    const targetRef = readAtomicTargetEntity(components);
    const to = targetRef !== null ? targetPositions.get(targetRef) : undefined;
    if (to !== undefined) {
      targetFacing = facingTowardTile({ x: tileX, y: tileY }, { x: to.x / ONE, y: to.y / ONE });
    }
  }
  return { state: readSpriteState(components), actingAtomic, targetFacing };
}
