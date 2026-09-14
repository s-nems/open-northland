/** A flag's wave frames in playback order; a single frame is a still. */
export type WaveLoop<T> = readonly [T, ...T[]];

/**
 * Sim ticks per flag wave frame. `GfxLoopAnimation` says the frames loop, never how fast, so this borrows
 * the mill rotor's cadence (approximation): a full 8-frame wave takes 16 ticks, ~1.3 s at x1 with
 * `TICKS_PER_SECOND` 12.
 */
export const FLAG_WAVE_TICKS_PER_FRAME = 2;

export function waveFrameAt<T>(loop: WaveLoop<T>, tick: number): T {
  return loop[Math.floor(tick / FLAG_WAVE_TICKS_PER_FRAME) % loop.length] ?? loop[0];
}
