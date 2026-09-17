import { ONE } from '../projection/index.js';
import { gfxDirToFacing } from '../sprites/settler.js';
import type { SpriteState } from './draw-item.js';
import {
  type InHouseOverlay,
  type InHousePose,
  type InHouseProgramLookup,
  inHouseOverlays,
  inHousePose,
} from './in-house.js';
import { TARGET_FACING_ATOMIC_IDS } from './snapshot-index.js';
import {
  facingTowardTile,
  readActingAtomic,
  readAtomicTargetEntity,
  readCraftPerformance,
  readJobType,
  readSettlerTribe,
  readSpriteState,
  readVehicleDriving,
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

/** A vehicle's drawn pose: driving or standing, read off its own drive rather than a settler's path. Its
 *  attack is a standing task rather than an atomic, so the binding reads it from the item's `task`. */
export function vehiclePose(components: Readonly<Record<string, unknown>>): SettlerPose {
  return {
    state: readVehicleDriving(components) ? 'moving' : 'idle',
    actingAtomic: null,
    targetFacing: undefined,
  };
}

/** A worker at its craft: the house tile its drawn anchor and depth come from, and the clip clock and
 *  join keys its choreography is looked up by. Cheap enough to read before the viewport cull. */
export interface CraftAnchor {
  /** The workplace's own tile, which the item anchors, depth-sorts and culls against. */
  readonly tileX: number;
  readonly tileY: number;
  readonly tribe: number;
  readonly job: number;
  readonly action: number;
  readonly elapsed: number;
  readonly duration: number;
}

/** A worker drawn inside its workplace: the pose its program puts it in, ready for the draw item, and
 *  the effects the program stages beside it at this moment. */
export interface InHouseDraw {
  readonly pose: SettlerPose;
  readonly inHouse: InHousePose;
  readonly overlays: readonly InHouseOverlay[];
}

/**
 * Where a settler performing a craft anchors, or `undefined` when it runs none or its workplace has left
 * the snapshot. Reads components only, so the caller can cull on the returned tile before paying for the
 * choreography lookup.
 */
export function craftAnchorOf(
  components: Readonly<Record<string, unknown>>,
  positions: ReadonlyMap<number, { x: number; y: number }>,
): CraftAnchor | undefined {
  const craft = readCraftPerformance(components);
  if (craft === null) return undefined; // the common indoor case: no craft, no further reads
  const action = readActingAtomic(components);
  const tribe = readSettlerTribe(components);
  const job = readJobType(components);
  if (action === null || tribe === undefined || job === undefined) return undefined;
  const at = positions.get(craft.workplace);
  if (at === undefined) return undefined;
  return {
    tileX: at.x / ONE,
    tileY: at.y / ONE,
    tribe,
    job,
    action,
    elapsed: craft.elapsed,
    duration: craft.duration,
  };
}

/** The pose `anchor`'s choreography puts its worker in, or `undefined` when nothing choreographs that
 *  `(tribe, job, action)`. */
export function inHouseDrawAt(
  anchor: CraftAnchor,
  lookup: InHouseProgramLookup | undefined,
): InHouseDraw | undefined {
  const program = lookup?.(anchor.tribe, anchor.job, anchor.action);
  if (program === undefined) return undefined;
  const pose = inHousePose(program, anchor.elapsed, anchor.duration);
  return {
    pose: { state: pose.state, actingAtomic: null, targetFacing: gfxDirToFacing(pose.dir) },
    inHouse: pose,
    overlays: inHouseOverlays(program, anchor.elapsed, anchor.duration),
  };
}
