import { describe, expect, it } from 'vitest';
import {
  BUILDING_FAMILIES,
  buildingBobRefsByType,
  buildingOverlayRefsByType,
  constructionRefsByType,
  DEFAULT_BUILDING_FAMILY,
  OVERLAY_TICKS_PER_FRAME,
} from '../src/content/building-gfx/index.js';
import type { BuildingBobRow } from '../src/content/ir/rows.js';

/**
 * The building render bindings: the `[GfxHouse]` LogicType→GfxBobId join (buildingBobRefsByType), the
 * construction-stage stack (constructionRefsByType) and the animated type-4 overlay (buildingOverlayRefsByType),
 * each reduced under the same per-tribe / loaded-family rules. Pure reducers over slices of the real
 * content/ir.json lanes, proved without a browser.
 */

/** The default building atlas family (the shared kindLayers.building layer) shared by every reducer test. */
const DEFAULT_FAMILY = { bmdBasename: 'ls_houses_viking.bmd', paletteName: 'house01' };

/** The `.bmd` of the default family — a row's home unless it overrides it with another family's. */
const DEFAULT_BMD = 'data/x/ls_houses_viking.bmd';

/**
 * One `buildingBobs` row: the (typeId, bobId) pair a case varies, over the default viking/house01 family.
 * A case that turns on another field (a family's `.bmd`, a recolour `paletteName`, a growth `level`, the
 * canonical `editName`, another `tribeId`) overrides just that one.
 */
function bobRow(typeId: number, bobId: number, over: Partial<BuildingBobRow> = {}): BuildingBobRow {
  return { tribeId: 1, typeId, level: 0, bmd: DEFAULT_BMD, paletteName: 'house01', bobId, ...over };
}

/** The named families the reducer rungs load (only viking4/house01). A canonical row in the default family
 *  → a bare bob id; in a loaded named family → a { layer, bob } ref; in any other (.bmd, palette) →
 *  dropped (the constant backs it). */
const FAMILIES = [
  { bmdBasename: 'ls_houses_viking4.bmd', paletteName: 'house01', layer: 'ls_houses_viking4.house01' },
];

const VIKING2_BMD = 'data/x/ls_houses_viking2.bmd';
const VIKING4_BMD = 'data/x/ls_houses_viking4.bmd';

describe('buildingBobRefsByType', () => {
  // A slice of the real content/ir.json buildingBobs lane (extractBuildingBobs over houses.ini): the
  // viking home growth chain is distinct typeIds 2..6 (one bob each), the well carries a duplicate
  // (lumped) row, the HQ (typeId 1) lives in the viking4 family with two editName variants, a viking2
  // row is in an UNLOADED family, and a frank row is another tribe.
  const rows = [
    bobRow(2, 1),
    bobRow(6, 41, { level: 4 }),
    bobRow(10, 131),
    bobRow(10, 131),
    // hive + bakery — the other transcribed-constant default-family types, to pin byte-identity across all 5.
    bobRow(11, 91),
    bobRow(15, 105, { level: 1 }),
    // HQ (typeId 1) — viking4/house01, two editName variants; "viking headquarters" (bob 34) is canonical.
    bobRow(1, 34, { bmd: VIKING4_BMD, editName: 'viking headquarters' }),
    bobRow(1, 44, { bmd: VIKING4_BMD, editName: 'viking headquarters house' }),
    // also in viking4/house02 — excluded by palette preference
    bobRow(1, 34, { bmd: VIKING4_BMD, paletteName: 'house02', editName: 'viking headquarters' }),
    // viking2 family is NOT loaded this rung — dropped (the constant/default backs typeId 20)
    bobRow(20, 10, { bmd: VIKING2_BMD }),
    // a frank house (other tribe) — filtered out
    bobRow(6, 888, { tribeId: 2, level: 4, bmd: 'data/x/ls_houses_frank.bmd' }),
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
      bobRow(1, 7, { bmd: VIKING4_BMD, editName: 'viking headquarters house' }),
      bobRow(1, 9, { bmd: VIKING4_BMD, editName: 'viking headquarters' }),
    ];
    expect(buildingBobRefsByType(flipped, 1, DEFAULT_FAMILY, FAMILIES)[1]).toEqual({
      layer: 'ls_houses_viking4.house01',
      bob: 9,
    });
  });

  it('prefers the default palette when a typeId spans recolour skins', () => {
    const skins = [bobRow(12, 999, { paletteName: 'house02' }), bobRow(12, 60)];
    expect(buildingBobRefsByType(skins, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 12: 60 });
  });

  it('picks the highest level then the lowest bobId, insertion-order-independent', () => {
    const multi = [bobRow(6, 21, { level: 2 }), bobRow(6, 41, { level: 4 }), bobRow(6, 1, { level: 0 })];
    expect(buildingBobRefsByType(multi, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 6: 41 });
    const tie = [bobRow(7, 70, { level: 1 }), bobRow(7, 50, { level: 1 })];
    expect(buildingBobRefsByType(tie, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 7: 50 });
    expect(buildingBobRefsByType([...tie].reverse(), 1, DEFAULT_FAMILY, FAMILIES)).toEqual({ 7: 50 });
  });

  it('anchors the bmd match to a path separator (no basename-concat false positive)', () => {
    const tricky = [
      bobRow(1, 5),
      // ends with the default basename string but NOT after a `/` — must NOT match the default family.
      bobRow(2, 9, { bmd: 'data/x/evil_ls_houses_viking.bmd' }),
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
      bobRow(6, 41, { level: 4 }), // home → default
      bobRow(13, 70, { paletteName: 'housemiller01' }), // mill
      bobRow(31, 150, { bmd: VIKING2_BMD }), // smithy
      bobRow(27, 50, { bmd: 'data/x/ls_houses_viking3.bmd' }), // armory
      bobRow(1, 34, { bmd: VIKING4_BMD, editName: 'viking headquarters' }), // HQ
      bobRow(37, 39, { bmd: VIKING4_BMD, paletteName: 'housedruid01' }), // temple
      bobRow(7, 53, { paletteName: 'house02' }), // stock — house02 on ls_houses_viking.bmd
      bobRow(16, 220, { bmd: VIKING2_BMD, paletteName: 'house02' }), // brewery — house02 on ls_houses_viking2.bmd
      bobRow(33, 170, { bmd: VIKING2_BMD, paletteName: 'house02' }), // coin mint — house02 on ls_houses_viking2.bmd
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

describe('constructionRefsByType', () => {
  const row = (over: Record<string, unknown>) => ({
    tribeId: 1,
    typeId: 2,
    level: 0,
    upgrade: false,
    stackIdx: 0,
    bmd: 'data/x/ls_houses_viking.bmd',
    paletteName: 'house01',
    bobId: 100,
    fromPct: 0,
    toPct: 100,
    editName: 'viking hut',
    ...over,
  });

  it('keeps a type’s from-scratch stages in stacking order, dropping the upgrade-overlay rows', () => {
    const rows = [
      row({ stackIdx: 2, bobId: 1, fromPct: 20 }),
      row({ stackIdx: 0, bobId: 3, fromPct: 10, toPct: 70 }),
      row({ stackIdx: 3, bobId: 11, upgrade: true }), // the `1` row — not a from-scratch stage
      row({ stackIdx: 1, bobId: 2, toPct: 50 }),
    ];
    expect(constructionRefsByType(rows, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({
      2: [
        { bob: 3, fromPct: 10, toPct: 70 },
        { bob: 2, fromPct: 0, toPct: 50 },
        { bob: 1, fromPct: 20, toPct: 100 },
      ],
    });
  });

  it('layer-qualifies a stage in a loaded named family and prefers the default palette', () => {
    const rows = [
      row({ bmd: 'data/x/ls_houses_viking4.bmd', bobId: 34 }),
      row({ paletteName: 'house02', bobId: 999 }), // the other skin — ignored while house01 rows exist
    ];
    expect(constructionRefsByType(rows, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({
      2: [{ layer: 'ls_houses_viking4.house01', bob: 34, fromPct: 0, toPct: 100 }],
    });
  });

  it('omits a type with a stage in an UNLOADED family (never a partial stack) and other tribes', () => {
    const rows = [
      row({ bobId: 1 }),
      row({ stackIdx: 1, bmd: 'data/x/ls_houses_viking9.bmd', bobId: 2 }), // unloaded family
      row({ typeId: 7, tribeId: 2, bobId: 50 }), // another tribe
    ];
    expect(constructionRefsByType(rows, 1, DEFAULT_FAMILY, FAMILIES)).toEqual({});
  });

  it('never interleaves two records sharing one typeId — one (editName, level) group wins', () => {
    // The real-data shapes: the HQ's two editName variants at level 0, and a pottery-style typeId
    // mapped at two levels within one record. Each stack must come from ONE record-level group.
    const variants = [
      row({ editName: 'viking headquarters house', bobId: 46, stackIdx: 0 }),
      row({ editName: 'viking headquarters', bobId: 36, stackIdx: 0 }),
      row({ editName: 'viking headquarters house', bobId: 44, stackIdx: 1 }),
      row({ editName: 'viking headquarters', bobId: 34, stackIdx: 1 }),
    ];
    // Lowest level ties → lexicographically smaller editName ('viking headquarters') wins whole.
    expect(constructionRefsByType(variants, 1, DEFAULT_FAMILY, FAMILIES)[2]?.map((l) => l.bob)).toEqual([
      36, 34,
    ]);
    const twoLevels = [
      row({ level: 2, bobId: 9, stackIdx: 0 }),
      row({ level: 1, bobId: 5, stackIdx: 0 }),
      row({ level: 1, bobId: 6, stackIdx: 1 }),
    ];
    // The lowest level (the base build stage) wins; level 2's stage is not mixed in.
    expect(constructionRefsByType(twoLevels, 1, DEFAULT_FAMILY, FAMILIES)[2]?.map((l) => l.bob)).toEqual([
      5, 6,
    ]);
  });
});

describe('buildingOverlayRefsByType — the type-4 GfxOverlay join (the mill rotor)', () => {
  const MILLER_LAYER = 'ls_houses_viking.housemiller01';
  // The mill's own recolour family — not the shared viking4 FAMILIES the other rungs load.
  const MILLER_FAMILIES = [
    { bmdBasename: 'ls_houses_viking.bmd', paletteName: 'housemiller01', layer: MILLER_LAYER },
  ];
  const row = (over: Record<string, unknown>) => ({
    tribeId: 1,
    typeId: 13,
    level: 0,
    state: 0,
    x: 0,
    y: 0,
    step: 1,
    frames: [76],
    bmd: 'data/x/ls_houses_viking.bmd',
    paletteName: 'housemiller01',
    editName: 'viking mill',
    ...over,
  });
  // The real viking mill rows: state 0 = the still blade, state 1 = the 13-frame spin cycle.
  const SPIN = [85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 88, 87, 86];
  const millRows = [row({}), row({ state: 1, frames: SPIN })];

  it('joins the idle + working state rows of one type into a layer-qualified overlay ref', () => {
    expect(buildingOverlayRefsByType(millRows, 1, DEFAULT_FAMILY, MILLER_FAMILIES)).toEqual({
      13: { layer: MILLER_LAYER, idle: 76, working: SPIN, ticksPerFrame: OVERLAY_TICKS_PER_FRAME },
    });
  });

  it('binds the mill overlay through the REAL loaded family list (the housemiller01 skin)', () => {
    const out = buildingOverlayRefsByType(millRows, 1, DEFAULT_BUILDING_FAMILY, BUILDING_FAMILIES);
    expect(out[13]).toMatchObject({ layer: MILLER_LAYER, idle: 76, working: SPIN });
  });

  it('drops other tribes, an unloaded family, and picks the lowest level group', () => {
    const rows = [
      ...millRows,
      row({ tribeId: 3, frames: [999] }), // byzantine — another tribe
      row({ typeId: 20, bmd: 'data/x/ls_houses_viking9.bmd' }), // unloaded family → dropped
      row({ level: 1, frames: [111] }), // a higher size level — the level-0 group wins
    ];
    const out = buildingOverlayRefsByType(rows, 1, DEFAULT_FAMILY, MILLER_FAMILIES);
    expect(Object.keys(out)).toEqual(['13']);
    expect(out[13]?.idle).toBe(76);
  });
});
