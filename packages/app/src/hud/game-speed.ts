/**
 * The game-speed button state machine — PINNED to the original's speed-button behaviour.
 *
 * OpenVikings `CGuiManager.cs` `MiscButtons_SpeedButton_Update()` chooses the button's gfx from the current
 * speed factor (`DAT_1003a6488 / 12`): factor 0 → gfx 0x36 (paused), 1 → gfx 0x31 (the base sprite), 2 →
 * gfx 0x34, 3 → gfx 0x35 (and a separate "maximise" flag reuses 0x31 with a "MAX!" tooltip). We model the
 * four *visible* states as a click cycle and map each to an app-side tick multiplier — game speed is an app
 * concern (the sim tick stays fixed-step at `TICKS_PER_SECOND`), so what's pinned is the factor→gfx family
 * and the factor values; the cycle order and multiplier wiring are ours (source basis).
 *
 * Pure (no Pixi/DOM): the view reads `gfx`, the loop reads `tickMultiplier`, both unit-tested.
 */

/** The four visible speed states, in click-cycle order (a click advances to the next, wrapping). */
export type GameSpeedState = 'normal' | 'fast' | 'faster' | 'paused';

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

/** The state the button starts in (normal ×1, the original's default in-game speed). */
export const DEFAULT_GAME_SPEED_STATE: GameSpeedState = 'normal';

const SPEC_BY_STATE: ReadonlyMap<GameSpeedState, GameSpeedStateSpec> = new Map(
  GAME_SPEED_STATES.map((s) => [s.state, s]),
);

/** The full spec for a state (gfx + factor + multiplier). Throws on an unknown state (programmer error). */
export function gameSpeedSpec(state: GameSpeedState): GameSpeedStateSpec {
  const spec = SPEC_BY_STATE.get(state);
  if (spec === undefined) throw new Error(`game-speed: unknown state "${state}"`);
  return spec;
}

/** The next state in the cycle (`normal → fast → faster → paused → normal`) — one click of the button. */
export function nextGameSpeedState(state: GameSpeedState): GameSpeedState {
  const i = GAME_SPEED_STATES.findIndex((s) => s.state === state);
  if (i < 0) throw new Error(`game-speed: unknown state "${state}"`);
  const next = GAME_SPEED_STATES[(i + 1) % GAME_SPEED_STATES.length];
  if (next === undefined) throw new Error('game-speed: cycle index out of range');
  return next.state;
}
