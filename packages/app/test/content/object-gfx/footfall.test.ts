import { describe, expect, it } from 'vitest';
import { mapFootfallGround } from '../../../src/content/object-gfx/footfall.js';

const SAND = 4;
const SNOW = 7;
const MEADOW = 2;

/** One snow, one ice (sand drawn with the snow texture), one desert and one meadow pattern. */
const PATTERNS = [
  { editName: 'snow', logicType: SNOW, texture: 'snow.pcx' },
  { editName: 'ice', logicType: SAND, texture: 'snow.pcx' },
  { editName: 'desert', logicType: SAND, texture: 'desert.pcx' },
  { editName: 'meadow', logicType: MEADOW, texture: 'meadow.pcx' },
];

describe('mapFootfallGround', () => {
  it('joins the map ground to the patterns by name, ice counting as snow', () => {
    // The map's own dictionary orders the patterns differently from the catalogue.
    const ground = { patterns: ['meadow', 'desert', 'ice', 'snow'], a: [3, 2, 1, 0], b: [3, 2, 1, 0] };
    const footfall = mapFootfallGround({ width: 4, height: 1, typeIds: [0, 0, 0, 0], ground }, PATTERNS);
    // Codes: 1 snow prints, 3 dust, 0 nothing.
    expect(Array.from(footfall?.cells ?? [])).toEqual([1, 1, 3, 0]);
  });

  it('builds nothing without a ground lane', () => {
    expect(mapFootfallGround({ width: 1, height: 1, typeIds: [0] }, PATTERNS)).toBeNull();
  });
});
