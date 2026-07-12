/**
 * The `[GfxHouse]` graphics-table cluster: construction costs, hitpoints, footprints, construction layers, animated overlays, building bobs, and BMD/palette graphics bindings.
 */
import {
  BuildingBob,
  BuildingConstructionLayer,
  type BuildingFootprint,
  BuildingOverlay,
  BuildingType,
  type FootprintCell,
} from '@vinland/data';
import {
  findProp,
  findProps,
  getInt,
  getStr,
  normalizeAssetPath,
  normalizePaletteName,
  type RuleProp,
  type RuleSection,
  type SourceRef,
} from './grammar.js';
import type { BmdPaletteBinding } from './graphics-bindings.js';

/**
 * Extracts each building's **build-material cost** from the graphics table's `[GfxHouse]` records (the
 * readable `DataCnmd/budynki12/houses/houses.ini`), keyed by the building `typeId` for an overlay onto
 * the `[logichousetype]`-extracted {@link BuildingType}s ({@link extractBuildings} reads the *logic*
 * table; the construction cost lives only in the *graphics* twin — a separate file the pipeline did not
 * read until now). A `[GfxHouse]` record is a render record carrying a few `Logic*` keys, three of which
 * matter here:
 *   - `LogicTribeType <id>` — the owning tribe. The cost is genuinely keyed by **(tribe, typeId)**: the
 *     same logic `typeId` (homes 2..6 are shared across civilizations) carries a DIFFERENT cost per
 *     tribe — viking/frank/byzantine model a home as an *upgrade chain* (level 4 = `27 27`, ornaments
 *     only), while egypt/saracen model the same typeId as a *standalone full build* (the cumulative
 *     list). To keep a single flat {@link BuildingType.construction} field we collapse to the
 *     **lowest-tribeType** record (the deterministic "reference tribe" convention `fillBuildingRecipes`
 *     already uses); the per-tribe divergence is recorded in source basis.
 *   - `LogicType <sizeIdx> <typeId>` — the building `typeId` at that size level (a home spans several:
 *     `home level 00..04` are five distinct typeIds, one per `sizeIdx`), joined to the cost by `sizeIdx`.
 *   - `LogicConstructionGoods <sizeIdx> <good> <good> …` — the goods to build that level, a flat id
 *     list where a **repeat encodes quantity** (`3 3 26` = 2× stone + pillar), exactly like
 *     `goodtypes.productionInputGoods` ({@link extractProductionInputs}).
 * A level with a `LogicType` but no matching `LogicConstructionGoods` (the headquarters/wonder records)
 * is omitted — that building has no construction cost. Returns an empty map if the file carries no
 * `[GfxHouse]` records (e.g. the logic-only sources every other extractor reads).
 *
 * Two collisions are resolved DETERMINISTICALLY (the cost is genuinely multi-valued in the source):
 *   1. cross-tribe — the same `typeId` (homes 2..6, potteries, …) recurs per civilization with a
 *      different cost; the **lowest `LogicTribeType`** record wins (the "reference tribe" convention).
 *   2. within a record — a `typeId` can map to MORE THAN ONE `sizeIdx` (e.g. pottery `LogicType {1:21,
 *      2:21}`, and a multi-stage wonder repeats one typeId across rising sizes); the **lowest `sizeIdx`**
 *      cost wins (the base/first build stage). Both collapses are recorded as approximations in
 *      source basis — a fully-faithful model would key the cost by `(tribe, typeId, sizeIdx)`.
 */
/**
 * The `LogicType <sizeIdx> <typeId>` table of one `[GfxHouse]` section/sub-record — the size-level →
 * building-typeId join every graphics-table extractor pairs its per-level lines against
 * (construction costs, footprints, construction layers, building bobs). Malformed lines are skipped.
 */
function logicTypeByLevel(sec: RuleSection): Map<number, number> {
  const typeByLevel = new Map<number, number>();
  for (const p of findProps(sec, 'LogicType')) {
    const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
    const typeId = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(sizeIdx) || Number.isNaN(typeId)) continue;
    typeByLevel.set(sizeIdx, typeId);
  }
  return typeByLevel;
}

export function extractConstructionCosts(
  sections: readonly RuleSection[],
): Map<number, { goodType: number; amount: number }[]> {
  // typeId -> the winning record, ranked by (tribeType asc, sizeIdx asc) so the lowest-tribe / lowest-
  // size cost deterministically wins regardless of file/parse order (see JSDoc collisions 1 & 2).
  const winner = new Map<
    number,
    { tribeType: number; sizeIdx: number; cost: { goodType: number; amount: number }[] }
  >();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const tribeType = getInt(sec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
    // sizeIdx -> typeId. A typeId may appear at several sizeIdx; each (sizeIdx -> typeId) is kept so
    // the construction-goods loop below can pair each cost line to its level's typeId.
    const typeByLevel = logicTypeByLevel(sec);
    for (const p of findProps(sec, 'LogicConstructionGoods')) {
      const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
      if (Number.isNaN(sizeIdx)) continue;
      const typeId = typeByLevel.get(sizeIdx);
      if (typeId === undefined) continue;
      const existing = winner.get(typeId);
      // Lower tribeType wins; for the same tribe, lower sizeIdx wins (the base build stage).
      if (
        existing !== undefined &&
        (existing.tribeType < tribeType || (existing.tribeType === tribeType && existing.sizeIdx <= sizeIdx))
      ) {
        continue;
      }
      const counts = new Map<number, number>();
      for (const raw of p.values.slice(1)) {
        const id = Number.parseInt(raw, 10);
        if (Number.isNaN(id)) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      winner.set(typeId, {
        tribeType,
        sizeIdx,
        cost: [...counts].map(([goodType, amount]) => ({ goodType, amount })),
      });
    }
  }
  return new Map([...winner].map(([typeId, { cost }]) => [typeId, cost]));
}

/**
 * Extracts each building type's **max hitpoints** from the graphics table's `[GfxHouse]` records
 * (`DataCnmd/budynki12/houses/houses.ini`), keyed by `typeId` for the same overlay as
 * {@link extractConstructionCosts}. Each record carries a `logichitpoints <sizeIdx> <value>` line per
 * size level, joined to a `typeId` through the record's `LogicType <sizeIdx> <typeId>` table
 * ({@link logicTypeByLevel}) — so a home's level chain (typeIds 2..6) resolves each tier's own HP
 * (30000 / 40000 / 60000 / 70000 / 80000), a wall 100000, a small workplace ~25000. Collisions resolve
 * DETERMINISTICALLY exactly like the construction cost: the **lowest `LogicTribeType`** record wins
 * (the reference-tribe convention), and within a record the **lowest `sizeIdx`** wins. A level with a
 * `LogicType` but no `logichitpoints` is absent — that type carries no HP. Returns an empty map for a
 * source with no `[GfxHouse]` records.
 *
 * source-basis: the readable `logichitpoints` param (`houses.ini` `[GfxHouse]`) — faithful per-tier
 * HP; the single-value collapse across (tribe, sizeIdx) is the same named approximation the cost
 * overlay records.
 */
export function extractHouseHitpoints(sections: readonly RuleSection[]): Map<number, number> {
  // typeId -> the winning record, ranked by (tribeType asc, sizeIdx asc) so the choice is independent
  // of file/parse order (mirrors extractConstructionCosts' collision resolution).
  const winner = new Map<number, { tribeType: number; sizeIdx: number; hitpoints: number }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const tribeType = getInt(sec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
    const typeByLevel = logicTypeByLevel(sec);
    for (const p of findProps(sec, 'logichitpoints')) {
      const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
      const hitpoints = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(sizeIdx) || Number.isNaN(hitpoints) || hitpoints <= 0) continue;
      const typeId = typeByLevel.get(sizeIdx);
      if (typeId === undefined) continue;
      const existing = winner.get(typeId);
      // Lower tribeType wins; for the same tribe, lower sizeIdx wins (the base build stage).
      if (
        existing !== undefined &&
        (existing.tribeType < tribeType || (existing.tribeType === tribeType && existing.sizeIdx <= sizeIdx))
      ) {
        continue;
      }
      winner.set(typeId, { tribeType, sizeIdx, hitpoints });
    }
  }
  return new Map([...winner].map(([typeId, { hitpoints }]) => [typeId, hitpoints]));
}

/**
 * Expands one footprint-area source line (`<x> <y> <run>` after any leading level index) into its
 * cells: `run` cells starting at `(x, y)`, extending along +x — the row encoding every
 * `Logic*BlockArea` key uses. Non-numeric / non-positive runs yield no cells (malformed line).
 */
function expandAreaRun(x: number, y: number, run: number): FootprintCell[] {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(run) || run <= 0) return [];
  const cells: FootprintCell[] = [];
  for (let i = 0; i < run; i++) cells.push({ dx: x + i, dy: y });
  return cells;
}

/** Canonical footprint-cell order (ascending y, then x) + exact-duplicate removal, so the emitted IR
 *  is byte-stable regardless of source line order. */
function canonicalCells(cells: Iterable<FootprintCell>): FootprintCell[] {
  const byKey = new Map<string, FootprintCell>();
  for (const c of cells) byKey.set(`${c.dx},${c.dy}`, c);
  return [...byKey.values()].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
}

/**
 * Extracts each building type's **ground footprint** from the graphics table's `[GfxHouse]` records —
 * the collision/placement model the logic table never carried (the same graphics-table overlay as
 * {@link extractConstructionCosts}, keyed by the `LogicType <sizeIdx> <typeId>` join):
 *
 *   - `LogicWalkBlockArea <sizeIdx> <x> <y> <run>` — the cells the standing building at that size
 *     level makes unwalkable (its body) → `blocked` for that level's `typeId`.
 *   - `LogicBuildBlockArea <x> <y> <run>` — defined ONCE per record with **no level index**: the
 *     level-independent build-exclusion zone. Every level's typeId gets the same zone — which is
 *     exactly the original's "a level-0 hut reserves the space of its top level" behavior.
 *   - `LogicDoorPoint <sizeIdx> <x> <y>` — that level's entry cell → `door`.
 *
 * Emitted per typeId: `blocked` (this level), `familyBody` (the union of every level's `blocked` —
 * the largest body the upgrade chain reaches), and `reserved` (`familyBody` ∪ the build-exclusion
 * zone; the union matters because a few real records — walls' gate cells, two frank/byzantine houses
 * — have walk-block cells the build area does not cover). Cells are canonically ordered (ascending
 * y, then x) and de-duplicated so the IR is byte-stable.
 *
 * Collisions resolve exactly like {@link extractConstructionCosts}: cross-tribe, the **lowest
 * `LogicTribeType`** record wins (the reference-tribe convention — footprints genuinely differ per
 * tribe skin; source basis); within a record, the **lowest `sizeIdx`** wins for a typeId mapped
 * at several sizes. Returns an empty map for sources with no `[GfxHouse]` records.
 */
export function extractBuildingFootprints(sections: readonly RuleSection[]): Map<number, BuildingFootprint> {
  const winner = new Map<number, { tribeType: number; sizeIdx: number; footprint: BuildingFootprint }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeType = getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
      const typeByLevel = logicTypeByLevel(rec);
      if (typeByLevel.size === 0) continue;

      // The record-wide (level-independent) build-exclusion zone.
      const buildZone: FootprintCell[] = [];
      for (const p of findProps(rec, 'LogicBuildBlockArea')) {
        const [x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        buildZone.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
      }
      // Per-level walk-block bodies + door points.
      const blockedByLevel = new Map<number, FootprintCell[]>();
      for (const p of findProps(rec, 'LogicWalkBlockArea')) {
        const [sizeIdx, x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        if (sizeIdx === undefined || Number.isNaN(sizeIdx)) continue;
        const cells = blockedByLevel.get(sizeIdx) ?? [];
        cells.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
        blockedByLevel.set(sizeIdx, cells);
      }
      const doorByLevel = new Map<number, FootprintCell>();
      for (const p of findProps(rec, 'LogicDoorPoint')) {
        const [sizeIdx, x, y] = p.values.map((v) => Number.parseInt(v, 10));
        if (sizeIdx === undefined || Number.isNaN(sizeIdx)) continue;
        if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) continue;
        if (!doorByLevel.has(sizeIdx)) doorByLevel.set(sizeIdx, { dx: x, dy: y });
      }

      const familyBody = canonicalCells([...blockedByLevel.values()].flat());
      const reserved = canonicalCells([...familyBody, ...buildZone]);
      // A record with no collision CELLS at all (the vehicle/cart records; a record whose only area
      // lines are malformed) contributes nothing — an all-empty footprint would look footprinted yet
      // validate every placement. Gate on the expanded cells, not on the raw line/level count.
      if (reserved.length === 0) continue;

      for (const [sizeIdx, typeId] of typeByLevel) {
        const existing = winner.get(typeId);
        // Lower tribeType wins; for the same tribe, lower sizeIdx wins (the base build stage).
        if (
          existing !== undefined &&
          (existing.tribeType < tribeType ||
            (existing.tribeType === tribeType && existing.sizeIdx <= sizeIdx))
        ) {
          continue;
        }
        winner.set(typeId, {
          tribeType,
          sizeIdx,
          footprint: {
            blocked: canonicalCells(blockedByLevel.get(sizeIdx) ?? []),
            familyBody,
            reserved,
            door: doorByLevel.get(sizeIdx),
          },
        });
      }
    }
  }
  return new Map([...winner].map(([typeId, { footprint }]) => [typeId, footprint]));
}

/**
 * Extracts the `[GfxHouse]` **construction-stage layers** (`GfxBobConstructionLayer <sizeIdx>
 * <upgrade> <bobId> <shadowBobId|-1> <fromPct> <toPct>`) — which atlas bobs an under-construction
 * building draws at a given build progress ({@link BuildingConstructionLayer} documents the range/
 * stacking semantics). The `(sizeIdx → typeId)` join, the `(bmd, palette)` atlas keying, and the
 * per-palette row fan-out all mirror {@link extractBuildingBobs} (the finished-body binding these
 * layers extend); `stackIdx` preserves the record's file order per `(typeId, palette)` — the draw
 * stacking order. A malformed line (non-numeric fields) is skipped, never thrown.
 */
export function extractConstructionLayers(
  sections: readonly RuleSection[],
  src: SourceRef,
): BuildingConstructionLayer[] {
  const layers: BuildingConstructionLayer[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeId = getInt(rec, 'LogicTribeType');
      if (tribeId === undefined) continue;
      const bmd = findProp(rec, 'GfxBobLibs')?.values[0];
      if (bmd === undefined || bmd.trim() === '') continue;
      const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
      if (palettes.length === 0) continue;
      const editName = getStr(rec, 'EditName');
      const typeByLevel = logicTypeByLevel(rec);
      const normalizedBmd = normalizeAssetPath(bmd);
      // File order per level — the stacking order at draw time (the finished body is listed so the
      // active-layer stack keeps it on top at high progress).
      const stackByLevel = new Map<number, number>();
      for (const p of findProps(rec, 'GfxBobConstructionLayer')) {
        const [level, upgrade, bobId, shadowBobId, fromPct, toPct] = p.values.map((v) =>
          Number.parseInt(v, 10),
        );
        if (
          level === undefined ||
          upgrade === undefined ||
          bobId === undefined ||
          shadowBobId === undefined ||
          fromPct === undefined ||
          toPct === undefined ||
          [level, upgrade, bobId, shadowBobId, fromPct, toPct].some((n) => Number.isNaN(n))
        ) {
          continue;
        }
        const typeId = typeByLevel.get(level);
        if (typeId === undefined) continue;
        const stackIdx = stackByLevel.get(level) ?? 0;
        stackByLevel.set(level, stackIdx + 1);
        for (const paletteName of palettes) {
          layers.push(
            BuildingConstructionLayer.parse({
              tribeId,
              typeId,
              level,
              upgrade: upgrade !== 0,
              stackIdx,
              bmd: normalizedBmd,
              paletteName: normalizePaletteName(paletteName),
              bobId,
              shadowBobId: shadowBobId >= 0 ? shadowBobId : undefined,
              fromPct: Math.max(0, Math.min(100, fromPct)),
              toPct: Math.max(0, Math.min(100, toPct)),
              editName,
              source: { file: src.file, block: 'GfxHouse', layer: src.layer ?? 'base' },
            }),
          );
        }
      }
    }
  }
  return layers;
}

/** The `GfxOverlay` type discriminator (2nd int) of the two-state ANIMATED overlays we decode — the
 *  mill rotor. The type-`3` rows have a different, not-yet-decoded field shape (6 fields, no frame
 *  list — static decal offsets) and are skipped rather than guessed. */
const ANIMATED_OVERLAY_TYPE = 4;
/** Leading ints of a type-4 `GfxOverlay` line before its frame list: `<sizeIdx> <type> <state> <x> <y> <step>`. */
const OVERLAY_HEADER_FIELDS = 6;

/**
 * Extracts the `[GfxHouse]` **animated state overlays** (`GfxOverlay <sizeIdx> 4 <state> <x> <y>
 * <step> <bobId…>`) — the extra sprite a building draws ON TOP of its finished body, per state
 * ({@link BuildingOverlay} documents the field pinning and the one known user, the mill rotor). The
 * `(sizeIdx → typeId)` join, the `(bmd, palette)` atlas keying and the per-palette row fan-out all
 * mirror {@link extractConstructionLayers}. Only `ANIMATED_OVERLAY_TYPE` (4) rows are consumed; a
 * malformed or frame-less line is skipped, never thrown.
 */
export function extractBuildingOverlays(sections: readonly RuleSection[], src: SourceRef): BuildingOverlay[] {
  const overlays: BuildingOverlay[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeId = getInt(rec, 'LogicTribeType');
      if (tribeId === undefined) continue;
      const bmd = findProp(rec, 'GfxBobLibs')?.values[0];
      if (bmd === undefined || bmd.trim() === '') continue;
      const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
      if (palettes.length === 0) continue;
      const editName = getStr(rec, 'EditName');
      const typeByLevel = logicTypeByLevel(rec);
      const normalizedBmd = normalizeAssetPath(bmd);
      for (const p of findProps(rec, 'GfxOverlay')) {
        const ints = p.values.map((v) => Number.parseInt(v, 10));
        const [level, overlayType, state, x, y, step] = ints;
        if (
          level === undefined ||
          overlayType !== ANIMATED_OVERLAY_TYPE ||
          state === undefined ||
          x === undefined ||
          y === undefined ||
          step === undefined ||
          ints.slice(0, OVERLAY_HEADER_FIELDS).some((n) => Number.isNaN(n))
        ) {
          continue;
        }
        const frames = ints.slice(OVERLAY_HEADER_FIELDS);
        if (frames.length === 0 || frames.some((n) => Number.isNaN(n) || n < 0)) continue;
        const typeId = typeByLevel.get(level);
        if (typeId === undefined) continue;
        for (const paletteName of palettes) {
          overlays.push(
            BuildingOverlay.parse({
              tribeId,
              typeId,
              level,
              state,
              x,
              y,
              step,
              frames,
              bmd: normalizedBmd,
              paletteName: normalizePaletteName(paletteName),
              editName,
              source: { file: src.file, block: 'GfxHouse', layer: src.layer ?? 'base' },
            }),
          );
        }
      }
    }
  }
  return overlays;
}

/**
 * One building graphics binding: a {@link BmdPaletteBinding} (`.bmd` body + shadow + palette editname)
 * plus the record's `EditName`. The same shape as {@link LandscapeGraphicsBinding} — a building is just
 * the `[GfxHouse]` analog of the `[GfxLandscape]` static-decor binding — so it flows through the exact
 * same {@link import('../stages/bmd.js').convertBmdTree} `(bmd, palette)` atlas path with no second copy
 * of the conversion logic. The name is provenance + a building handle (`"viking stock"` vs `"viking
 * home"`) so a render binding can pick a house by it without re-reading the `.ini`.
 */
export interface BuildingGraphicsBinding extends BmdPaletteBinding {
  /** The record's `EditName` (e.g. `"viking stock"`), or undefined when the record omits it. */
  readonly editName: string | undefined;
}

/**
 * Extracts the `[GfxHouse]` records from the mod's readable `DataCnmd/budynki12/houses/houses.ini` (the
 * graphics twin of the logic `houses.ini`; golden rule #4) — the **building** graphics binding: every
 * settlement house (homes, wells, stocks/warehouses, workshops, walls, …) bound to its bob set + palette,
 * the exact `[GfxHouse]` analog of {@link extractLandscapeGraphics}'s `[GfxLandscape]` static decor. This
 * is the leg that makes the `ls_houses_*.bmd` sets (viking/frank/egypt/saracen/byzantine/beduine) become
 * atlases — without it a house `.bmd` is unpacked but never coloured, so a building drew a placeholder box
 * (the gap that left the warehouse with no sprite). Each record names a body + shadow bob set
 * (`GfxBobLibs "<body>.bmd" "<shadow>.bmd"`) and one-or-more palette editnames.
 *
 * Unlike a landscape record (one `GfxPalette`), a house record commonly carries **several** palette
 * values on one `GfxPalette` line — `GfxPalette "house01" "house02"` recolours the same `ls_houses_viking`
 * body into the home (`house01`) and the stock/warehouse (`house02`) skins. Each value is emitted as its
 * own `(bmd, palette)` binding so *every* recolour becomes an atlas (the warehouse needs `house02`); the
 * caller dedups identical `(bmd, palette)` pairs (the ~25 viking-home records repeat one bob+palette pair).
 *
 * The keys are CamelCase like `[GfxLandscape]` (`GfxBobLibs`/`GfxPalette`/`EditName`). A record without a
 * body bob or without any palette is skipped, never thrown — this indexes hundreds of records and one
 * malformed entry must not abort the offline batch. `tribeId`/`jobId` are left undefined: an atlas keys on
 * `(bmd, palette)` only, so the per-tribe `LogicTribeType` cross-ref does not affect the emitted bytes
 * (the render-side per-building-type bob selection is a later, separate leg).
 */
export function extractBuildingGraphics(sections: readonly RuleSection[]): BuildingGraphicsBinding[] {
  const bindings: BuildingGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteValues = (findProp(sec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
    if (paletteValues.length === 0) continue;
    const shadow = libs?.values[1];
    const editName = getStr(sec, 'EditName');
    for (const paletteName of paletteValues) {
      bindings.push({
        bmd: normalizeAssetPath(bmd),
        shadowBmd: shadow !== undefined && shadow.trim() !== '' ? normalizeAssetPath(shadow) : undefined,
        paletteName: normalizePaletteName(paletteName),
        tribeId: undefined,
        jobId: undefined,
        editName,
      });
    }
  }
  return bindings;
}

/**
 * Splits one `[GfxHouse]` section into its constituent house records. The mod packs SEVERAL houses
 * under a SINGLE `[GfxHouse]` bracket — five blocks lump 4..24 houses (the saracen + egypt families) —
 * each sub-house delimited only by a fresh `EditName` line, NOT a new bracket. `parseIniSections` opens
 * a section only on a `[...]` header, so it lumps the block into one {@link RuleSection}; without this
 * split the first sub-house's `GfxBobLibs`/`GfxPalette` would be stapled to last-wins `LogicType`/
 * `GfxBobId` across the whole block (dropping/mis-joining 63 of the 234 building types). Walking the
 * props in file order and starting a new record at each `EditName` recovers each house with its OWN
 * `GfxBobLibs`/`GfxPalette`/`LogicTribeType`/`LogicType`/`GfxBobId` block. Props before the first
 * `EditName` (none in the real file) are ignored; a single-house section yields one record.
 *
 * NOTE: {@link extractConstructionCosts} and {@link extractBuildingGraphics} read the same sections
 * with the SAME pre-existing lumping bug (so saracen/egypt costs + atlases are likewise incomplete) —
 * a flagged follow-up (source basis); this helper exists to be reused when that lands.
 */
function splitGfxHouseRecords(sec: RuleSection): RuleSection[] {
  const records: RuleSection[] = [];
  let props: RuleProp[] | undefined;
  for (const p of sec.props) {
    if (p.key === 'EditName') {
      props = [p];
      records.push({ name: sec.name, props });
    } else if (props !== undefined) {
      props.push(p);
    }
  }
  return records;
}

/**
 * Extracts the `[GfxHouse]` **building-type → house-bob** join from the mod's readable
 * `DataCnmd/budynki12/houses/houses.ini` — the data-pinned twin of the renderer's hand-transcribed
 * per-type table (`real-sprites.ts` `VIKING_HOUSE01_BOBS`). {@link extractBuildingGraphics} reads the
 * SAME records but keeps only `(bmd, palette)` to emit each recolour atlas; this leg keeps the
 * `(typeId → bobId)` mapping those atlases are indexed by, so the render can draw each building its own
 * house bob from data instead of a transcribed constant (AGENTS.md "content is data, not code").
 *
 * Each house record (recovered by {@link splitGfxHouseRecords} — a `[GfxHouse]` bracket can hold many)
 * pairs two per-level tables by their leading **level index** — exactly the `sizeIdx` pairing
 * {@link extractConstructionCosts} uses for `LogicConstructionGoods`:
 *   - `LogicType <level> <typeId>` — the building `typeId` at that growth level (a home spans levels
 *     0..4 → five distinct typeIds), and
 *   - `GfxBobId <level> <bobId>` — the atlas bob id for that level.
 * For each level present in BOTH tables we emit one {@link BuildingBob} per palette skin
 * (`GfxPalette "house01" "house02"` → two rows, the same bob in each recolour). The body `.bmd` is
 * `GfxBobLibs[0]`; `LogicTribeType` keys the row (the same logic `typeId` recurs per civilization).
 *
 * The join is intentionally **multi-valued** on `(tribeId, typeId, paletteName)`: a logic `typeId`
 * legitimately maps to several bobs — across **build levels** (a multi-stage wonder, a home's tiers)
 * AND across **graphics variants** sharing one typeId (wall orientations "Mur h"/"Mur V", the HQ vs
 * its "headquarters house", "semiramis" vs "semiramis front"). So this is the faithful `(tribeId,
 * typeId, level, bmd, paletteName) → bobId` table, NOT a unique per-type lookup — a consumer
 * disambiguates by `level` (build progress) and/or `editName` (the variant). Only **byte-identical**
 * rows are de-duplicated (a record the mod literally duplicated, e.g. "frank ship small") — distinct
 * levels/variants are all kept.
 *
 * A record missing a body `.bmd`, any palette, or a `LogicTribeType` is skipped (so one malformed
 * entry never aborts the offline batch over hundreds of records); a level with a `LogicType` but no
 * matching `GfxBobId` (a free/placeholder stage) is omitted. The `BuildingBob.parse` schema validates
 * the ids (`nonnegative`) — the real file carries no negative id, so this does not throw in practice.
 * Returns an empty array for sources with no `[GfxHouse]` records (the logic-only tables).
 */
export function extractBuildingBobs(sections: readonly RuleSection[], src: SourceRef): BuildingBob[] {
  const bobs: BuildingBob[] = [];
  // Drop only byte-identical rows (a literally-duplicated source record); genuine level/variant rows
  // (differing level, bobId, or editName) are all kept — the join is multi-valued by design.
  const seen = new Set<string>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeId = getInt(rec, 'LogicTribeType');
      if (tribeId === undefined) continue;
      const bmd = findProp(rec, 'GfxBobLibs')?.values[0];
      if (bmd === undefined || bmd.trim() === '') continue;
      const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
      if (palettes.length === 0) continue;
      const editName = getStr(rec, 'EditName');
      // Pair the two per-level tables by their leading level index (the same join
      // `extractConstructionCosts` does for cost lines). A typeId may recur at several levels; each
      // level keeps its own bob.
      const typeByLevel = logicTypeByLevel(rec);
      const bobByLevel = new Map<number, number>();
      for (const p of findProps(rec, 'GfxBobId')) {
        const level = Number.parseInt(p.values[0] ?? '', 10);
        const bobId = Number.parseInt(p.values[1] ?? '', 10);
        if (Number.isNaN(level) || Number.isNaN(bobId)) continue;
        bobByLevel.set(level, bobId);
      }
      const normalizedBmd = normalizeAssetPath(bmd);
      for (const [level, typeId] of typeByLevel) {
        const bobId = bobByLevel.get(level);
        if (bobId === undefined) continue;
        for (const paletteName of palettes) {
          const pal = normalizePaletteName(paletteName);
          const key = `${tribeId}|${typeId}|${level}|${normalizedBmd}|${pal}|${bobId}|${editName ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bobs.push(
            BuildingBob.parse({
              tribeId,
              typeId,
              level,
              bmd: normalizedBmd,
              paletteName: pal,
              bobId,
              editName,
              source: { file: src.file, block: 'GfxHouse', layer: src.layer ?? 'base' },
            }),
          );
        }
      }
    }
  }
  return bobs;
}
