import type { Graphics } from 'pixi.js';
import type { Rect } from '../geometry.js';

/** The details panel's flat vector glyph faces: no atlas art backs them, each is a pure `Graphics` shape. */

/** Cream tones of a glyph stroke, lit vs. dimmed, matching the button label's gold-cream / grey pair. */
const GLYPH_LIGHT = 0xead9a0;
const GLYPH_DIM = 0x8b7a55;
/** The four good tones of the "Wszystko" (gather-everything) tile - stone / wood / gold / herb - so it
 *  reads as a mix, distinct from any single good's pile. */
const ALL_GLYPH_TILES = [0xb8b0a0, 0x9a6a34, 0xe0b455, 0x7f9a2a] as const;

interface GlyphDeps {
  readonly g: Graphics;
  readonly scale: number;
  /** The panel's inner-box dark bevel tone, passed in from the {@link import('./chrome.js').Chrome} kit
   *  so a glyph's outlines and punched holes match the rest of the panel framing. */
  readonly bevelDark: number;
}

/** The panel's glyph faces. Each is centered in the caller's rect and stays inside it: that rect is a
 *  button plate the caller already drew, so overflow bleeds onto the panel behind the button. */
export interface GlyphKit {
  /** A 2×2 grid of mixed-good tiles: the "gather everything" round button's face, drawn distinct from
   *  any single good's pile so it never reads as one specific good. */
  glyphAll(r: Rect): void;
  /** A small house, the assign-workplace round button's face (assign this settler to a building);
   *  `enabled` picks the lit vs. dimmed cream. */
  glyphHouse(r: Rect, enabled: boolean): void;
  /** A plus - an empty equip slot's "put an item on" button face. Always lit: the per-slot order
   *  buttons are never disabled (see `EquipActionHit`). */
  glyphPlus(r: Rect): void;
  /** Two opposing horizontal arrows - a worn equip slot's "swap the item" button face. */
  glyphSwap(r: Rect): void;
  /** A diagonal cross - a worn equip slot's "take the item off" button face. */
  glyphCross(r: Rect): void;
}

export function createGlyphKit({ g, scale, bevelDark }: GlyphDeps): GlyphKit {
  const glyphAll = (r: Rect): void => {
    const cell = Math.max(2, Math.round(r.w * 0.34));
    const gap = Math.max(1, Math.round(r.w * 0.12));
    const block = cell * 2 + gap;
    const x0 = Math.round(r.x + (r.w - block) / 2);
    const y0 = Math.round(r.y + (r.h - block) / 2);
    const line = Math.max(1, Math.round(scale));
    ALL_GLYPH_TILES.forEach((color, i) => {
      const tx = x0 + (i % 2) * (cell + gap);
      const ty = y0 + Math.floor(i / 2) * (cell + gap);
      g.rect(tx, ty, cell, cell).fill(color);
      g.rect(tx, ty, cell, cell).stroke({ color: bevelDark, width: line, alpha: 0.6 });
    });
  };

  const glyphHouse = (r: Rect, enabled: boolean): void => {
    const color = enabled ? GLYPH_LIGHT : GLYPH_DIM;
    const cx = r.x + r.w / 2;
    const pad = r.w * 0.28;
    const x0 = r.x + pad;
    const x1 = r.x + r.w - pad;
    const y0 = r.y + pad;
    const y1 = r.y + r.h - pad;
    const eaveY = y0 + (y1 - y0) * 0.42;
    const wallW = x1 - x0;
    // Roof gable, then the wall box, then a punched door in the plate's dark tone.
    g.moveTo(x0, eaveY).lineTo(cx, y0).lineTo(x1, eaveY).closePath().fill(color);
    g.rect(x0 + wallW * 0.12, eaveY, wallW * 0.76, y1 - eaveY).fill(color);
    g.rect(cx - wallW * 0.11, y1 - (y1 - eaveY) * 0.55, wallW * 0.22, (y1 - eaveY) * 0.55).fill({
      color: bevelDark,
      alpha: 0.85,
    });
  };

  const glyphPlus = (r: Rect): void => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const arm = r.w * 0.22;
    const th = Math.max(1, Math.round(r.w * 0.14));
    g.rect(cx - arm, cy - th / 2, arm * 2, th).fill(GLYPH_LIGHT);
    g.rect(cx - th / 2, cy - arm, th, arm * 2).fill(GLYPH_LIGHT);
  };

  const glyphSwap = (r: Rect): void => {
    const x0 = r.x + r.w * 0.22;
    const x1 = r.x + r.w * 0.78;
    const cy = r.y + r.h / 2;
    // Two opposed arrow lanes around the centre line: top shaft points right, bottom shaft points left.
    const lane = r.h * 0.14;
    const th = Math.max(1, Math.round(r.w * 0.1));
    const head = r.w * 0.16;
    g.moveTo(x0, cy - lane)
      .lineTo(x1 - head, cy - lane)
      .stroke({ color: GLYPH_LIGHT, width: th });
    g.moveTo(x1, cy - lane)
      .lineTo(x1 - head, cy - lane - head)
      .lineTo(x1 - head, cy - lane + head)
      .closePath()
      .fill(GLYPH_LIGHT);
    g.moveTo(x1, cy + lane)
      .lineTo(x0 + head, cy + lane)
      .stroke({ color: GLYPH_LIGHT, width: th });
    g.moveTo(x0, cy + lane)
      .lineTo(x0 + head, cy + lane - head)
      .lineTo(x0 + head, cy + lane + head)
      .closePath()
      .fill(GLYPH_LIGHT);
  };

  const glyphCross = (r: Rect): void => {
    const pad = r.w * 0.3;
    const th = Math.max(1, Math.round(r.w * 0.14));
    const x0 = r.x + pad;
    const x1 = r.x + r.w - pad;
    const y0 = r.y + pad;
    const y1 = r.y + r.h - pad;
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: GLYPH_LIGHT, width: th });
    g.moveTo(x1, y0).lineTo(x0, y1).stroke({ color: GLYPH_LIGHT, width: th });
  };

  return { glyphAll, glyphHouse, glyphPlus, glyphSwap, glyphCross };
}
