import {
  cycleGameSpeed,
  DEFAULT_GAME_SPEED_CONTROL,
  effectiveGameSpeedSpec,
  type GameSpeedChangeCause,
  type GameSpeedControl,
  type GameSpeedStateSpec,
  gameSpeedClickCause,
  type RunningGameSpeed,
  toggleGameSpeedPause,
} from './game-speed.js';

export interface SpeedControlDeps {
  /** A change made here, pushed to the session clock. */
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Every state the control shows, including one restored or synced from elsewhere. */
  readonly onShow: (control: GameSpeedControl) => void;
}

/** The game-speed control behind the system bar's segments and the pause hotkey. */
export interface SpeedControl {
  /** The legacy single-button gesture: the next running speed, or resume while paused. */
  cycle(): void;
  togglePause(): void;
  /** Pick a running speed; a pick while paused resumes at it. */
  setRunning(running: RunningGameSpeed): void;
  state(): GameSpeedControl;
  /** Show a control set elsewhere (a restore, a remount) without pushing it to the clock. */
  restore(control: GameSpeedControl): void;
}

export function createSpeedControl(deps: SpeedControlDeps): SpeedControl {
  let control: GameSpeedControl = DEFAULT_GAME_SPEED_CONTROL;
  // A null `cause` shows the state without pushing to the loop: the entry seeds its own initial speed,
  // so a mount must not clobber it with ×1 before frame 0.
  const apply = (next: GameSpeedControl, cause: GameSpeedChangeCause | null): void => {
    control = next;
    deps.onShow(control);
    if (cause !== null) deps.onSpeedChange(effectiveGameSpeedSpec(control), cause);
  };
  return {
    cycle: () => apply(cycleGameSpeed(control), gameSpeedClickCause(control)),
    togglePause: () => apply(toggleGameSpeedPause(control), 'pause-toggle'),
    setRunning: (running) => {
      // Resuming at the remembered speed only flips the pause flag, like the pause key; any other pick
      // hands the clock its multiplier.
      const cause: GameSpeedChangeCause =
        control.paused && control.running === running ? 'pause-toggle' : 'cycle';
      apply({ running, paused: false }, cause);
    },
    state: () => control,
    restore: (next) => apply(next, null),
  };
}
