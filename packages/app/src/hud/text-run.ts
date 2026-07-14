import type { Container } from 'pixi.js';

/**
 * A retained, re-placeable line of HUD text — bitmap glyphs when the `.fnt` is loaded, else a Pixi `Text`.
 * The shared shape both text kits build (`ui-text.ts`'s vector run, `bitmap-text.ts`'s decoded run) and
 * every HUD window draws. It lives here, not inside the (dormant) bitmap path, so the live vector callers
 * don't import their core type through a module they never otherwise use.
 */
export interface TextRun {
  /** Parent this under the panel's window/menu container for draw order (position is via {@link place}). */
  readonly container: Container;
  /** The run's advance width in native font px (multiply by the place scale for screen px) — for centering. */
  readonly width: number;
  /** Anchor the run's top-left at screen `(x, y)`, drawn at `scale` px per native pixel. */
  place(x: number, y: number, scale: number, resWidth: number, resHeight: number): void;
  destroy(): void;
}
