import type { PalettedSprite } from '@open-northland/render';
import type { Application, Container } from 'pixi.js';
import type { GuiArt } from '../../content/gui-art.js';
import type { TextRun } from '../bitmap-text.js';
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
import type { SupersampledStrip } from './strip-texture.js';

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
  /** The baked strip texture (real-art path) — re-rasterized when the speed glyph changes. */
  readonly supersampled: SupersampledStrip | null;
  /** The speed button's outline stamps + real glyph — a speed change re-frames ALL of them (one shape). */
  readonly speedSprites: readonly PalettedSprite[];
  /** The speed button's placed rect, for the fallback glyph position (undefined → no fallback glyph). */
  readonly speedBtnRect: PlacedRect | undefined;
  /** Apply a game-speed change to the app loop (a pause toggle must not overwrite the wall-clock speed). */
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
}

/** The mounted game-speed button — the strip's one interactive glyph (×1 → ×2 → ×3; P toggles pause). */
export interface SpeedButton {
  /** Click action: un-pause if paused, else cycle to the next speed. */
  cycle(): void;
  /** The `P` key: toggle pause, remembering the running speed for the resume. */
  togglePause(): void;
  /** Mount-time init — set the button GRAPHIC only; never push to the loop (the entry seeds its own speed). */
  init(): void;
}

/**
 * The game-speed button on the tool-panel strip — the one piece of interactive strip logic (its state +
 * glyph). Real art re-frames the baked outline stamps + glyph and re-rasterizes the strip on a change;
 * the flat fallback draws a `×N`/`||` text glyph on the button rect. Kept as its own controller like the
 * panel's window controllers, so the mount just wires clicks/keys to {@link cycle}/{@link togglePause}.
 */
export function createSpeedButton(deps: SpeedButtonDeps): SpeedButton {
  const { ctx, app, scale, stripContainer, art, supersampled, speedSprites, speedBtnRect } = deps;
  let speedControl: GameSpeedControl = DEFAULT_GAME_SPEED_CONTROL;
  let speedRun: TextRun | null = null; // fallback glyph (the flat mode has no distinct per-state sprite)

  // `cause` null = mount-time init (refresh the glyph only, never push to the loop — see the call below).
  const applySpeed = (cause: GameSpeedChangeCause | null): void => {
    const spec = effectiveGameSpeedSpec(speedControl);
    if (speedSprites.length > 0 && art !== null) {
      const frame = art.layer.atlas.frames.get(spec.gfx);
      if (frame !== undefined) {
        // Outline stamps + real glyph share the frame (the rim must follow the new glyph's shape).
        for (const s of speedSprites) {
          s.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
        }
        // The strip is baked into a texture, so re-rasterize it with the new speed glyph (rare — a click).
        supersampled?.redraw();
      }
    }
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
    // Push to the loop only on an actual change (a click / the P key), NOT at mount — the entry seeds its
    // own initial loop speed (default / `?speed=`), and the panel must not clobber it with ×1 before frame 0.
    if (cause !== null) deps.onSpeedChange(spec, cause);
  };

  return {
    cycle: () => {
      // Cause from the PRE-click state: a click while paused is an un-pause, not a speed pick (a
      // 'cycle' cause there would clobber a fractional `?speed=` seed — see gameSpeedClickCause).
      const cause = gameSpeedClickCause(speedControl);
      speedControl = cycleGameSpeed(speedControl);
      applySpeed(cause);
    },
    togglePause: () => {
      speedControl = toggleGameSpeedPause(speedControl);
      applySpeed('pause-toggle');
    },
    init: () => applySpeed(null),
  };
}
