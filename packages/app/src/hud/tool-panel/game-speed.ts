// The game-speed states, pinned to the original's speed button. Each visible state maps to an
// app-side tick multiplier, since the sim tick stays fixed at `TICKS_PER_SECOND`; pause is a separate
// toggle that remembers the running speed.

export type GameSpeedState = 'normal' | 'fast' | 'faster' | 'paused';

export type RunningGameSpeed = 'normal' | 'fast' | 'faster';

export interface GameSpeedStateSpec {
  readonly state: GameSpeedState;
  /** The original speed factor: 1/2/3 = ×1/×2/×3, 0 = paused. */
  readonly factor: number;
  /** Real-time → sim-time multiplier fed to the fixed-timestep accumulator (0 pauses the sim). */
  readonly tickMultiplier: number;
}

export const GAME_SPEED_STATES: readonly GameSpeedStateSpec[] = [
  { state: 'normal', factor: 1, tickMultiplier: 1 },
  { state: 'fast', factor: 2, tickMultiplier: 2 },
  { state: 'faster', factor: 3, tickMultiplier: 3 },
  { state: 'paused', factor: 0, tickMultiplier: 0 },
];

const SPEC_BY_STATE: ReadonlyMap<GameSpeedState, GameSpeedStateSpec> = new Map(
  GAME_SPEED_STATES.map((s) => [s.state, s]),
);

export function gameSpeedSpec(state: GameSpeedState): GameSpeedStateSpec {
  const spec = SPEC_BY_STATE.get(state);
  if (spec === undefined) throw new Error(`game-speed: unknown state "${state}"`);
  return spec;
}

/** The running presets by the multiplier each stands for, highest first. */
const PRESETS_FASTEST_FIRST: readonly { readonly multiplier: number; readonly running: RunningGameSpeed }[] =
  GAME_SPEED_STATES.flatMap((spec) =>
    spec.state === 'paused' ? [] : [{ multiplier: spec.tickMultiplier, running: spec.state }],
  ).sort((a, b) => b.multiplier - a.multiplier);

/** The highest running preset not above `speed`, ×1 below that: what a bar presses for a game that
 *  runs slower than it was asked to. */
export function presetAtOrBelow(speed: number): RunningGameSpeed {
  return PRESETS_FASTEST_FIRST.find((preset) => preset.multiplier <= speed)?.running ?? 'normal';
}

/** The speed control: the running speed persists across a pause, so unpausing restores the same pace. */
export interface GameSpeedControl {
  readonly running: RunningGameSpeed;
  readonly paused: boolean;
}

/** ×1 running is the original's default in-game speed. */
export const DEFAULT_GAME_SPEED_CONTROL: GameSpeedControl = { running: 'normal', paused: false };

export function toggleGameSpeedPause(control: GameSpeedControl): GameSpeedControl {
  return { running: control.running, paused: !control.paused };
}

const RUNNING_SPEED_CYCLE: readonly RunningGameSpeed[] = ['normal', 'fast', 'faster'];

/** Original behavior of the speed key: ×1 → ×2 → ×3 → ×1, and a press while paused resumes at ×1. */
export function nextRunningSpeed(control: GameSpeedControl): RunningGameSpeed {
  if (control.paused) return 'normal';
  const index = RUNNING_SPEED_CYCLE.indexOf(control.running);
  return RUNNING_SPEED_CYCLE[(index + 1) % RUNNING_SPEED_CYCLE.length] ?? 'normal';
}

/**
 * Why a speed change happened, since the loop applies them differently. A `'cycle'` is an explicit speed
 * pick and overwrites the loop's wall-clock multiplier, including a fractional `?speed=` seed. A
 * `'pause-toggle'` must only flip the pause flag, or a seeded `?speed=0.5` would resume at ×1.
 */
export type GameSpeedChangeCause = 'cycle' | 'pause-toggle';

/** The spec the button draws + the loop applies for a control: the pause glyph wins while paused. */
export function effectiveGameSpeedSpec(control: GameSpeedControl): GameSpeedStateSpec {
  return gameSpeedSpec(control.paused ? 'paused' : control.running);
}
