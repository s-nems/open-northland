import { describe, expect, it } from 'vitest';
import { applyArmorRecipe, cutRamp, extractArmorRecipes } from '../src/decoders/armor-palette.js';
import { iniBytesToSections, rampAliasMap } from '../src/decoders/ini.js';

/**
 * The armor recolor decoder against synthetic ini text mirroring the real grammar: recipe
 * extraction (`human_armor_%3.3d` only, quoted-name vs numeric-copy sources), named-ramp
 * resolution through `[GfxPalette16] gfxcolorrange`, and sequential patch application (a later
 * copy reads a band an earlier patch just wrote, the `human_armor_001` `Patch 12 11` idiom).
 */

const RECIPES_INI = `[RandomPalette]
Name "human_misc_001"
Patch 15 "hair brown" 10

[RandomPalette]
Name "human_armor_001"
Patch 5 "colors grey bright" 10
Patch 11 "colors grey" 10
Patch 12 11 10
`;

const PALETTES_INI = `[GfxPalette256]
editname "human_colors"
gfxfile "data\\engine2d\\bin\\palettes\\creatures\\colors.pcx"
[GfxPalette16]
editname "colors grey"
gfxcolorrange "human_colors" 14
[GfxPalette16]
editname "colors grey bright"
gfxcolorrange "human_colors" 15
`;

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A 768-byte palette where entry `i` is `(i, i, i)` — band contents assert by index. */
function greyscalePalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.set([i, i, i], i * 3);
  return p;
}

describe('extractArmorRecipes', () => {
  it('extracts only the human_armor family, with ramp and copy sources', () => {
    const recipes = extractArmorRecipes(iniBytesToSections(bytes(RECIPES_INI)));
    expect(recipes).toEqual([
      {
        tier: 1,
        patches: [
          { band: 5, source: { kind: 'ramp', name: 'colors grey bright' } },
          { band: 11, source: { kind: 'ramp', name: 'colors grey' } },
          { band: 12, source: { kind: 'copy', band: 11 } },
        ],
      },
    ]);
  });
});

describe('rampAliasMap + cutRamp', () => {
  it('resolves a GfxPalette16 name to its source palette range', () => {
    const ramps = rampAliasMap(iniBytesToSections(bytes(PALETTES_INI)));
    expect(ramps.get('colors grey')).toEqual({ name: 'colors grey', source: 'human_colors', range: 14 });
    const ramp = cutRamp(greyscalePalette(), 14);
    // Range 14 = palette indices 224..239.
    expect([ramp?.[0], ramp?.[45]]).toEqual([224, 239]);
  });
});

describe('applyArmorRecipe', () => {
  it('applies patches in order so a copy reads a band the recipe just wrote', () => {
    const [recipe] = extractArmorRecipes(iniBytesToSections(bytes(RECIPES_INI)));
    if (recipe === undefined) throw new Error('recipe missing');
    const source = greyscalePalette();
    const ramps = new Map<string, Uint8Array>([
      ['colors grey bright', new Uint8Array(48).fill(200)],
      ['colors grey', new Uint8Array(48).fill(100)],
    ]);
    const out = applyArmorRecipe(greyscalePalette(), recipe, (name) => ramps.get(name));
    expect(out[5 * 16 * 3]).toBe(200); // band 5 <- "colors grey bright"
    expect(out[11 * 16 * 3]).toBe(100); // band 11 <- "colors grey"
    expect(out[12 * 16 * 3]).toBe(100); // band 12 <- copy of the freshly-patched band 11
    expect(out[13 * 16 * 3]).toBe(source[13 * 16 * 3]); // untouched band keeps the base colour
  });

  it('throws on an unresolvable ramp instead of half-applying', () => {
    const [recipe] = extractArmorRecipes(iniBytesToSections(bytes(RECIPES_INI)));
    if (recipe === undefined) throw new Error('recipe missing');
    expect(() => applyArmorRecipe(greyscalePalette(), recipe, () => undefined)).toThrow(/unresolved ramp/);
  });
});
