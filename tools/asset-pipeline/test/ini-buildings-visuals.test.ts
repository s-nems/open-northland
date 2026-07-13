import { describe, expect, it } from 'vitest';
import {
  extractBuildingBobs,
  extractBuildingGraphics,
  extractBuildingOverlays,
  extractConstructionLayers,
  parseIniSections,
} from '../src/decoders/ini.js';
import { HOUSES_INI } from './fixtures/ini-sources.js';

const GFXHOUSE_LAYERS_INI = `[GfxHouse]
EditName "viking hut"
LogicTribeType 1
LogicType 0 2
LogicType 1 3
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd"
GfxPalette "house01" "house02"
GfxBobId 0 1
GfxBobId 1 11
GfxBobConstructionLayer 0 0 3 -1 10 70
GfxBobConstructionLayer 0 0 2 5 0 50
GfxBobConstructionLayer 0 0 1 -1 20 100
GfxBobConstructionLayer 0 1 11 -1 0 100
GfxBobConstructionLayer 1 0 13 -1 10 70
`;

describe('extractConstructionLayers', () => {
  const src = { file: 'budynki12/houses/houses.ini', layer: 'mod' as const };

  it('joins layers to typeIds by level, keeping file order as stackIdx and fanning out per palette', () => {
    const layers = extractConstructionLayers(parseIniSections(GFXHOUSE_LAYERS_INI), src);
    const level0 = layers.filter((l) => l.typeId === 2 && l.paletteName === 'house01');
    expect(level0.map((l) => ({ bob: l.bobId, up: l.upgrade, i: l.stackIdx }))).toEqual([
      { bob: 3, up: false, i: 0 },
      { bob: 2, up: false, i: 1 },
      { bob: 1, up: false, i: 2 },
      { bob: 11, up: true, i: 3 }, // the upgrade-overlay row is kept but flagged
    ]);
    // `-1` shadow → absent; a real shadow id is kept.
    expect(level0[0]?.shadowBobId).toBeUndefined();
    expect(level0[1]?.shadowBobId).toBe(5);
    expect(level0[1]?.fromPct).toBe(0);
    expect(level0[1]?.toPct).toBe(50);
    // Level 1's layer lands on typeId 3; both palettes get every row.
    expect(layers.filter((l) => l.typeId === 3)).toHaveLength(2);
    expect(layers.filter((l) => l.paletteName === 'house02')).toHaveLength(5);
    expect(level0[0]?.bmd).toBe('data/engine2d/bin/bobs/ls_houses_viking.bmd');
  });

  it('returns an empty array for sources with no [GfxHouse] records', () => {
    expect(extractConstructionLayers(parseIniSections(HOUSES_INI), src)).toEqual([]);
  });
});

// Mirrors the real mill record's overlay grammar: a type-4 `GfxOverlay <sizeIdx> 4 <state> <x> <y>
// <step> <bobId…>` pair (state 0 = the still blade frame, state 1 = the spin cycle) beside a type-3
// row (a different, undecoded shape) that must be skipped, joined to typeIds via `LogicType`.
const GFXHOUSE_OVERLAYS_INI = `[GfxHouse]
EditName "viking mill"
LogicTribeType 1
LogicType 0 13
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd"
GfxPalette "houseMiller01"
GfxBobId 0 70
GfxOverlay 0 4 0 0 0 1 76
GfxOverlay 0 4 1 0 0 1 85 84 83 82 81
GfxOverlay 0 3 1 3 -103 0
`;

describe('extractBuildingOverlays', () => {
  const src = { file: 'budynki12/houses/houses.ini', layer: 'mod' as const };

  it('extracts the two type-4 state rows, skipping the undecoded type-3 row', () => {
    const overlays = extractBuildingOverlays(parseIniSections(GFXHOUSE_OVERLAYS_INI), src);
    expect(overlays).toHaveLength(2);
    const idle = overlays.find((o) => o.state === 0);
    const working = overlays.find((o) => o.state === 1);
    expect(idle).toMatchObject({
      tribeId: 1,
      typeId: 13,
      level: 0,
      x: 0,
      y: 0,
      step: 1,
      frames: [76],
      bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
      paletteName: 'housemiller01',
      editName: 'viking mill',
    });
    expect(working?.frames).toEqual([85, 84, 83, 82, 81]);
  });

  it('returns an empty array for sources with no [GfxHouse] records', () => {
    expect(extractBuildingOverlays(parseIniSections(HOUSES_INI), src)).toEqual([]);
  });
});

// Mirrors DataCnmd/budynki12/houses/houses.ini for the bob join: a `[GfxHouse]` record pairs a per-level
// `LogicType <level> <typeId>` table with a `GfxBobId <level> <bobId>` table, names the body `.bmd`
// (`GfxBobLibs[0]`) recoloured by one-or-more palette skins, and is keyed to a tribe. A "home" spans
// several levels (rising typeId + bob); a "well" is one level with TWO palette skins; the "headquarters"
// has a `LogicType` but no `GfxBobId` (a free stage → no bob row).
const GFXHOUSE_BOBS_INI = `[GfxHouse]
EditName "viking home"
LogicTribeType 1
LogicType 0 2
LogicType 1 3
LogicType 4 6
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd" "data\\engine2d\\bin\\bobs\\ls_houses_viking_s.bmd"
GfxPalette "house01"
GfxBobId 0 1
GfxBobId 1 11
GfxBobId 4 41
[GfxHouse]
EditName "viking well"
LogicTribeType 1
LogicType 0 10
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd"
GfxPalette "house01" "house02"
GfxBobId 0 131
[GfxHouse]
EditName "headquarters"
LogicTribeType 1
LogicType 0 1
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd"
GfxPalette "house01"
`;

describe('extractBuildingBobs', () => {
  const src = { file: 'budynki12/houses/houses.ini', block: 'GfxHouse', layer: 'mod' as const };

  it('pairs LogicType and GfxBobId by level, emitting one row per (typeId, level) → bob', () => {
    const bobs = extractBuildingBobs(parseIniSections(GFXHOUSE_BOBS_INI), src);
    // The home's three paired levels each resolve to their own typeId + bob (the top tier is the
    // transcribed `6: 41`; the lower tiers are the growth stages the transcribed table omitted).
    expect(bobs.filter((b) => b.editName === 'viking home')).toEqual([
      {
        tribeId: 1,
        typeId: 2,
        level: 0,
        bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
        paletteName: 'house01',
        bobId: 1,
        editName: 'viking home',
        source: src,
      },
      {
        tribeId: 1,
        typeId: 3,
        level: 1,
        bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
        paletteName: 'house01',
        bobId: 11,
        editName: 'viking home',
        source: src,
      },
      {
        tribeId: 1,
        typeId: 6,
        level: 4,
        bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
        paletteName: 'house01',
        bobId: 41,
        editName: 'viking home',
        source: src,
      },
    ]);
  });

  it('emits one row per palette skin (the same bob recoloured into each `GfxPalette` value)', () => {
    const well = extractBuildingBobs(parseIniSections(GFXHOUSE_BOBS_INI), src).filter((b) => b.typeId === 10);
    // `GfxPalette "house01" "house02"` → two rows, the same `(typeId 10 → bob 131)` in each recolour,
    // so a render that loaded either atlas finds its row.
    expect(well.map((b) => b.paletteName)).toEqual(['house01', 'house02']);
    expect(new Set(well.map((b) => b.bobId))).toEqual(new Set([131]));
  });

  it('omits a level with a LogicType but no matching GfxBobId (the free headquarters stage)', () => {
    const bobs = extractBuildingBobs(parseIniSections(GFXHOUSE_BOBS_INI), src);
    expect(bobs.some((b) => b.typeId === 1)).toBe(false);
  });

  it('skips a record missing a body `.bmd`, any palette, or a LogicTribeType (never throws)', () => {
    // No GfxBobLibs, no GfxPalette, no LogicTribeType — each alone disqualifies the record.
    const bobs = extractBuildingBobs(
      parseIniSections(`[GfxHouse]
EditName "no bmd"
LogicTribeType 1
LogicType 0 2
GfxPalette "house01"
GfxBobId 0 9
[GfxHouse]
EditName "no palette"
LogicTribeType 1
LogicType 0 3
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd"
GfxBobId 0 9
[GfxHouse]
EditName "no tribe"
LogicType 0 4
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd"
GfxPalette "house01"
GfxBobId 0 9
`),
      src,
    );
    expect(bobs).toEqual([]);
  });

  it('returns an empty array for sources with no [GfxHouse] records (the logic-only tables)', () => {
    expect(extractBuildingBobs(parseIniSections(HOUSES_INI), src)).toEqual([]);
  });

  // The real saracen/egypt blocks pack MANY houses under ONE `[GfxHouse]` bracket, each delimited only
  // by a fresh `EditName` (no new bracket) — so `parseIniSections` lumps them into one section. Two
  // houses with DIFFERENT bmd/palette/typeId/bob under one header; each must be recovered intact (a
  // naive one-house-per-section read staples house A's bmd+palette to house B's last-wins type/bob).
  const GFXHOUSE_LUMPED_INI = `[GfxHouse]
EditName "saracen residence 06"
LogicTribeType 4
LogicType 0 6
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_saracen.bmd"
GfxPalette "caves"
GfxBobId 0 90
EditName "saracen well"
LogicTribeType 4
LogicType 0 10
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_beduines.bmd"
GfxPalette "rock03"
GfxBobId 0 12
`;

  it('splits a lumped [GfxHouse] block (many houses, one bracket) into per-house records', () => {
    const bobs = extractBuildingBobs(parseIniSections(GFXHOUSE_LUMPED_INI), src);
    // Both houses survive, each with its OWN bmd + palette + bob (not house A's bmd stapled to B's bob).
    expect(bobs).toEqual([
      {
        tribeId: 4,
        typeId: 6,
        level: 0,
        bmd: 'data/engine2d/bin/bobs/ls_houses_saracen.bmd',
        paletteName: 'caves',
        bobId: 90,
        editName: 'saracen residence 06',
        source: src,
      },
      {
        tribeId: 4,
        typeId: 10,
        level: 0,
        bmd: 'data/engine2d/bin/bobs/ls_houses_beduines.bmd',
        paletteName: 'rock03',
        bobId: 12,
        editName: 'saracen well',
        source: src,
      },
    ]);
  });

  it('de-duplicates byte-identical rows (a literally-duplicated source record) but keeps variants', () => {
    // Three records under one bracket: an exact duplicate (same type/bmd/palette/bob/editName → ONE row)
    // and a same-typeId VARIANT (different editName + bob → KEPT, the join is multi-valued).
    const bobs = extractBuildingBobs(
      parseIniSections(`[GfxHouse]
EditName "frank ship small"
LogicTribeType 2
LogicType 0 44
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_vehicles.bmd"
GfxPalette "caves"
GfxBobId 0 4
EditName "frank ship small"
LogicTribeType 2
LogicType 0 44
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_vehicles.bmd"
GfxPalette "caves"
GfxBobId 0 4
EditName "frank ship small front"
LogicTribeType 2
LogicType 0 44
GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_vehicles.bmd"
GfxPalette "caves"
GfxBobId 0 5
`),
      src,
    );
    // One row for the duplicated record + one for the bob-5 variant = 2 (not 3).
    expect(bobs.map((b) => ({ bob: b.bobId, edit: b.editName }))).toEqual([
      { bob: 4, edit: 'frank ship small' },
      { bob: 5, edit: 'frank ship small front' },
    ]);
  });
});

describe('extractBuildingGraphics', () => {
  // Mirrors the real DataCnmd/budynki12/houses/houses.ini [GfxHouse] grammar (CamelCase keys, as the .ini
  // parser yields it): a "viking home" that recolours one body bob into TWO skins on a single
  // GfxPalette line (house01 + house02), and a "viking stock" (the warehouse) on house02 alone — the
  // record whose missing atlas left the warehouse a placeholder box. A third record is a logic-only
  // marker (no GfxBobLibs) and must be skipped.
  const sections = parseIniSections(
    [
      '[GfxHouse]',
      'EditName "viking home"',
      'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd" "data\\engine2d\\bin\\bobs\\ls_houses_viking_s.bmd"',
      'GfxPalette "house01" "house02"',
      'GfxBobId 0 11',
      '[GfxHouse]',
      'EditName "viking stock"',
      'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_houses_viking.bmd" "data\\engine2d\\bin\\bobs\\ls_houses_viking_s.bmd"',
      'GfxPalette "house02"',
      'GfxBobId 0 53',
      '[GfxHouse]', // logic-only marker: no GfxBobLibs -> dropped
      'EditName "abstract group"',
      'GfxPalette "house01"',
    ].join('\n'),
  );

  it('emits one (bmd, palette) binding per GfxPalette value, normalizing path + lower-casing the name, carrying EditName', () => {
    expect(extractBuildingGraphics(sections)).toEqual([
      {
        bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/ls_houses_viking_s.bmd',
        paletteName: 'house01',
        tribeId: undefined,
        jobId: undefined,
        editName: 'viking home',
      },
      {
        bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/ls_houses_viking_s.bmd',
        paletteName: 'house02',
        tribeId: undefined,
        jobId: undefined,
        editName: 'viking home',
      },
      {
        bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/ls_houses_viking_s.bmd',
        paletteName: 'house02',
        tribeId: undefined,
        jobId: undefined,
        editName: 'viking stock',
      },
    ]);
  });

  it('skips a record with no body bob (logic-only marker)', () => {
    const noBob = parseIniSections(
      ['[GfxHouse]', 'EditName "unbindable"', 'GfxPalette "house01"'].join('\n'),
    );
    expect(extractBuildingGraphics(noBob)).toEqual([]);
  });
});
