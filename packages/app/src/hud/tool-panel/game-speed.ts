// The game-speed button state machine, pinned to the original's speed button. Each visible state maps to
// an app-side tick multiplier, since the sim tick stays fixed at `TICKS_PER_SECOND`.
//
// Approximation: a click cycles only the running speeds, never into pause, and pause is a separate
// toggle. Exact cycling behavior is unconfirmed against the running original.

export type GameSpeedState = 'normal' | 'fast' | 'faster' | 'paused';

export type RunningGameSpeed = 'normal' | 'fast' | 'faster';

export interface GameSpeedStateSpec {
  readonly state: GameSpeedState;
  /** The original speed factor (`DAT_1003a6488 / 12`): 1/2/3 = ×1/×2/×3, 0 = paused. */
  readonly factor: number;
  /** The atlas gfx id (== frame id) the button shows in this state. */
  readonly gfx: number;
  /** Real-time → sim-time multiplier fed to the fixed-timestep accumulator (0 pauses the sim). */
  readonly tickMultiplier: number;
}

/** The gfx ids are the frames `MiscButtons_SpeedButton_Update` selects per speed factor. */
export const GAME_SPEED_STATES: readonly GameSpeedStateSpec[] = [
  { state: 'normal', factor: 1, gfx: 0x31, tickMultiplier: 1 },
  { state: 'fast', factor: 2, gfx: 0x34, tickMultiplier: 2 },
  { state: 'faster', factor: 3, gfx: 0x35, tickMultiplier: 3 },
  { state: 'paused', factor: 0, gfx: 0x36, tickMultiplier: 0 },
];

const SPEC_BY_STATE: ReadonlyMap<GameSpeedState, GameSpeedStateSpec> = new Map(
  GAME_SPEED_STATES.map((s) => [s.state, s]),
);

export function gameSpeedSpec(state: GameSpeedState): GameSpeedStateSpec {
  const spec = SPEC_BY_STATE.get(state);
  if (spec === undefined) throw new Error(`game-speed: unknown state "${state}"`);
  return spec;
}

/** The speed control: the running speed persists across a pause, so unpausing restores the same pace. */
export interface GameSpeedControl {
  readonly running: RunningGameSpeed;
  readonly paused: boolean;
}

/** ×1 running is the original's default in-game speed. */
export const DEFAULT_GAME_SPEED_CONTROL: GameSpeedControl = { running: 'normal', paused: false };

/** Declaration order is the click cycle, wrapping. */
const RUNNING_CYCLE: readonly RunningGameSpeed[] = ['normal', 'fast', 'faster'];

/** While paused, a click resumes at the remembered running speed instead of advancing the cycle. */
export function cycleGameSpeed(control: GameSpeedControl): GameSpeedControl {
  if (control.paused) return { running: control.running, paused: false };
  const i = RUNNING_CYCLE.indexOf(control.running);
  const next = RUNNING_CYCLE[(i + 1) % RUNNING_CYCLE.length];
  if (next === undefined) throw new Error('game-speed: running cycle index out of range');
  return { running: next, paused: false };
}

export function toggleGameSpeedPause(control: GameSpeedControl): GameSpeedControl {
  return { running: control.running, paused: !control.paused };
}

/**
 * Why a speed change happened, since the loop applies them differently. A `'cycle'` is an explicit speed
 * pick and overwrites the loop's wall-clock multiplier, including a fractional `?speed=` seed. A
 * `'pause-toggle'` must only flip the pause flag, or a seeded `?speed=0.5` would resume at ×1.
 */
export type GameSpeedChangeCause = 'cycle' | 'pause-toggle';

/** The cause a click reports, from the pre-click control: a click while paused is an un-pause, so both
 *  resume gestures behave alike. */
export function gameSpeedClickCause(control: GameSpeedControl): GameSpeedChangeCause {
  return control.paused ? 'pause-toggle' : 'cycle';
}

/** The spec the button draws + the loop applies for a control: the pause glyph wins while paused. */
export function effectiveGameSpeedSpec(control: GameSpeedControl): GameSpeedStateSpec {
  return gameSpeedSpec(control.paused ? 'paused' : control.running);
}
