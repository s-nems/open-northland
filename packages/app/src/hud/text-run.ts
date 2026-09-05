import type { Container } from 'pixi.js';

/** A retained, re-placeable line of HUD text, built either from bitmap glyphs or from a Pixi `Text`. */
export interface TextRun {
  /** Parent this under the window or menu container for draw order; position is set through {@link place}. */
  readonly container: Container;
  /** Advance width in native font px; multiply by the place scale for screen px. */
  readonly width: number;
  /** Anchor the run's top-left at screen `(x, y)`, drawn at `scale` px per native pixel. */
  place(x: number, y: number, scale: number, resWidth: number, resHeight: number): void;
  destroy(): void;
}

/** A retained, word-wrapped block of HUD text; sizes are in native (design) px, screen = native × scale. */
export interface ParagraphRun {
  readonly container: Container;
  /** The widest line's advance. */
  readonly width: number;
  readonly height: number;
  /** Anchor the block's top-left at screen `(x, y)`. */
  place(x: number, y: number): void;
  destroy(): void;
}
