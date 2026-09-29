import { describe, expect, it } from 'vitest';
import { parseIniSections, rampAliasMap } from '../src/decoders/ini.js';
import { cutRamp, extractRandomPalettes } from '../src/decoders/random-palette.js';

// The `randompalette.ini` grammar, minimally: ramp and copy sources with weights, a lower-case `patch`
// key, a malformed line, and a duplicate name.
const RECIPES_INI = `[RandomPalette]
Name "Vik_WoMan_Base"
Patch 1 "Skin Pale 1" 10
Patch 14 15 10
patch 14 1 5
Patch 13 "colors grey"

[RandomPalette]
Name "vik_woman_base"
Patch 2 "hair brown" 10

[RandomPalette]
Patch 3 "nameless" 10
`;

const PALETTES_INI = `[GfxPalette256]
editname "human_colors"
gfxfile "data\\engine2d\\bin\\palettes\\creatures\\colors.pcx"
[GfxPalette16]
editname "colors grey"
gfxcolorrange "human_colors" 14
`;

/** A 768-byte palette where entry `i` is `(i, i, i)` - band contents assert by index. */
function greyscalePalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.set([i, i, i], i * 3);
  return p;
}

describe('extractRandomPalettes', () => {
  it('reads lower-cased names and weighted ramp and copy patches in file order', () => {
    expect(extractRandomPalettes(parseIniSections(RECIPES_INI))).toEqual([
      {
        name: 'vik_woman_base',
        patches: [
          { band: 1, source: { kind: 'ramp', ramp: 'skin pale 1' }, weight: 10 },
          { band: 14, source: { kind: 'copy', band: 15 }, weight: 10 },
          { band: 14, source: { kind: 'copy', band: 1 }, weight: 5 },
        ],
      },
    ]);
  });
});

describe('rampAliasMap + cutRamp', () => {
  it('resolves a GfxPalette16 name to its source palette range', () => {
    const ramps = rampAliasMap(parseIniSections(PALETTES_INI));
    expect(ramps.get('colors grey')).toEqual({ name: 'colors grey', source: 'human_colors', range: 14 });
    const ramp = cutRamp(greyscalePalette(), 14);
    // Range 14 = palette indices 224..239.
    expect([ramp?.[0], ramp?.[45]]).toEqual([224, 239]);
    expect(cutRamp(greyscalePalette(), 16)).toBeUndefined();
  });
});
