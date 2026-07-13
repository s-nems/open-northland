import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  buildTerrainPatterns,
  cifLinesToSections,
  extractLandscape,
  extractPatterns,
  extractPatternTransitions,
  extractTrianglePatternTypes,
  parseIniSections,
} from '../src/decoders/ini.js';

describe('extractPatterns', () => {
  // Mirrors Data/engine2d/inis/patterns/pattern.cif as cifLinesToSections yields it: level-1 CamelCase
  // `GfxPattern` headers, level-2 CamelCase props. Record 0 = the misc "border" tile (LogicType 0, single
  // EditGroup); record 1 = a meadow tile carrying THREE EditGroups (the real data has groups of length
  // 1, 2 and 3 — kept verbatim, any count); record 2 has a malformed (5-int) GfxCoordsA -> that tuple
  // degrades to undefined but the record still occupies its positional slot.
  const lines: CifLine[] = [
    { level: 1, text: 'GfxPattern' },
    { level: 2, text: 'EditName "border"' },
    { level: 2, text: 'EditGroups "misc"' },
    { level: 2, text: 'LogicType 0' },
    { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_000.pcx"' },
    { level: 2, text: 'GfxCoordsA 0 0 63 63 0 63' },
    { level: 2, text: 'GfxCoordsB 0 0 63 0 63 63' },
    { level: 1, text: 'GfxPattern' },
    { level: 2, text: 'EditName "block meadow 01"' },
    { level: 2, text: 'EditGroups "meadow all" "meadow green" "meadow 3x3"' },
    { level: 2, text: 'LogicType 2' },
    { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_003.pcx"' },
    { level: 2, text: 'GfxCoordsA 64 0 127 63 64 63' },
    { level: 2, text: 'GfxCoordsB 64 0 127 0 127 63' },
    { level: 1, text: 'GfxPattern' },
    { level: 2, text: 'EditName "degenerate"' },
    { level: 2, text: 'LogicType 4' },
    { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\text_009.pcx"' },
    { level: 2, text: 'GfxCoordsA 1 2 3 4 5' }, // 5 ints -> wrong arity -> undefined
    { level: 2, text: 'GfxCoordsB 0 0 1 1 2 2' },
  ];

  it('maps [GfxPattern] to validated IR: positional id, multi-value EditGroups, normalized texture, 6-int UV tuples', () => {
    const patterns = extractPatterns(cifLinesToSections(lines), {
      file: 'Data/engine2d/inis/patterns/pattern.cif',
      layer: 'base',
    });
    const src = { file: 'Data/engine2d/inis/patterns/pattern.cif', block: 'GfxPattern', layer: 'base' };
    expect(patterns).toEqual([
      {
        id: 0,
        editName: 'border',
        editGroups: ['misc'],
        logicType: 0,
        texture: 'data/engine2d/bin/textures/text_000.pcx',
        coordsA: [0, 0, 63, 63, 0, 63],
        coordsB: [0, 0, 63, 0, 63, 63],
        source: src,
      },
      {
        id: 1,
        editName: 'block meadow 01',
        editGroups: ['meadow all', 'meadow green', 'meadow 3x3'],
        logicType: 2,
        texture: 'data/engine2d/bin/textures/text_003.pcx',
        coordsA: [64, 0, 127, 63, 64, 63],
        coordsB: [64, 0, 127, 0, 127, 63],
        source: src,
      },
      {
        id: 2,
        editName: 'degenerate',
        editGroups: [],
        logicType: 4,
        texture: 'data/engine2d/bin/textures/text_009.pcx',
        coordsA: undefined, // 5-int line dropped to undefined; the record keeps its positional id 2
        coordsB: [0, 0, 1, 1, 2, 2],
        source: src,
      },
    ]);
  });

  it('keeps ids contiguous by position (a non-GfxPattern section does not consume an id)', () => {
    const mixed: CifLine[] = [
      { level: 1, text: 'SomethingElse' },
      { level: 2, text: 'EditName "ignored"' },
      { level: 1, text: 'GfxPattern' },
      { level: 2, text: 'EditName "first"' },
      { level: 1, text: 'GfxPattern' },
      { level: 2, text: 'EditName "second"' },
    ];
    expect(
      extractPatterns(cifLinesToSections(mixed), { file: 'f.cif' }).map((p) => [p.id, p.editName]),
    ).toEqual([
      [0, 'first'],
      [1, 'second'],
    ]);
  });

  it('defaults logicType to 0 and texture/coords/editGroups to undefined/[] when a record omits them', () => {
    const [only] = extractPatterns(
      cifLinesToSections([
        { level: 1, text: 'GfxPattern' },
        { level: 2, text: 'EditName "bare"' },
      ]),
      { file: 'f.cif' },
    );
    expect(only).toEqual({
      id: 0,
      editName: 'bare',
      editGroups: [],
      logicType: 0,
      texture: undefined,
      coordsA: undefined,
      coordsB: undefined,
      source: { file: 'f.cif', block: 'GfxPattern', layer: 'base' },
    });
  });
});

describe('extractPatternTransitions', () => {
  // Mirrors Data/engine2d/inis/patterntransitions/transitions.cif as cifLinesToSections yields it:
  // level-1 lowercase `transition` headers, level-2 props, SIX repeated GfxCoordsA/GfxCoordsB lines
  // (file order = the pair index a map lane's `value % 6` selects). Two of the six pairs suffice to
  // prove the order is kept; the sibling `pointtype` sections must be ignored.
  const lines: CifLine[] = [
    { level: 1, text: 'pointtype' },
    { level: 2, text: 'name "meadow"' },
    { level: 2, text: 'patterngroup "meadow green"' },
    { level: 1, text: 'transition' },
    { level: 2, text: 'name "meadow 1"' },
    { level: 2, text: 'pointtype "meadow"' },
    { level: 2, text: 'GfxTexture "data\\engine2d\\bin\\textures\\tran_meadow.pcx"' },
    { level: 2, text: 'GfxTextureAlpha "data\\engine2d\\bin\\textures\\tran_meadow_a.pcx"' },
    { level: 2, text: 'GfxCoordsA 0 0 63 63 0 63' },
    { level: 2, text: 'GfxCoordsB 0 0 63 0 63 63' },
    { level: 2, text: 'GfxCoordsA 64 0 127 63 64 63' },
    { level: 2, text: 'GfxCoordsB 64 0 127 0 127 63' },
    { level: 1, text: 'transition' },
    { level: 2, text: 'name "degenerate"' },
    { level: 2, text: 'GfxCoordsA 1 2 3 4 5' }, // wrong arity -> the LINE is dropped, the record stays
  ];

  it('maps [transition] to validated IR: positional index, name join key, both pictures, ordered pairs', () => {
    const records = extractPatternTransitions(cifLinesToSections(lines), {
      file: 'Data/engine2d/inis/patterntransitions/transitions.cif',
      layer: 'base',
    });
    const src = {
      file: 'Data/engine2d/inis/patterntransitions/transitions.cif',
      block: 'transition',
      layer: 'base',
    };
    expect(records).toEqual([
      {
        index: 0,
        editName: 'meadow 1',
        pointType: 'meadow',
        texture: 'data/engine2d/bin/textures/tran_meadow.pcx',
        textureAlpha: 'data/engine2d/bin/textures/tran_meadow_a.pcx',
        coordsA: [
          [0, 0, 63, 63, 0, 63],
          [64, 0, 127, 63, 64, 63],
        ],
        coordsB: [
          [0, 0, 63, 0, 63, 63],
          [64, 0, 127, 0, 127, 63],
        ],
        source: src,
      },
      {
        index: 1,
        editName: 'degenerate',
        pointType: undefined,
        texture: undefined,
        textureAlpha: undefined,
        coordsA: [],
        coordsB: [],
        source: src,
      },
    ]);
  });
});

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
