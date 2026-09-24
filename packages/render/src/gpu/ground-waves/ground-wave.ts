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
  /** The `.indexed` atlas: the displacement in red, the written mask in alpha. */
  readonly source: TextureSource;
  /** The looping frame list, one frame per sim tick. */
  readonly frames: readonly AtlasFrame[];
  /** The start offset into {@link frames}. */
  readonly phase: number;
}

/** Original behavior: every tick advances every wave one frame, offset by its node position. */
export function groundWaveFrameAt(wave: GroundWave, tick: number): AtlasFrame | undefined {
  const count = wave.frames.length;
  return count === 0 ? undefined : wave.frames[(tick + wave.phase) % count];
}
