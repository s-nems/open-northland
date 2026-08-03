import type { PalettedSprite } from '@open-northland/render';
import { type GuiArt, makeGuiSprite } from '../../content/gui-art.js';
import type { PlacedButton } from './layout.js';
import type { StripSpriteSpec } from './strip-texture.js';

/**
 * Deliberate deviation from the original, which blits each button whole including its opaque dark socket
 * backdrop: the backdrop is keyed transparent so the carved strip shows through, and glyph contrast comes
 * from a 1-design-px silhouette rim in the socket's own colour instead.
 */

/** Socket backdrop colour sampled from `ls_gui_window` frame 0x31 at (2,2). */
const BUTTON_OUTLINE_COLOR = 0x000800;
/** Silhouette stamp offsets: 1 design px out in all eight directions. */
const BUTTON_OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export interface OutlinedButtonSprites {
  /** All outline stamps first, then every real glyph, so a button's rim cannot stamp over a touching
   *  neighbour's art. */
  readonly specs: readonly StripSpriteSpec[];
  /** The speed button's outline stamps and real glyph; a speed change re-frames all of them together. */
  readonly speedSprites: readonly PalettedSprite[];
}

export function buildOutlinedButtonSpecs(
  art: GuiArt,
  buttons: readonly PlacedButton[],
): OutlinedButtonSprites {
  const specs: StripSpriteSpec[] = [];
  const speedSprites: PalettedSprite[] = [];
  for (const b of buttons) {
    for (const [dx, dy] of BUTTON_OUTLINE_OFFSETS) {
      const os = makeGuiSprite(art, b.gfx, { defaultPalette: 'iconsleft', colorKey: 'full' });
      if (os === null) continue;
      os.sprite.silhouette = BUTTON_OUTLINE_COLOR;
      specs.push({
        spr: os.sprite,
        design: { x: b.rect.x + dx, y: b.rect.y + dy, w: b.rect.w, h: b.rect.h },
      });
      if (b.id === 'speed') speedSprites.push(os.sprite);
    }
  }
  for (const b of buttons) {
    const gs = makeGuiSprite(art, b.gfx, { defaultPalette: 'iconsleft', colorKey: 'full' });
    if (gs === null) continue;
    specs.push({ spr: gs.sprite, design: b.rect });
    if (b.id === 'speed') speedSprites.push(gs.sprite);
  }
  return { specs, speedSprites };
}
