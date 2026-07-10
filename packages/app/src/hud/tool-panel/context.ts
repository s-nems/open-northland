import type { Texture } from 'pixi.js';
import type { FontColorName } from '../../content/font-gfx.js';
import type { UiString } from '../../content/gui-gfx.js';
import type { TextRun } from '../bitmap-text.js';
import type { ToolPanelLayout } from './layout.js';

/** The original window/button bitmap fills the pop-up windows tile for the in-game wood look (or `undefined`
 *  when `content/` is absent → the windows fall back to flat parchment Graphics). */
export interface PanelBitmaps {
  readonly bg: Texture | undefined;
  readonly button: Texture | undefined;
  readonly buttonHilite: Texture | undefined;
  readonly headline: Texture | undefined;
}

/**
 * What every tool-panel window controller (building menu / statistics / placement) needs from the
 * mounted panel: the resolved strip layout + scale, the shared vector-font text factory, the decoded-UI
 * bitmap fills, the decoded-UI-string lookup, and the live canvas size (read when a controller lays out,
 * so it tracks window resizes).
 */
export interface PanelContext {
  readonly layout: ToolPanelLayout;
  /** The uiscale (`layout.scale`), the multiplier for every design-px metric. May be fractional. */
  readonly scale: number;
  /** Build a retained vector-font text run (see `makeUiTextRun`); the caller owns placement + destruction.
   *  `px` overrides the default body size (design px) for headings. */
  readonly makeText: (text: string, color: FontColorName, px?: number) => TextRun;
  /** The decoded window/button bitmap fills for the wood look (empty set → flat-Graphics fallback). */
  readonly bitmaps: PanelBitmaps;
  /** Prefer the decoded UI string for `(table, id)`, else the pinned fallback label. */
  readonly uiString: UiString;
  /** The LIVE renderer size (tracks window resizes) — read at each placement, never cached. */
  readonly screen: () => { readonly width: number; readonly height: number };
}
