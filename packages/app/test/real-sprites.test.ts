import { describe, expect, it } from 'vitest';
import {
  BUILDING_FAMILIES,
  DEFAULT_BUILDING_FAMILY,
  buildHumanBindings,
  buildingBobRefsByType,
  directionalAnimFromSeq,
} from '../src/real-sprites.js';

/**
 * The seq→frame-range math behind `?atlas=real` — the self-verifiable half of consuming the decoded
 * `bobSequences` (the `extractBobSequences` pipeline leg). The browser half (do the pixels animate
 * right?) is the gather-resource / angled-path acceptance scenes; this proves the range derivation +
 * the graceful fallback deterministically, without a browser.
 */

const FALLBACK = { start: 1, dirs: 8, stride: 99 } as const;

describe('directionalAnimFromSeq', () => {
  it('derives start + stride (= length / DIRS) from a named sequence', () => {
    const seqs = new Map([['walk', { name: 'walk', start: 1988, length: 96 }]]);
    expect(directionalAnimFromSeq(seqs, 'walk', {}, FALLBACK)).toEqual({ start: 1988, dirs: 8, stride: 12 });
  });

  it('applies the render-taste overrides (frames / phaseStart) on top of the extracted range', () => {
    const seqs = new Map([['chop', { name: 'chop', start: 5106, length: 120 }]]);
    expect(directionalAnimFromSeq(seqs, 'chop', { phaseStart: 9 }, FALLBACK)).toEqual({
      start: 5106,
      dirs: 8,
      stride: 15,
      phaseStart: 9,
    });
    const walk = new Map([['walk', { name: 'walk', start: 1988, length: 96 }]]);
    expect(directionalAnimFromSeq(walk, 'walk', { frames: 1 }, FALLBACK)).toEqual({
      start: 1988,
      dirs: 8,
      stride: 12,
      frames: 1,
    });
  });

  it('falls back verbatim when the sequence is absent or zero-length (a partial/old manifest)', () => {
    const empty = new Map<string, { name: string; start: number; length: number }>();
    expect(directionalAnimFromSeq(empty, 'walk', {}, FALLBACK)).toBe(FALLBACK);
    const zero = new Map([['walk', { name: 'walk', start: 1988, length: 0 }]]);
    expect(directionalAnimFromSeq(zero, 'walk', {}, FALLBACK)).toBe(FALLBACK);
  });
});

describe('buildHumanBindings', () => {
  it('derives the settler walk/chop/carry anims from the decoded sequences', () => {
    const seqs = new Map([
      ['human_man_generic_walk', { name: 'human_man_generic_walk', start: 1988, length: 96 }],
      [
        'human_man_woodcutter_work_woodcutting',
        { name: 'human_man_woodcutter_work_woodcutting', start: 5106, length: 120 },
      ],
      ['human_man_generic_walk_wood', { name: 'human_man_generic_walk_wood', start: 4580, length: 96 }],
    ]);
    const bindings = buildHumanBindings(seqs);
    expect(bindings.settler).toEqual({
      idle: { start: 1988, dirs: 8, stride: 12, frames: 1 },
      moving: { start: 1988, dirs: 8, stride: 12 },
      byAtomic: { 24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 } },
      carrying: {
        idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
        moving: { start: 4580, dirs: 8, stride: 12 },
      },
    });
  });

  it('falls back to the transcribed house table when no buildingBobs map is supplied', () => {
    // An absent IR (a checkout without content/) → buildHumanBindings is called with no second arg →
    // the binding uses the committed VIKING_HOUSE01_BOBS constant (houses.ini [GfxHouse], LogicTribeType
    // 1, GfxPalette "house01"). Pins the fallback so a stale/typo'd constant is caught here, not by eye.
    expect(buildHumanBindings(new Map()).building).toEqual({
      byType: { 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('overlays a supplied buildingBobs map onto the constant — data wins per type, constant backs the rest', () => {
    // Live path: real data overrides per type (home 6 → a different bob) and adds growth-stage types
    // (2); the constant types the data does NOT cover (10/11/15) stay backed by VIKING_HOUSE01_BOBS, so
    // a partial IR degrades type-by-type instead of dropping the whole family to the generic box.
    expect(buildHumanBindings(new Map(), { 6: 999, 2: 1 }).building).toEqual({
      byType: { 6: 999, 10: 131, 11: 91, 12: 60, 15: 105, 2: 1 },
      default: 11,
    });
    // An empty map (the loaded atlas had no matching rows) degrades to exactly the transcribed constant.
    expect(buildHumanBindings(new Map(), {}).building).toEqual({
      byType: { 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('passes a layer-qualified ref (a named-family building) straight through the overlay', () => {
    // The HQ binds a { layer, bob } ref into the loaded viking4 family; it must survive the spread next
    // to the constant's bare ids so the renderer draws it from the family atlas (not the default layer).
    expect(
      buildHumanBindings(new Map(), { 1: { layer: 'ls_houses_viking4.house01', bob: 34 } }).building,
    ).toEqual({
      byType: { 1: { layer: 'ls_houses_viking4.house01', bob: 34 }, 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('falls back to the known-good ranges when the manifest is empty (fallback == data)', () => {
    // The committed FALLBACK_* ranges must equal what the real animations.ini yields, so a checkout
    // without content/ draws the same cycles as one with it. Asserting the empty-map result pins that.
    expect(buildHumanBindings(new Map()).settler).toEqual({
      idle: { start: 1988, dirs: 8, stride: 12, frames: 1 },
      moving: { start: 1988, dirs: 8, stride: 12 },
      byAtomic: { 24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 } },
      carrying: {
        idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
        moving: { start: 4580, dirs: 8, stride: 12 },
      },
    });
  });
});

describe('buildingBobRefsByType', () => {
  // The default building atlas family (the shared kindLayers.building layer) + the named families this
  // rung loads (only viking4/house01). A canonical row in the default family → a bare bob id; in a loaded
  // named family → a { layer, bob } ref; in any other (.bmd, palette) → dropped (the constant backs it).
  const DEFAULT_FAMILY = { bmdBasename: 'ls_houses_viking.bmd', paletteName: 'house01' };
  const FAMILIES = [
    { bmdBasename: 'ls_houses_viking4.bmd', paletteName: 'house01', layer: 'ls_houses_viking4.house01' },
  ];

  // A slice of the real content/ir.json buildingBobs lane (extractBuildingBobs over houses.ini): the
  // viking home growth chain is distinct typeIds 2..6 (one bob each), the well carries a duplicate
  // (lumped) row, the HQ (typeId 1) lives in the viking4 family with two editName variants, a viking2
  // row is in an UNLOADED family, and a frank row is another tribe.
  const rows = [
    { tribeId: 1, typeId: 2, level: 0, bmd: 'data/x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 1 },
    {
      tribeId: 1,
      typeId: 6,
      level: 4,
      bmd: 'data/x/ls_houses_viking.bmd',
      paletteName: 'house01',
      bobId: 41,
    },
    {
      tribeId: 1,
      typeId: 10,
      level: 0,
      bmd: 'data/x/ls_houses_viking.bmd',
      paletteName: 'house01',
      bobId: 131,
    },
    {
      tribeId: 1,
      typeId: 10,
      level: 0,
      bmd: 'data/x/ls_houses_viking.bmd',
      paletteName: 'house01',
      bobId: 131,
    },
    // hive + bakery — the other transcribed-constant default-family types, to pin byte-identity across all 5.
    {
      tribeId: 1,
      typeId: 11,
      level: 0,
      bmd: 'data/x/ls_houses_viking.bmd',
      paletteName: 'house01',
      bobId: 91,
    },
    {
      tribeId: 1,
      typeId: 15,
      level: 1,
      bmd: 'data/x/ls_houses_viking.bmd',
      paletteName: 'house01',
      bobId: 105,
    },
    // HQ (typeId 1) — viking4/house01, two editName variants; "viking headquarters" (bob 34) is canonical.
    {
      tribeId: 1,
      typeId: 1,
      level: 0,
      bmd: 'data/x/ls_houses_viking4.bmd',
      paletteName: 'house01',
      bobId: 34,
      editName: 'viking headquarters',
    },
    {
      tribeId: 1,
      typeId: 1,
      level: 0,
      bmd: 'data/x/ls_houses_viking4.bmd',
      paletteName: 'house01',
      bobId: 44,
      editName: 'viking headquarters house',
    },
    // also in viking4/house02 — excluded by palette preference
    {
      tribeId: 1,
      typeId: 1,
      level: 0,
      bmd: 'data/x/ls_houses_viking4.bmd',
      paletteName: 'house02',
      bobId: 34,
      editName: 'viking headquarters',
    },
    // viking2 family is NOT loaded this rung — dropped (the constant/default backs typeId 20)
    {
      tribeId: 1,
      typeId: 20,
      level: 0,
      bmd: 'data/x/ls_houses_viking2.bmd',
      paletteName: 'house01',
      bobId: 10,
    },
    // a frank house (other tribe) — filtered out
    {
      tribeId: 2,
      typeId: 6,
      level: 4,
      bmd: 'data/x/ls_houses_frank.bmd',
      paletteName: 'house01',
      bobId: 888,
    },
  ];

  it('emits bare ids for the default family and a layer-qualified ref for a loaded named family (HQ)', () => {
    expect(buildingBobRefsByType(rows, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({
      1: { layer: 'ls_houses_viking4.house01', bob: 34 },
      2: 1,
      6: 41,
      10: 131,
      11: 91,
      15: 105,
    });
  });

  it('drops a type whose family is loaded by neither the default nor a named family (constant backs it)', () => {
    // typeId 20 is the viking2 family (not loaded) → absent from the output, NOT a wrong bob drawn from
    // the default layer. With viking2 added to FAMILIES it would resolve to its layer ref instead.
    const out = buildingBobRefsByType(rows, 1, DEFAULT_FAMILY, FAMILIES);
    expect(out[20]).toBeUndefined();
    const withViking2 = [
      ...FAMILIES,
      { bmdBasename: 'ls_houses_viking2.bmd', paletteName: 'house01', layer: 'ls_houses_viking2.house01' },
    ];
    expect(buildingBobRefsByType(rows, 1, DEFAULT_FAMILY, withViking2)[20]).toEqual({
      layer: 'ls_houses_viking2.house01',
      bob: 10,
    });
  });

  it('filters by tribe (a frank row never lands in the viking table)', () => {
    expect(buildingBobRefsByType(rows, 1, DEFAULT_FAMILY, FAMILIES)[6]).toBe(41); // viking, not the frank 888
  });

  it('disambiguates a multi-bob typeId by canonical editName even over a lower bobId', () => {
    // Synthetic: the canonical "viking headquarters" carries the HIGHER bob — editName must win, proving
    // the pick is the named building and not just the lowest-bob tiebreak.
    const flipped = [
      {
        tribeId: 1,
        typeId: 1,
        level: 0,
        bmd: 'x/ls_houses_viking4.bmd',
        paletteName: 'house01',
        bobId: 7,
        editName: 'viking headquarters house',
      },
      {
        tribeId: 1,
        typeId: 1,
        level: 0,
        bmd: 'x/ls_houses_viking4.bmd',
        paletteName: 'house01',
        bobId: 9,
        editName: 'viking headquarters',
      },
    ];
    expect(buildingBobRefsByType(flipped, 1, DEFAULT_FAMILY, FAMILIES)[1]).toEqual({
      layer: 'ls_houses_viking4.house01',
      bob: 9,
    });
  });

  it('prefers the default palette when a typeId spans recolour skins', () => {
    const skins = [
      { tribeId: 1, typeId: 12, level: 0, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house02', bobId: 999 },
      { tribeId: 1, typeId: 12, level: 0, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 60 },
    ];
    expect(buildingBobRefsByType(skins, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 12: 60 });
  });

  it('picks the highest level then the lowest bobId, insertion-order-independent', () => {
    const multi = [
      { tribeId: 1, typeId: 6, level: 2, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 21 },
      { tribeId: 1, typeId: 6, level: 4, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 41 },
      { tribeId: 1, typeId: 6, level: 0, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 1 },
    ];
    expect(buildingBobRefsByType(multi, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 6: 41 });
    const tie = [
      { tribeId: 1, typeId: 7, level: 1, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 70 },
      { tribeId: 1, typeId: 7, level: 1, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 50 },
    ];
    expect(buildingBobRefsByType(tie, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 7: 50 });
    expect(buildingBobRefsByType([...tie].reverse(), 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 7: 50 });
  });

  it('anchors the bmd match to a path separator (no basename-concat false positive)', () => {
    const tricky = [
      {
        tribeId: 1,
        typeId: 1,
        level: 0,
        bmd: 'data/x/ls_houses_viking.bmd',
        paletteName: 'house01',
        bobId: 5,
      },
      // ends with the default basename string but NOT after a `/` — must NOT match the default family.
      {
        tribeId: 1,
        typeId: 2,
        level: 0,
        bmd: 'data/x/evil_ls_houses_viking.bmd',
        paletteName: 'house01',
        bobId: 9,
      },
    ];
    expect(buildingBobRefsByType(tricky, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 1: 5 });
  });

  it('returns {} when nothing matches the tribe (caller then uses the constant fallback)', () => {
    expect(buildingBobRefsByType(rows, 99, DEFAULT_FAMILY, FAMILIES)).toEqual({});
    expect(buildingBobRefsByType([], 1, DEFAULT_FAMILY, FAMILIES)).toEqual({});
  });

  // The PRODUCTION families list (the seven viking families loaded in loadHumanSpriteSheet). Drives the
  // reducer with the real BUILDING_FAMILIES so the rung's claim — "EVERY viking building draws its own
  // bob" — is pinned without a browser: each family's representative type routes to its OWN atlas layer,
  // including the two house02 families that close the set (stock / brewery / coin mint), and the default
  // stays a bare id. No viking [GfxHouse] type is dropped any more.
  describe('with the production BUILDING_FAMILIES (all seven viking families loaded)', () => {
    // One representative row per family, transcribed from content/ir.json's buildingBobs (LogicTribeType
    // 1). The (bmd, palette) PAIR is what each family entry matches on: the miller and house02 both share
    // ls_houses_viking.bmd with the default but recolour it `housemiller01` / `house02`.
    const real = [
      { tribeId: 1, typeId: 6, level: 4, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 41 }, // home → default
      {
        tribeId: 1,
        typeId: 13,
        level: 0,
        bmd: 'x/ls_houses_viking.bmd',
        paletteName: 'housemiller01',
        bobId: 70,
      }, // mill
      {
        tribeId: 1,
        typeId: 31,
        level: 0,
        bmd: 'x/ls_houses_viking2.bmd',
        paletteName: 'house01',
        bobId: 150,
      }, // smithy
      { tribeId: 1, typeId: 27, level: 0, bmd: 'x/ls_houses_viking3.bmd', paletteName: 'house01', bobId: 50 }, // armory
      {
        tribeId: 1,
        typeId: 1,
        level: 0,
        bmd: 'x/ls_houses_viking4.bmd',
        paletteName: 'house01',
        bobId: 34,
        editName: 'viking headquarters',
      }, // HQ
      {
        tribeId: 1,
        typeId: 37,
        level: 0,
        bmd: 'x/ls_houses_viking4.bmd',
        paletteName: 'housedruid01',
        bobId: 39,
      }, // temple
      { tribeId: 1, typeId: 7, level: 0, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house02', bobId: 53 }, // stock — house02 on ls_houses_viking.bmd
      {
        tribeId: 1,
        typeId: 16,
        level: 0,
        bmd: 'x/ls_houses_viking2.bmd',
        paletteName: 'house02',
        bobId: 220,
      }, // brewery — house02 on ls_houses_viking2.bmd
      {
        tribeId: 1,
        typeId: 33,
        level: 0,
        bmd: 'x/ls_houses_viking2.bmd',
        paletteName: 'house02',
        bobId: 170,
      }, // coin mint — house02 on ls_houses_viking2.bmd
    ];

    it('routes each viking type to its own loaded family layer (the rung is render-only, data already there)', () => {
      expect(buildingBobRefsByType(real, 1, DEFAULT_BUILDING_FAMILY, BUILDING_FAMILIES)).toEqual({
        6: 41, // default building layer — a bare id
        13: { layer: 'ls_houses_viking.housemiller01', bob: 70 },
        31: { layer: 'ls_houses_viking2.house01', bob: 150 },
        27: { layer: 'ls_houses_viking3.house01', bob: 50 },
        1: { layer: 'ls_houses_viking4.house01', bob: 34 },
        37: { layer: 'ls_houses_viking4.housedruid01', bob: 39 },
        // The two house02 families close the set — stock / brewery / coin mint now bind their own bob.
        7: { layer: 'ls_houses_viking.house02', bob: 53 },
        16: { layer: 'ls_houses_viking2.house02', bob: 220 },
        33: { layer: 'ls_houses_viking2.house02', bob: 170 },
      });
    });

    it('keeps the loaded set and the emittable set in lockstep (every family layer is fetchable)', () => {
      // Each family's `layer` is the served atlas stem loadHumanSpriteSheet fetches; a ref the reducer
      // emits must name one of these, else it would fall through to the default layer and draw a WRONG bob.
      const loadedLayers = new Set(BUILDING_FAMILIES.map((f) => f.layer));
      for (const ref of Object.values(
        buildingBobRefsByType(real, 1, DEFAULT_BUILDING_FAMILY, BUILDING_FAMILIES),
      )) {
        if (typeof ref !== 'number') expect(loadedLayers.has(ref.layer)).toBe(true);
      }
    });
  });
});
