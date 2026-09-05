import type { Texture } from 'pixi.js';
import type { FontColorName } from '../../content/font-gfx.js';
import type { UiString } from '../../content/gui-gfx.js';
import type { Rect } from '../geometry.js';
import type { ParagraphRun, TextRun } from '../text-run.js';
import type { ToolPanelLayout } from './layout.js';

/** The original bitmap fills the pop-up windows tile for the wood look; `undefined` when `content/` is
 *  absent, and the windows fall back to flat parchment Graphics. */
export interface PanelBitmaps {
  readonly bg: Texture | undefined;
  readonly button: Texture | undefined;
  readonly buttonHilite: Texture | undefined;
  readonly headline: Texture | undefined;
}

/** What a tool-panel window controller needs from the mounted panel. */
export interface PanelContext {
  readonly layout: ToolPanelLayout;
  /** The uiscale multiplier for every design-px metric. May be fractional. */
  readonly scale: number;
  /** The caller owns placement and destruction; `px` overrides the default body size in design px. */
  readonly makeText: (text: string, color: FontColorName, px?: number) => TextRun;
  /** A word-wrapped block at `px`, wrapped to `wrapWidth` design px; the caller owns it like a run. */
  readonly makeParagraph: (
    text: string,
    color: FontColorName,
    px: number,
    wrapWidth: number,
    align?: 'left' | 'center',
  ) => ParagraphRun;
  readonly bitmaps: PanelBitmaps;
  /** Prefer the decoded UI string for `(table, id)`, else the pinned fallback label. */
  readonly uiString: UiString;
  /** The live renderer size, read at each placement and never cached. */
  readonly screen: () => { readonly width: number; readonly height: number };
  /** The screen-px box of the bottom-corner overlay drawn over this panel. A pop-up list that spans it
   *  shortens toward clearing it: presses under the overlay are deferred to it, so a covered row is dead. */
  readonly overlayReserve?: () => Rect | null;
}
