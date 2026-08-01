import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createGlyphKit, type GlyphKit } from '../src/hud/details-panel/glyphs.js';
import type { Rect } from '../src/hud/geometry.js';

/** The bake oversamples `panel.ts` builds the chrome at (integer, clamped to `PANEL_MAX_SUPERSAMPLE`). */
const BAKE_SCALES = [1, 2, 3, 4] as const;
/** Design-px sides of the square box a glyph is fitted into: the gather button's inset face
 *  (`GATHER_ICON` 20 less twice `GATHER_ICON_PAD`), the equip-slot action button (`EQUIP_ACTION_BTN`),
 *  and the assign round button (`ASSIGN_ICON`). The smallest box is where the kit's `Math.max` floors
 *  on cell, gap and line width start to bite. */
const BOX_SIDES = [14, 15, 20] as const;
const BOX: Rect = { x: 0, y: 0, w: 20, h: 20 };
/** A sentinel bevel tone: the kit takes it as a dep, so a hardcoded twin would not show up here. */
const BEVEL_DARK = 0x123456;

const FACES: readonly { readonly name: string; readonly draw: (kit: GlyphKit, r: Rect) => void }[] = [
  { name: 'all-goods tiles', draw: (kit, r) => kit.glyphAll(r) },
  { name: 'house (enabled)', draw: (kit, r) => kit.glyphHouse(r, true) },
  { name: 'house (disabled)', draw: (kit, r) => kit.glyphHouse(r, false) },
  { name: 'plus', draw: (kit, r) => kit.glyphPlus(r) },
  { name: 'swap arrows', draw: (kit, r) => kit.glyphSwap(r) },
  { name: 'cross', draw: (kit, r) => kit.glyphCross(r) },
];

/** The colours a draw recorded, in order. Pixi normalizes every `fill()` into a style carrying the
 *  resolved colour, so this reads the tone that actually reaches the draw, not the call argument. */
function fillColors(draw: (g: Graphics) => void): number[] {
  const g = new Graphics();
  draw(g);
  return g.context.instructions.flatMap((i) => (i.action === 'fill' ? [i.data.style.color] : []));
}

describe('details-panel glyph faces', () => {
  // Local bounds include stroke width, which is what overflows first when a glyph is retuned.
  for (const face of FACES) {
    it(`draws the ${face.name} within its box`, () => {
      for (const scale of BAKE_SCALES) {
        for (const side of BOX_SIDES) {
          const box: Rect = { x: 137 * scale, y: 402 * scale, w: side * scale, h: side * scale };
          const g = new Graphics();
          face.draw(createGlyphKit({ g, scale, bevelDark: BEVEL_DARK }), box);
          const drawn = g.getLocalBounds();
          const where = `${face.name} in a ${side}px box at ×${scale}`;
          expect(drawn.x, where).toBeGreaterThanOrEqual(box.x);
          expect(drawn.y, where).toBeGreaterThanOrEqual(box.y);
          expect(drawn.x + drawn.width, where).toBeLessThanOrEqual(box.x + box.w);
          expect(drawn.y + drawn.height, where).toBeLessThanOrEqual(box.y + box.h);
        }
      }
    });
  }

  it('punches the house door in the bevel tone it was given', () => {
    const drawn = fillColors((g) =>
      createGlyphKit({ g, scale: 1, bevelDark: BEVEL_DARK }).glyphHouse(BOX, true),
    );
    expect(drawn).toContain(BEVEL_DARK);
  });

  it('dims the house glyph when the assign action is unavailable', () => {
    const bodyOf = (enabled: boolean): number[] =>
      fillColors((g) =>
        createGlyphKit({ g, scale: 1, bevelDark: BEVEL_DARK }).glyphHouse(BOX, enabled),
      ).filter((color) => color !== BEVEL_DARK);
    expect(bodyOf(true)).not.toHaveLength(0);
    expect(bodyOf(true)).not.toEqual(bodyOf(false));
  });
});
