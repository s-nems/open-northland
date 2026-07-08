import type { FontColorName } from '../../content/font-gfx.js';
import type { TextRun } from '../bitmap-text.js';
import type { ToolPanelLayout } from './layout.js';

/**
 * What every tool-panel window controller (building menu / statistics / placement) needs from the
 * mounted panel: the resolved strip layout + scale, the shared text factory (bitmap font or Pixi
 * fallback — the controllers never know which), the decoded-UI-string lookup, and the live canvas
 * size (windows re-place against it every frame, since screen-space meshes carry the resolution).
 */
export interface PanelContext {
  readonly layout: ToolPanelLayout;
  /** The uiscale (`layout.scale`), the multiplier for every design-px metric. May be fractional. */
  readonly scale: number;
  /** Build a retained text run (see `makeTextRun`); the caller owns placement + destruction. */
  readonly makeText: (text: string, color: FontColorName) => TextRun;
  /** Prefer the decoded UI string for `(table, id)`, else the pinned fallback label. */
  readonly uiString: (table: string, id: number, fallback: string) => string;
  /** The LIVE renderer size (tracks window resizes) — read at each placement, never cached. */
  readonly screen: () => { readonly width: number; readonly height: number };
}
