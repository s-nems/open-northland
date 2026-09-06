import type { Application, Container } from 'pixi.js';
import type { GuiArt } from '../../content/gui-art.js';
import type { TextRun } from '../text-run.js';
import type { PanelContext } from './context.js';
import {
  cycleGameSpeed,
  DEFAULT_GAME_SPEED_CONTROL,
  effectiveGameSpeedSpec,
  type GameSpeedChangeCause,
  type GameSpeedControl,
  type GameSpeedStateSpec,
  gameSpeedClickCause,
  toggleGameSpeedPause,
} from './game-speed.js';
import type { PlacedRect } from './layout.js';
import type { StripBake } from './strip-surface.js';

/** Fallback speed-glyph nudges inside the button rect (design px). */
const SPEED_LABEL_INSET_X = 4;
const SPEED_LABEL_RAISE_Y = 3;

/** What the game-speed button needs from the mounted tool panel. */
export interface SpeedButtonDeps {
  readonly ctx: PanelContext;
  readonly app: Application;
  readonly scale: number;
  /** The strip container the fallback glyph draws into (the real path re-frames baked sprites instead). */
  readonly stripContainer: Container;
  /** The decoded GUI art, or null → the flat-Graphics fallback (a text glyph on the button rect). */
  readonly art: GuiArt | null;
  /** The strip the real-art glyph lives in; re-framing its meshes needs the bake redrawn. */
  readonly bake: StripBake;
  /** The speed button's placed rect, for the fallback glyph position (undefined → no fallback glyph). */
  readonly speedBtnRect: PlacedRect | undefined;
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
}

/** The mounted game-speed button: the strip's one interactive glyph. */
export interface SpeedButton {
  cycle(): void;
  togglePause(): void;
  /** Set the button graphic from the current state without pushing to the loop (mount, strip re-bake). */
  syncGlyph(): void;
  state(): GameSpeedControl;
  restore(control: GameSpeedControl): void;
}

export function createSpeedButton(deps: SpeedButtonDeps): SpeedButton {
  const { ctx, app, scale, stripContainer, art, bake, speedBtnRect } = deps;
  let speedControl: GameSpeedControl = DEFAULT_GAME_SPEED_CONTROL;
  let speedRun: TextRun | null = null; // fallback glyph (the flat mode has no distinct per-state sprite)

  // A null `cause` refreshes the glyph without pushing to the loop.
  const applySpeed = (cause: GameSpeedChangeCause | null): void => {
    const spec = effectiveGameSpeedSpec(speedControl);
    bake.reframe('speed', spec.gfx);
    if (art === null && speedBtnRect !== undefined) {
      speedRun?.destroy();
      speedRun = ctx.makeText(spec.state === 'paused' ? '||' : `x${spec.factor}`, 'white');
      stripContainer.addChild(speedRun.container);
      speedRun.place(
        speedBtnRect.x + SPEED_LABEL_INSET_X * scale,
        speedBtnRect.y + speedBtnRect.h / 2 - SPEED_LABEL_RAISE_Y * scale,
        scale,
        app.screen.width,
        app.screen.height,
      );
    }
    // The entry seeds its own initial loop speed, so mount must not clobber it with ×1 before frame 0.
    if (cause !== null) deps.onSpeedChange(spec, cause);
  };

  return {
    cycle: () => {
      // The cause is read from the pre-click state.
      const cause = gameSpeedClickCause(speedControl);
      speedControl = cycleGameSpeed(speedControl);
      applySpeed(cause);
    },
    togglePause: () => {
      speedControl = toggleGameSpeedPause(speedControl);
      applySpeed('pause-toggle');
    },
    syncGlyph: () => applySpeed(null),
    state: () => speedControl,
    restore: (control) => {
      speedControl = control;
      applySpeed(null);
    },
  };
}
