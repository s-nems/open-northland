import { Container, Graphics, Text } from 'pixi.js';
import type { HudPlacement } from '../data/hud.js';

/**
 * The retained HUD overlay — a pinned panel (NOT under the camera), repainted from a placed
 * {@link import('../data/hud.js').HudPlacement}. The load-bearing decisions (which number, laid out
 * where) are the pure `hud.ts` half a human doesn't need for; this is only the pixel repaint + the
 * tunable style (colour/font/opacity).
 *
 * RETAINED like every other layer ({@link import('./world-renderer.js').WorldRenderer} calls
 * {@link draw} every frame): the panel {@link Graphics} and a {@link Text} pool persist across frames,
 * and a row's `.text` is only reassigned when the string actually changed — a Pixi `Text` re-rasterizes
 * its glyphs on every text/style write, so the old create-N-Texts-per-frame repaint was per-frame canvas
 * rasterization + GC churn for a panel that changes maybe once a second (a tick counter line).
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

/** Field-wise {@link HudStyle} equality (the placement is rebuilt per frame, so identity can't be
 *  trusted for change detection — 5 scalar compares are cheaper than one wrong repaint). */
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
  /** The overlay container — a sibling of the world layer (NOT under the camera), so it stays pinned. */
  readonly container = new Container();
  /** The panel backdrop, repainted only when its box or style changes. */
  private readonly panel = new Graphics();
  /** The pooled text rows, grown on demand and hidden (never destroyed) when a frame needs fewer. */
  private readonly rows: Text[] = [];
  /** Monotonic style generation + the generation each pooled row was last styled at — a row hidden
   *  across a style change is restyled on REUSE (the hide loop doesn't touch styles), never stale. */
  private styleGen = 0;
  private readonly rowStyleGen: number[] = [];
  private lastStyle: HudStyle | undefined;
  /** The panel box the backdrop was last painted for (`[x, y, w, h]`; NaN = never painted). */
  private lastBox: [number, number, number, number] = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];

  constructor() {
    this.container.addChild(this.panel);
  }

  /** Repaint the pinned HUD in place: update only what changed since the last frame (see class doc). */
  draw(hud?: HudFrame): void {
    if (hud === undefined) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const style = hud.style ?? DEFAULT_HUD_STYLE;
    const styleChanged = this.lastStyle === undefined || !sameStyle(style, this.lastStyle);
    // Snapshot the style by VALUE — a caller may legally mutate one options object in place, and a
    // stored reference would then always compare equal to itself and mask the change.
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
        // Only touch what re-rasterizes: `.text`/`.style` writes redraw the glyph canvas, a position
        // write is a cheap transform update. Compare per-row GENERATIONS (not just this frame's
        // `styleChanged`): a row that sat hidden across a style change was skipped then, so it
        // restyles here on reuse.
        if (this.rowStyleGen[i] !== this.styleGen) {
          text.style = { fill: style.textColor, fontSize: style.fontSize, fontFamily: style.fontFamily };
        }
        if (text.text !== row.text) text.text = row.text;
      }
      this.rowStyleGen[i] = this.styleGen;
      text.position.set(row.x, row.y);
      text.visible = true;
    }
    // Hide surplus pooled rows from a taller earlier frame (kept for when the panel grows back).
    for (let i = p.rows.length; i < this.rows.length; i++) {
      const text = this.rows[i];
      if (text !== undefined) text.visible = false;
    }
  }

  /** Tear down the overlay layer (the panel + every pooled row is a child, so one destroy frees all). */
  destroy(): void {
    this.container.destroy({ children: true });
    this.rows.length = 0;
  }
}
