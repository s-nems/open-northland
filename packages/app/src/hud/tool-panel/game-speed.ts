// The game-speed states, pinned to the original's speed button. Each visible state maps to an
// app-side tick multiplier, since the sim tick stays fixed at `TICKS_PER_SECOND`; pause is a separate
// toggle that remembers the running speed.

export type GameSpeedState = RunningGameSpeed | 'paused';

export type RunningGameSpeed = 'normal' | 'fast' | 'faster' | DevGameSpeed;

/** Tempos past the original's ×3 that only a local dev server's bar offers. */
export type DevGameSpeed = 'dev5' | 'dev10' | 'dev30' | 'dev60' | 'devUnlimited';

/** The multiplier the unlimited tempo asks for: far past what a map's ticks sustain, so a worker
 *  session steps as fast as the sim runs. An inline scene still stops at its per-frame step cap. */
export const UNLIMITED_GAME_SPEED = 1000;

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

export const DEV_GAME_SPEED_STATES: readonly GameSpeedStateSpec[] = [
  { state: 'dev5', factor: 5, tickMultiplier: 5 },
  { state: 'dev10', factor: 10, tickMultiplier: 10 },
  { state: 'dev30', factor: 30, tickMultiplier: 30 },
  { state: 'dev60', factor: 60, tickMultiplier: 60 },
  { state: 'devUnlimited', factor: UNLIMITED_GAME_SPEED, tickMultiplier: UNLIMITED_GAME_SPEED },
];

const SPEC_BY_STATE: ReadonlyMap<GameSpeedState, GameSpeedStateSpec> = new Map(
  [...GAME_SPEED_STATES, ...DEV_GAME_SPEED_STATES].map((s) => [s.state, s]),
);

export function gameSpeedSpec(state: GameSpeedState): GameSpeedStateSpec {
  const spec = SPEC_BY_STATE.get(state);
  if (spec === undefined) throw new Error(`game-speed: unknown state "${state}"`);
  return spec;
}

type Preset = { readonly multiplier: number; readonly running: RunningGameSpeed };

/** The running presets by the multiplier each stands for, highest first. */
const fastestFirst = (states: readonly GameSpeedStateSpec[]): readonly Preset[] =>
  states
    .flatMap((spec) =>
      spec.state === 'paused' ? [] : [{ multiplier: spec.tickMultiplier, running: spec.state }],
    )
    .sort((a, b) => b.multiplier - a.multiplier);
const PRESETS_FASTEST_FIRST = fastestFirst(GAME_SPEED_STATES);
const WITH_DEV_PRESETS_FASTEST_FIRST = fastestFirst([...GAME_SPEED_STATES, ...DEV_GAME_SPEED_STATES]);

/** The highest running preset not above `speed`, ×1 below that: what a bar presses for a game that
 *  runs slower than it was asked to. `devSpeeds` counts the bar's dev-only tempos too. */
export function presetAtOrBelow(speed: number, devSpeeds = false): RunningGameSpeed {
  const presets = devSpeeds ? WITH_DEV_PRESETS_FASTEST_FIRST : PRESETS_FASTEST_FIRST;
  return presets.find((preset) => preset.multiplier <= speed)?.running ?? 'normal';
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
