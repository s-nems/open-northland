import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/atlas.js';

/**
 * One placed displacement object (a `GfxUserFXMatrix` shore wave). Its frames are not colours: each
 * written texel's red byte is how many pixels the ground drawn beneath is lifted there.
 */
export interface GroundWave {
  /** World-space anchor (px), projected from the object's half-cell by the app. */
  readonly x: number;
  readonly y: number;
  /** Terrain-elevation lift (world px, >= 0), subtracted from the drawn `y` like a map object's. */
  readonly lift?: number;
  /** The displacement atlas: the lift in red, the written mask in alpha, loaded straight. */
  readonly source: TextureSource;
  /** The looping frame list, one frame per step of {@link groundWaveFrameAt}'s clock. */
  readonly frames: readonly AtlasFrame[];
  /** The start offset into {@link frames}. */
  readonly phase: number;
}

/**
 * Original behavior: every tick advances every wave one frame, offset by its node position. `step` is the
 * water clock in base-rate ticks, so above speed 1 the waves keep that pace instead of the sim's
 * (an approximation of the original, which plays them per tick at every speed).
 */
export function groundWaveFrameAt(wave: GroundWave, step: number): AtlasFrame | undefined {
  const count = wave.frames.length;
  return count === 0 ? undefined : wave.frames[groundWaveFrameIndex(wave.phase, count, step)];
}

/** The index into a loop of `count` frames that {@link groundWaveFrameAt} shows at `step`. */
export function groundWaveFrameIndex(phase: number, count: number, step: number): number {
  return (step + phase) % count;
}
