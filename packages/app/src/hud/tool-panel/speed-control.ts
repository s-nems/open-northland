import {
  DEFAULT_GAME_SPEED_CONTROL,
  effectiveGameSpeedSpec,
  type GameSpeedChangeCause,
  type GameSpeedControl,
  type GameSpeedStateSpec,
  type RunningGameSpeed,
  toggleGameSpeedPause,
} from './game-speed.js';

export interface SpeedControlDeps {
  /** A change made here, pushed to the session clock. */
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Every state the control shows, including one restored or synced from elsewhere. */
  readonly onShow: (control: GameSpeedControl) => void;
  /** True while a window holds the game paused under it (the mission sheet): a press then waits,
   *  since resuming the clock would run the game behind that window. */
  readonly held?: () => boolean;
}

/** The game-speed control behind the system bar's segments and the pause hotkey. */
export interface SpeedControl {
  /** False when a hold refused the press. */
  togglePause(): boolean;
  /** Pick a running speed; a pick while paused resumes at it. False when a hold refused the press. */
  setRunning(running: RunningGameSpeed): boolean;
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
  const held = (): boolean => deps.held?.() === true;
  return {
    togglePause: () => {
      if (held()) return false;
      apply(toggleGameSpeedPause(control), 'pause-toggle');
      return true;
    },
    setRunning: (running) => {
      if (held()) return false;
      // Resuming at the remembered speed only flips the pause flag, like the pause key; any other pick
      // hands the clock its multiplier.
      const cause: GameSpeedChangeCause =
        control.paused && control.running === running ? 'pause-toggle' : 'cycle';
      apply({ running, paused: false }, cause);
      return true;
    },
    state: () => control,
    restore: (next) => apply(next, null),
  };
}
