import type { DrawItem } from '../../data/scene/index.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { type AtomicPoseTrack, atomicPose, interpolateAtomicPose } from './atomic-pose.js';
import { characterGaitRate, characterInterpolatesMotion } from './character-layers.js';
import { drawAlphaForKind, type MotionTrack, snapDistanceForKind, trackMotion } from './motion.js';
import { easeReveal, motionClocks, revealedItem, walkPose } from './presentation.js';
import { resolveLayers } from './resolve-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/**
 * What one drawn entity carries between frames to present as the map does: its inter-tick motion, the
 * atomic it last acted, the facing it last drew with and the eased construction reveal. A pooled
 * entity holds one; a card that draws the same figure elsewhere holds its own.
 */
export interface PresentationTrack {
  readonly kind: SpriteKind;
  readonly motion: MotionTrack;
  readonly atomicPose: AtomicPoseTrack;
  /** Last real facing (0..7) this settler drew with, reused across the one-tick heading gap a re-pathing
   *  unit shows. */
  lastFacing?: number;
  /** The displayed bottom-up reveal fraction (0..1) of an under-construction building, eased toward the
   *  sim's reported progress; `undefined` when nothing is in progress. Declared present rather than
   *  optional so the entity's shape never changes when a reveal first appears. */
  reveal: number | undefined;
}

export function createPresentationTrack(kind: SpriteKind): PresentationTrack {
  return {
    kind,
    reveal: undefined,
    atomicPose: { tick: -1, item: undefined },
    motion: {
      tick: -1,
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      drawX: 0,
      drawY: 0,
      rotation: 0,
      prevRotation: 0,
      drawRotation: 0,
      gaitPhase: 0,
      prevGaitPhase: 0,
      stillTicks: 0,
      snapDistance: snapDistanceForKind(kind),
    },
  };
}

/**
 * Advance `track` to this frame and resolve the layers the item draws: the atomic's cadence, the gait
 * clock and the walk-pose gaps all come from the track, so a figure presented from it anywhere moves as
 * on the map. The drawn anchor lands in `track.motion.drawX/drawY`.
 */
export function presentItem(
  track: PresentationTrack,
  item: DrawItem,
  tick: number,
  frameAlpha: number,
  sheet: SpriteSheet | undefined,
  environmentMotion = false,
): ResolvedLayer[] | null {
  if (track.motion.tick === -1) track.atomicPose.item = undefined;
  const atomic = atomicPose(item, tick, track.atomicPose);
  // An original walker keeps its tick anchor under the motion setting too: its clip plays one authored
  // frame per tick, so the body may only move with the frame, as the original engine steps it. Moving
  // it inside a frame hold drags the planted foot along the ground.
  const smooth = characterInterpolatesMotion(sheet?.characters, item);
  const held = item.ghost === true || item.frozen === true;
  const alpha = held ? 1 : drawAlphaForKind(track.kind, frameAlpha, smooth);
  const pose = smooth ? interpolateAtomicPose(atomic, alpha) : atomic;
  // A remembered/portrait pose must not finish a pending movement or resume it when watched again.
  if (held) track.motion.tick = -1;
  trackMotion(
    track.motion,
    tick,
    item.x,
    item.y - (item.lift ?? 0),
    alpha,
    characterGaitRate(sheet?.characters, item, track.lastFacing),
    track.kind === 'projectile' ? (item.rotation ?? 0) : undefined,
  );
  if (item.facing !== undefined) track.lastFacing = item.facing;
  // `upgradePct` and `builtPct` are mutually exclusive by construction, so an upgrade site rides the
  // same eased reveal as a from-scratch one.
  track.reveal = easeReveal(track.reveal, item.builtPct ?? item.upgradePct);
  const clocks = motionClocks(item, tick, frameAlpha, track.motion, smooth, environmentMotion);
  return resolveLayers(
    sheet,
    revealedItem(walkPose(pose, track.kind, track.motion, track.lastFacing), track.reveal),
    clocks.animation,
    clocks.gait,
    environmentMotion ? tick + frameAlpha : clocks.animation,
  );
}
