import { Container, Graphics, Text } from 'pixi.js';
import type { HudPlacement } from '../../data/hud/index.js';

/**
 * The pinned HUD panel. `data/hud/` decides which number is laid out where; this half only repaints
 * pixels and carries the tunable style.
 */

export interface HudStyle {
  readonly panelColor: number;
  readonly panelAlpha: number;
  readonly textColor: number;
  readonly fontSize: number;
  readonly fontFamily: string;
}

export const DEFAULT_HUD_STYLE: HudStyle = {
  panelColor: 0x000000,
  panelAlpha: 0.55,
  textColor: 0xf0e8d8,
  fontSize: 12,
  fontFamily: 'monospace',
};

export interface HudFrame {
  readonly placement: HudPlacement;
  readonly style?: HudStyle;
}

/** Field-wise equality - the frame is rebuilt every frame, so identity cannot detect a style change. */
function sameStyle(a: HudStyle, b: HudStyle): boolean {
  return (
    a.panelColor === b.panelColor &&
    a.panelAlpha === b.panelAlpha &&
    a.textColor === b.textColor &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily
  );
}

export class HudLayer {
  /** A sibling of the world layer, not under the camera, so the panel stays pinned. */
  readonly container = new Container();
  /** Repainted only when its box or style changes. */
  private readonly panel = new Graphics();
  /** Pooled rows: grown on demand, hidden rather than destroyed when a frame needs fewer. */
  private readonly rows: Text[] = [];
  /** Style generation, and the generation each pooled row was last styled at: a row hidden across a
   *  style change is restyled on reuse, never left stale. */
  private styleGen = 0;
  private readonly rowStyleGen: number[] = [];
  private lastStyle: HudStyle | undefined;
  /** The panel box the backdrop was last painted for (`[x, y, w, h]`; NaN = never painted). */
  private lastBox: [number, number, number, number] = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];

  constructor() {
    this.container.addChild(this.panel);
  }

  /** Repaint the pinned HUD in place, touching only what changed since the last frame. */
  draw(hud?: HudFrame): void {
    if (hud === undefined) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const style = hud.style ?? DEFAULT_HUD_STYLE;
    const styleChanged = this.lastStyle === undefined || !sameStyle(style, this.lastStyle);
    // Snapshot by value: a caller may legally mutate one options object in place, and a stored reference
    // would then always compare equal to itself and mask the change.
    if (styleChanged) {
      this.lastStyle = { ...style };
      this.styleGen++;
    }
    const p = hud.placement;

    const [bx, by, bw, bh] = this.lastBox;
    if (styleChanged || p.panelX !== bx || p.panelY !== by || p.width !== bw || p.height !== bh) {
      this.panel
        .clear()
        .rect(p.panelX, p.panelY, p.width, p.height)
        .fill({ color: style.panelColor, alpha: style.panelAlpha });
      this.lastBox = [p.panelX, p.panelY, p.width, p.height];
    }

    for (let i = 0; i < p.rows.length; i++) {
      const row = p.rows[i];
      if (row === undefined) continue;
      let text = this.rows[i];
      if (text === undefined) {
        text = new Text({
          text: row.text,
          style: { fill: style.textColor, fontSize: style.fontSize, fontFamily: style.fontFamily },
        });
        this.rows[i] = text;
        this.container.addChild(text);
      } else {
        // Only touch what re-rasterizes: a `.text` or `.style` write redraws the glyph canvas, while a
        // position write is a cheap transform update.
        if (this.rowStyleGen[i] !== this.styleGen) {
          text.style = { fill: style.textColor, fontSize: style.fontSize, fontFamily: style.fontFamily };
        }
        if (text.text !== row.text) text.text = row.text;
      }
      this.rowStyleGen[i] = this.styleGen;
      text.position.set(row.x, row.y);
      text.visible = true;
    }
    for (let i = p.rows.length; i < this.rows.length; i++) {
      const text = this.rows[i];
      if (text !== undefined) text.visible = false;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.rows.length = 0;
  }
}
