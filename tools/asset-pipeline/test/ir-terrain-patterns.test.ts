import { describe, expect, it } from 'vitest';
import {
  cifLinesToSections,
  extractLandscape,
  extractPatterns,
  extractTrianglePatternTypes,
  parseIniSections,
} from '../src/decoders/ini.js';
import { buildTerrainPatterns } from '../src/stages/ir/terrain-patterns.js';

describe('buildTerrainPatterns (approximated typeId→ground-pattern map)', () => {
  // Three landscape types spanning the three families: void (land), water (water), rock (mountain).
  const landscape = extractLandscape(
    parseIniSections(
      '[landscapetype]\ntype 1\nname "void"\n[landscapetype]\ntype 3\nname "water"\n[landscapetype]\ntype 15\nname "rock"\n',
    ),
    { file: 'landscapetypes.ini' },
  );
  // Patterns: a short + a long water pattern (to prove the shortest-seed pick), a meadow (land), a
  // mountain. cifLinesToSections mirrors pattern.cif's CamelCase grammar.
  const patterns = extractPatterns(
    cifLinesToSections([
      { level: 1, text: 'GfxPattern' }, // a longer water name — must LOSE to "water 01"
      { level: 2, text: 'EditName "block water 00 00 00"' },
      { level: 2, text: 'LogicType 1' },
      { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_233.pcx"' },
      { level: 2, text: 'GfxCoordsA 0 0 63 63 0 63' },
      { level: 2, text: 'GfxCoordsB 0 0 63 0 63 63' },
      { level: 1, text: 'GfxPattern' },
      { level: 2, text: 'EditName "water 01"' },
      { level: 2, text: 'LogicType 1' },
      { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_002.pcx"' },
      { level: 2, text: 'GfxCoordsA 1 1 1 1 1 1' },
      { level: 2, text: 'GfxCoordsB 2 2 2 2 2 2' },
      { level: 1, text: 'GfxPattern' },
      { level: 2, text: 'EditName "meadow 01"' },
      { level: 2, text: 'LogicType 2' },
      { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_003.pcx"' },
      { level: 2, text: 'GfxCoordsA 3 3 3 3 3 3' },
      { level: 2, text: 'GfxCoordsB 4 4 4 4 4 4' },
      { level: 1, text: 'GfxPattern' },
      { level: 2, text: 'EditName "mountain 01"' },
      { level: 2, text: 'LogicType 3' },
      { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_001.pcx"' },
      { level: 2, text: 'GfxCoordsA 5 5 5 5 5 5' },
      { level: 2, text: 'GfxCoordsB 6 6 6 6 6 6' },
    ]),
    { file: 'pattern.cif' },
  );
  const triangleTypes = extractTrianglePatternTypes(
    cifLinesToSections([
      { level: 1, text: 'trianglepatterntype' },
      { level: 2, text: 'type 1' },
      { level: 2, text: 'debugname "water"' },
      { level: 2, text: 'debugcolor 0 98 115' },
      { level: 1, text: 'trianglepatterntype' },
      { level: 2, text: 'type 2' },
      { level: 2, text: 'debugname "land"' },
      { level: 2, text: 'debugcolor 23 145 25' },
      { level: 1, text: 'trianglepatterntype' },
      { level: 2, text: 'type 3' },
      { level: 2, text: 'debugname "mountain"' },
      { level: 2, text: 'debugcolor 66 66 66' },
    ]),
    { file: 'trianglepatterntypes.cif' },
  );

  it('classifies each landscape typeId by name family and binds its representative ground pattern', () => {
    const byTypeId = new Map(
      buildTerrainPatterns(landscape, patterns, triangleTypes, { file: 'pattern.cif', layer: 'base' }).map(
        (t) => [t.typeId, t],
      ),
    );
    // void -> land family -> meadow pattern + land debugColor.
    expect(byTypeId.get(1)).toEqual({
      typeId: 1,
      family: 'land',
      patternId: 2,
      logicType: 2,
      texture: 'data/engine2d/bin/textures/text_003.pcx',
      coordsA: [3, 3, 3, 3, 3, 3],
      coordsB: [4, 4, 4, 4, 4, 4],
      debugColor: [23, 145, 25],
      source: { file: 'pattern.cif', block: 'terrainpattern', layer: 'base' },
    });
    // water -> water family -> "water 01" (the SHORT seed name beats "block water 00 00 00").
    expect(byTypeId.get(3)).toMatchObject({
      typeId: 3,
      family: 'water',
      patternId: 1,
      logicType: 1,
      texture: 'data/engine2d/bin/textures/text_002.pcx',
      coordsA: [1, 1, 1, 1, 1, 1],
      debugColor: [0, 98, 115],
    });
    // rock -> mountain family -> mountain pattern.
    expect(byTypeId.get(15)).toMatchObject({
      typeId: 15,
      family: 'mountain',
      patternId: 3,
      logicType: 3,
      texture: 'data/engine2d/bin/textures/text_001.pcx',
      debugColor: [66, 66, 66],
    });
  });

  it('skips a landscape typeId whose family has no usable pattern (no representative → no ground)', () => {
    // Only a land pattern exists; a water-named type then binds nothing (its family is unrepresented).
    const landOnly = patterns.filter((p) => p.logicType === 2);
    const out = buildTerrainPatterns(landscape, landOnly, triangleTypes, { file: 'pattern.cif' });
    expect(out.map((t) => t.typeId)).toEqual([1]); // only "void" (land); water(3) + rock(15) dropped
  });
});

// Mirrors the real Data/engine2d/inis/palettes/palettes.ini grammar: [GfxPalette256] records with one
// gfxfile and one-or-more editname aliases, Windows backslash paths, the CIF header/footer marker lines.
