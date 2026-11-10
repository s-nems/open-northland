import { clamp01 } from '../../../data/math.js';
import type { DrawItem } from '../../../data/scene/index.js';
import { IDLE_PHASE_STAGGER_TICKS, type SpriteKind } from '../../../data/sprites/index.js';
import type { WindSway } from '../../../data/weather/climate.js';
import type { SettlerCharacter, SpriteSheet } from '../../textures/sprite-sheet.js';
import { cartDriveLook } from '../layers/cart-drive.js';
import { characterGaitRate, characterStepsOnWholeTicks, settlerCharacterOf } from '../layers/character.js';
import { resolveLayersInto } from '../layers/resolve.js';
import { LayerBuffer, type ResolvedLayer } from '../layers/resolved-layer.js';
import {
  type AtomicPoseTrack,
  atomicPose,
  type InterpolationTrack,
  interpolateAtomicPose,
} from './atomic-pose.js';
import { drawAlphaForKind, type MotionTrack, snapDistanceForKind, trackMotion } from './motion.js';
import { easeReveal, revealedItem, walkPose, writeMotionClocks } from './presentation.js';

/**
 * What one drawn entity carries between frames to present as the map does: its inter-tick motion, the
 * atomic it last acted, the facing it last drew with and the eased construction reveal. A pooled
 * entity holds one; a card that draws the same figure elsewhere holds its own.
 */
export interface PresentationTrack {
  readonly kind: SpriteKind;
  readonly motion: MotionTrack;
  readonly atomicPose: AtomicPoseTrack;
  /** Wait actions restart when the displayed settler returns to idle. */
  idleActive: boolean;
  idleStartTick: number;
  /** Seen at rest since it entered the draw list: it rested for an unknown while before that. */
  sightedAtRest: boolean;
  /** Last real facing (0..7), retained through a route gap or arrival. */
  lastFacing?: number;
  /** The displayed bottom-up reveal fraction (0..1) of an under-construction building, eased toward the
   *  sim's reported progress; `undefined` when nothing is in progress. Declared present rather than
   *  optional so the entity's shape never changes when a reveal first appears. */
  reveal: number | undefined;
  /** Holds the list {@link presentItem} returns, refilled by its next call on this track. */
  readonly layers: LayerBuffer;
  readonly clocks: { animation: number; gait: number };
  readonly interpolation: InterpolationTrack;
  /** The anchor of the item last presented, read once per item: loading a numeric field off the many
   *  draw item shapes boxes it, on every frame the same item presents again. */
  readonly anchor: PresentedAnchor;
  /** The settler look of the item last presented, picked once per item. */
  readonly look: PresentedLook;
  /** The last present, which another of the same item in the same tick may repeat. */
  readonly tickPresent: TickPresent;
}

interface PresentedLook {
  item: DrawItem | undefined;
  characters: SpriteSheet['characters'];
  char: SettlerCharacter | undefined;
}

/**
 * A settler drawn at its tick anchor reads the frame alpha through its animation clock at most, and on
 * a look whose clips step on whole ticks only through the whole tick that clock stands on: another
 * present of the same item in the same tick resolves the same layers while that step holds, or on every
 * frame when the clock carries no alpha.
 */
interface TickPresent {
  /** The item it presented; undefined when no later present may repeat it. */
  item: DrawItem | undefined;
  tick: number;
  sheet: SpriteSheet | undefined;
  environmentMotion: boolean;
  /** The whole tick of an animation clock that carried the frame alpha; NaN for one that did not. */
  clockStep: number;
  layers: readonly ResolvedLayer[] | null;
}

interface PresentedAnchor {
  item: DrawItem | undefined;
  x: number;
  y: number;
  lift: number;
}

export function createPresentationTrack(kind: SpriteKind): PresentationTrack {
  return {
    kind,
    reveal: undefined,
    layers: new LayerBuffer(),
    clocks: { animation: 0, gait: 0 },
    interpolation: { source: undefined, pose: undefined },
    anchor: { item: undefined, x: 0, y: 0, lift: 0 },
    look: { item: undefined, characters: undefined, char: undefined },
    tickPresent: {
      item: undefined,
      tick: -1,
      sheet: undefined,
      environmentMotion: false,
      clockStep: Number.NaN,
      layers: null,
    },
    atomicPose: { tick: -1, item: undefined },
    idleActive: false,
    idleStartTick: 0,
    sightedAtRest: false,
    motion: {
      tick: -1,
      x: 0,
      y: 0,
      lift: 0,
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
 * Advance `track` to this frame and resolve the layers the item draws into `track.layers`: the atomic's
 * cadence, the gait clock and the walk-pose gaps all come from the track, so a figure presented from it
 * anywhere moves as on the map. The drawn anchor lands in `track.motion.drawX/drawY`.
 */
export function presentItem(
  track: PresentationTrack,
  item: DrawItem,
  tick: number,
  frameAlpha: number,
  sheet: SpriteSheet | undefined,
  environmentMotion = false,
  wind?: WindSway,
  seaClock?: number,
): readonly ResolvedLayer[] | null {
  if (repeatsInTick(track, item, tick, frameAlpha, sheet, environmentMotion)) return track.tickPresent.layers;
  if (track.motion.tick === -1) {
    track.atomicPose.item = undefined;
    track.idleActive = false;
    track.sightedAtRest = true;
  }
  const atomic = atomicPose(item, tick, track.atomicPose);
  // An original walker keeps its tick anchor under the motion setting too: its clip plays one authored
  // frame per tick, so the body may only move with the frame, as the original engine steps it. Moving
  // it inside a frame hold drags the planted foot along the ground.
  const look = lookOf(track, sheet, item);
  const smooth = look?.interpolateMotion === true;
  const held = item.ghost === true || item.frozen === true;
  // A cart drawn as its driver plays that walker's clip, so it keeps the walker's tick anchor too.
  const walkerClip = track.kind === 'vehicle' && cartDriveLook(sheet, item) !== undefined;
  const alpha = held || walkerClip ? 1 : drawAlphaForKind(track.kind, frameAlpha, smooth);
  const pose = smooth ? interpolateAtomicPose(atomic, alpha, track.interpolation) : atomic;
  // A remembered/portrait pose must not finish a pending movement or resume it when watched again.
  if (held) track.motion.tick = -1;
  const anchor = track.anchor;
  if (anchor.item !== item) {
    anchor.item = item;
    anchor.x = item.x;
    anchor.y = item.y;
    anchor.lift = item.lift ?? 0;
  }
  trackMotion(
    track.motion,
    tick,
    anchor.x,
    anchor.y - anchor.lift,
    alpha,
    characterGaitRate(sheet, item, track.lastFacing, look),
    track.kind === 'projectile' ? (item.rotation ?? 0) : undefined,
    anchor.lift,
  );
  if (item.facing !== undefined) track.lastFacing = item.facing;
  // `upgradePct` and `builtPct` are mutually exclusive by construction, so an upgrade site rides the
  // same eased reveal as a from-scratch one.
  track.reveal = easeReveal(track.reveal, item.builtPct ?? item.upgradePct);
  const clocks = track.clocks;
  writeMotionClocks(clocks, pose, tick, frameAlpha, track.motion, smooth, environmentMotion);
  const displayed = revealedItem(walkPose(pose, track.kind, track.motion, track.lastFacing), track.reveal);
  const idleElapsed = idleClipElapsed(track, displayed, tick);
  const layers = resolveLayersInto(
    track.layers,
    sheet,
    displayed,
    clocks.animation,
    clocks.gait,
    environmentMotion ? tick + frameAlpha : clocks.animation,
    held ? 0 : idleElapsed,
    environmentMotion && !held ? wind : undefined,
    seaClock ?? clocks.animation,
  );
  const last = track.tickPresent;
  // Mirrors `writeMotionClocks` for a figure drawn at its tick anchor: its animation clock carries the
  // frame alpha only under the motion setting and outside an action, and a walk outside a house draws
  // from the gait clock alone.
  const readsAlpha =
    environmentMotion &&
    pose.state !== 'acting' &&
    (displayed.state !== 'moving' || displayed.inHouse === true);
  const repeatable =
    track.kind === 'settler' &&
    look !== undefined &&
    !smooth &&
    !held &&
    track.reveal === undefined &&
    (!readsAlpha || characterStepsOnWholeTicks(look));
  last.item = repeatable ? item : undefined;
  last.tick = tick;
  last.sheet = sheet;
  last.environmentMotion = environmentMotion;
  last.clockStep = readsAlpha ? Math.floor(tick + clamp01(frameAlpha)) : Number.NaN;
  last.layers = layers;
  return layers;
}

/**
 * {@link presentItem}'s layers for a resting entity of a kind with no pose of its own, at this frame's
 * clocks: its anchor, pose and reveal stand still, so only the clocks the layers read move. The motion
 * track keeps its last tick, as it does for an entity the pool holds unvisited.
 */
export function presentAtRest(
  track: PresentationTrack,
  item: DrawItem,
  tick: number,
  frameAlpha: number,
  sheet: SpriteSheet | undefined,
  environmentMotion: boolean,
  wind?: WindSway,
  seaClock?: number,
): readonly ResolvedLayer[] | null {
  const clocks = track.clocks;
  writeMotionClocks(clocks, item, tick, frameAlpha, track.motion, false, environmentMotion);
  return resolveLayersInto(
    track.layers,
    sheet,
    item,
    clocks.animation,
    clocks.gait,
    environmentMotion ? tick + frameAlpha : clocks.animation,
    undefined,
    environmentMotion ? wind : undefined,
    seaClock ?? clocks.animation,
  );
}

/** Whether a present of `item` would repeat the track's last one (see {@link TickPresent}) and return
 *  its layers unchanged. */
export function repeatsInTick(
  track: PresentationTrack,
  item: DrawItem,
  tick: number,
  frameAlpha: number,
  sheet: SpriteSheet | undefined,
  environmentMotion: boolean,
): boolean {
  const last = track.tickPresent;
  return (
    last.item === item &&
    last.tick === tick &&
    track.motion.tick === tick &&
    last.sheet === sheet &&
    last.environmentMotion === environmentMotion &&
    (Number.isNaN(last.clockStep) || last.clockStep === Math.floor(tick + clamp01(frameAlpha)))
  );
}

/**
 * How a later present of `item` in the same tick relates to the track's last one: `holds` repeats it at
 * every frame alpha, `steps` until the animation clock reaches another whole tick, and `moves` may
 * resolve other layers on any frame.
 */
export function repeatWithinTick(
  track: PresentationTrack,
  item: DrawItem,
  tick: number,
  sheet: SpriteSheet | undefined,
  environmentMotion: boolean,
): 'holds' | 'steps' | 'moves' {
  const last = track.tickPresent;
  if (
    last.item !== item ||
    last.tick !== tick ||
    track.motion.tick !== tick ||
    last.sheet !== sheet ||
    last.environmentMotion !== environmentMotion
  )
    return 'moves';
  return Number.isNaN(last.clockStep) ? 'holds' : 'steps';
}

function lookOf(track: PresentationTrack, sheet: SpriteSheet | undefined, item: DrawItem) {
  const look = track.look;
  if (look.item !== item || look.characters !== sheet?.characters) {
    look.item = item;
    look.characters = sheet?.characters;
    look.char = settlerCharacterOf(sheet?.characters, item);
  }
  return look.char;
}

/** A new visible idle period restarts the idle schedules, even after a walk or attack ended mid-clip: an
 *  animal's waits from frame zero, a settler's fidgets from the base wait. A figure first seen already at
 *  rest opens at a staggered point instead, so neighbours placed together do not gesture in step. */
export function idleClipElapsed(track: PresentationTrack, item: DrawItem, tick: number): number | undefined {
  const idle =
    track.kind === 'settler' &&
    (item.state ?? 'idle') === 'idle' &&
    item.engaged !== true &&
    item.carrying !== true;
  if (!idle) {
    track.idleActive = false;
    track.sightedAtRest = false;
    return undefined;
  }
  if (!track.idleActive) {
    track.idleActive = true;
    track.idleStartTick = track.sightedAtRest ? tick - item.ref * IDLE_PHASE_STAGGER_TICKS : tick;
    track.sightedAtRest = false;
  }
  return Math.max(0, tick - track.idleStartTick);
}
