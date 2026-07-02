import { Container, Graphics, Text } from 'pixi.js';
import type { HudPlacement } from '../data/hud.js';

/**
 * The retained HUD overlay — a pinned panel (NOT under the camera), repainted from a placed
 * {@link import('../data/hud.js').HudPlacement}. The load-bearing decisions (which number, laid out
 * where) are the pure `hud.ts` half a human doesn't need for; this is only the pixel repaint + the
 * tunable style (colour/font/opacity). Cheap (a handful of rows); full text pooling is a later refinement.
 */

/** Visual style for the HUD panel — the part a human tunes (colour/font/opacity). */
export interface HudStyle {
  readonly panelColor: number;
  readonly panelAlpha: number;
  readonly textColor: number;
  readonly fontSize: number;
  readonly fontFamily: string;
}

/** A readable default HUD style (a dark translucent panel, light monospace text). */
export const DEFAULT_HUD_STYLE: HudStyle = {
  panelColor: 0x000000,
  panelAlpha: 0.55,
  textColor: 0xf0e8d8,
  fontSize: 12,
  fontFamily: 'monospace',
};

/** One frame's HUD overlay: the placed panel/rows ({@link HudPlacement}) + an optional style override. */
export interface HudFrame {
  readonly placement: HudPlacement;
  readonly style?: HudStyle;
}

export class HudLayer {
  /** The overlay container — a sibling of the world layer (NOT under the camera), so it stays pinned. */
  readonly container = new Container();

  /** Repaint the pinned HUD into its persistent layer (a panel + one {@link Text} per row). */
  draw(hud?: HudFrame): void {
    for (const child of this.container.removeChildren()) child.destroy();
    if (hud === undefined) return;
    const style = hud.style ?? DEFAULT_HUD_STYLE;
    const p = hud.placement;
    const panel = new Graphics();
    panel
      .rect(p.panelX, p.panelY, p.width, p.height)
      .fill({ color: style.panelColor, alpha: style.panelAlpha });
    this.container.addChild(panel);
    for (const row of p.rows) {
      const text = new Text({
        text: row.text,
        style: { fill: style.textColor, fontSize: style.fontSize, fontFamily: style.fontFamily },
      });
      text.position.set(row.x, row.y);
      this.container.addChild(text);
    }
  }

  /** Tear down the overlay layer. */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
