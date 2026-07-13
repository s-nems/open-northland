import type { PalettedSprite } from '@open-northland/render';
import { type GuiArt, makeGuiSprite } from '../../content/gui-art.js';
import type { PlacedButton } from './layout.js';
import type { StripSpriteSpec } from './strip-texture.js';

/**
 * The tool-strip BUTTON composition — keyed glyphs plus a contrast outline (the policy half; the bake
 * itself is `strip-texture.ts`).
 *
 * The GUI palettes reserve index 0 (magenta) + a near-black band as each element's backdrop, and a bob
 * writes them opaque — the original engine blits the buttons WHOLE, dark socket backdrop included, hiding
 * gameplay in a separate area. Over our full-screen world that opaque socket column read as a heavy black
 * slab (user-rejected), so this is a DELIBERATE deviation: the backdrop is keyed transparent (the carved
 * strip shows through) and each glyph instead gets a 1-design-px rim in the socket's own colour — eight
 * offset silhouette stamps behind the real sprite ({@link PalettedSprite.silhouette}) — keeping the
 * original's glyph/backdrop contrast (thin glyphs like the ×1 speed digit frayed against bare stone)
 * without its full socket.
 */

/**
 * The outline stamp geometry + colour: silhouette copies of each glyph offset 1 design px out in all
 * eight directions, in the sampled backdrop colour of the original button sockets (`ls_gui_window`
 * frame 0x31 at (2,2) → rgb(0,8,0)).
 */
const BUTTON_OUTLINE_COLOR = 0x000800;
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
  /** Bake-ready specs: ALL outline stamps first, then every real glyph, so a button's rim can never
   *  stamp over a touching neighbour's art (adjacent button rects share an edge). */
  readonly specs: readonly StripSpriteSpec[];
  /** The speed button's outline stamps + real glyph — a speed change re-frames ALL of them (one shape). */
  readonly speedSprites: readonly PalettedSprite[];
}

/** Build the outlined-button sprite specs for the strip bake (see the module note for the why). */
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
