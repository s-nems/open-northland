/**
 * The game-speed button state machine — the factor→gfx family pinned to the original's speed button.
 *
 * The four decoded frames map to factor 0 → gfx 0x36 (paused), 1 → gfx 0x31, 2 → gfx 0x34, and 3 →
 * gfx 0x35. We map each visible state to an app-side tick multiplier; game speed is an app concern and
 * the sim tick stays fixed at `TICKS_PER_SECOND`. Confirm exact cycling behavior in the running original.
 *
 * The control model is ours (source basis; a user-requested deviation): clicking the button cycles only the
 * running speeds (×1 → ×2 → ×3 → ×1, never into pause), while pause is a separate toggle (the `P` key, or a
 * click while paused resumes) that remembers the running speed and restores it on unpause.
 *
 * Pure (no Pixi/DOM): the view reads `gfx`, the loop reads `tickMultiplier`, both unit-tested.
 */

/** The four visible speed states the button can show (three running speeds + the paused glyph). */
export type GameSpeedState = 'normal' | 'fast' | 'faster' | 'paused';

/** The running (un-paused) speeds, in click-cycle order (a click advances to the next, wrapping). */
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

/** gfx 0x31/0x34/0x35/0x36 per `MiscButtons_SpeedButton_Update`; multiplier == factor (paused = 0). */
export const GAME_SPEED_STATES: readonly GameSpeedStateSpec[] = [
  { state: 'normal', factor: 1, gfx: 0x31, tickMultiplier: 1 },
  { state: 'fast', factor: 2, gfx: 0x34, tickMultiplier: 2 },
  { state: 'faster', factor: 3, gfx: 0x35, tickMultiplier: 3 },
  { state: 'paused', factor: 0, gfx: 0x36, tickMultiplier: 0 },
];

const SPEC_BY_STATE: ReadonlyMap<GameSpeedState, GameSpeedStateSpec> = new Map(
  GAME_SPEED_STATES.map((s) => [s.state, s]),
);

/** The full spec for a state (gfx + factor + multiplier). Throws on an unknown state (programmer error). */
export function gameSpeedSpec(state: GameSpeedState): GameSpeedStateSpec {
  const spec = SPEC_BY_STATE.get(state);
  if (spec === undefined) throw new Error(`game-speed: unknown state "${state}"`);
  return spec;
}

/**
 * The speed control the button + the `P` key drive: the running speed persists across a pause, so
 * unpausing restores exactly the pace the player left (pause is a toggle, not a cycle stop).
 */
export interface GameSpeedControl {
  readonly running: RunningGameSpeed;
  readonly paused: boolean;
}

/** The control the game starts with (normal ×1 running — the original's default in-game speed). */
export const DEFAULT_GAME_SPEED_CONTROL: GameSpeedControl = { running: 'normal', paused: false };

/** The running click cycle (`normal → fast → faster → normal`) — pause is not a cycle stop. */
const RUNNING_CYCLE: readonly RunningGameSpeed[] = ['normal', 'fast', 'faster'];

/**
 * One click of the speed button: while running, advance the running cycle (×1 → ×2 → ×3 → ×1); while
 * paused, resume at the remembered running speed (the button shows the pause glyph, so clicking it reads
 * as "un-pause", not "change speed").
 */
export function cycleGameSpeed(control: GameSpeedControl): GameSpeedControl {
  if (control.paused) return { running: control.running, paused: false };
  const i = RUNNING_CYCLE.indexOf(control.running);
  const next = RUNNING_CYCLE[(i + 1) % RUNNING_CYCLE.length];
  if (next === undefined) throw new Error('game-speed: running cycle index out of range');
  return { running: next, paused: false };
}

/** The `P` key: toggle pause, keeping the running speed remembered for the resume. */
export function toggleGameSpeedPause(control: GameSpeedControl): GameSpeedControl {
  return { running: control.running, paused: !control.paused };
}

/**
 * Why a speed change happened — the loop applies them differently. A `'cycle'` (button click) is an
 * explicit speed pick, so it overwrites the loop's wall-clock multiplier (including a fractional
 * `?speed=` seed — the button can only express the discrete speeds). A `'pause-toggle'` (the `P` key)
 * must only flip the pause flag: writing the multiplier there would silently replace a seeded
 * `?speed=0.5` with ×1 on resume, breaking the "restores exactly the pace" promise above.
 */
export type GameSpeedChangeCause = 'cycle' | 'pause-toggle';

/**
 * The cause a speed-button click reports, from the pre-click control: a click while paused is an
 * un-pause ({@link cycleGameSpeed} resumes, it does not advance), so it must carry `'pause-toggle'` —
 * reporting `'cycle'` there would overwrite a fractional `?speed=` seed on resume (see the type above),
 * making the two resume gestures (click vs `P`) behave differently.
 */
export function gameSpeedClickCause(control: GameSpeedControl): GameSpeedChangeCause {
  return control.paused ? 'pause-toggle' : 'cycle';
}

/** The spec the button draws + the loop applies for a control: the pause glyph wins while paused. */
export function effectiveGameSpeedSpec(control: GameSpeedControl): GameSpeedStateSpec {
  return gameSpeedSpec(control.paused ? 'paused' : control.running);
}
