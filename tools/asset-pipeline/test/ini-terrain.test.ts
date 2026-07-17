import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import { cifLinesToSections, extractPatterns, extractPatternTransitions } from '../src/decoders/ini.js';

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
