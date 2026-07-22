/**
 * `[GfxHouse]` visual bindings: construction-stage layers, animated state overlays, the building
 * `(bmd, palette)` graphics binding, and the building-type → house-bob join. All share the body+palette
 * preamble ({@link readGfxHouseGraphicsRecord}) and the multi-house record split.
 */
import { BuildingBob, BuildingConstructionLayer, BuildingOverlay } from '@open-northland/data';
import { type NamedBmdPaletteBinding, readBmdPaletteBindings } from '../bindings/index.js';
import {
  findProps,
  getStr,
  makeSource,
  normalizePaletteName,
  type RuleSection,
  type SourceRef,
} from '../grammar.js';
import { forEachGfxHouseRecord } from './shared.js';

/**
 * Extracts the `[GfxHouse]` construction-stage layers (`GfxBobConstructionLayer <sizeIdx>
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
  forEachGfxHouseRecord(sections, (rec, record) => {
    const { tribeId, normalizedBmd, palettes, editName, typeByLevel } = record;
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
            source: makeSource(src, 'GfxHouse'),
          }),
        );
      }
    }
  });
  return layers;
}

/** The `GfxOverlay` type discriminator (2nd int) of the two-state animated overlays we decode — the
 *  mill rotor. The type-`3` rows have a different, not-yet-decoded field shape (6 fields, no frame
 *  list — static decal offsets) and are skipped rather than guessed. */
const ANIMATED_OVERLAY_TYPE = 4;
/** Leading ints of a type-4 `GfxOverlay` line before its frame list: `<sizeIdx> <type> <state> <x> <y> <step>`. */
const OVERLAY_HEADER_FIELDS = 6;

/**
 * Extracts the `[GfxHouse]` animated state overlays (`GfxOverlay <sizeIdx> 4 <state> <x> <y>
 * <step> <bobId…>`) — the extra sprite a building draws on top of its finished body, per state
 * ({@link BuildingOverlay} documents the field pinning and the one known user, the mill rotor). The
 * `(sizeIdx → typeId)` join, the `(bmd, palette)` atlas keying and the per-palette row fan-out all
 * mirror {@link extractConstructionLayers}. Only `ANIMATED_OVERLAY_TYPE` (4) rows are consumed; a
 * malformed or frame-less line is skipped, never thrown.
 */
export function extractBuildingOverlays(sections: readonly RuleSection[], src: SourceRef): BuildingOverlay[] {
  const overlays: BuildingOverlay[] = [];
  forEachGfxHouseRecord(sections, (rec, record) => {
    const { tribeId, normalizedBmd, palettes, editName, typeByLevel } = record;
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
            source: makeSource(src, 'GfxHouse'),
          }),
        );
      }
    }
  });
  return overlays;
}

/**
 * Extracts the `[GfxHouse]` records from the mod's readable `DataCnmd/budynki12/houses/houses.ini` (the
 * graphics twin of the logic `houses.ini`; golden rule #4) — the building graphics binding: every
 * settlement house (homes, wells, stocks/warehouses, workshops, walls, …) bound to its bob set + palette,
 * the `[GfxHouse]` analog of {@link import('../bindings/index.js').extractLandscapeGraphics}'s
 * `[GfxLandscape]` static decor. It shares the same {@link readBmdPaletteBindings} kernel + the
 * {@link NamedBmdPaletteBinding} shape, adding the record's `EditName` (a building handle, `"viking stock"`
 * vs `"viking home"`). The leg that makes the `ls_houses_*.bmd` sets
 * (viking/frank/egypt/saracen/byzantine/beduine) become atlases — without it a house `.bmd` is unpacked but
 * never coloured, so a building drew a placeholder box.
 *
 * Unlike a landscape record (one `GfxPalette`), a house record commonly carries several palette values on
 * one `GfxPalette` line — `GfxPalette "house01" "house02"` recolours the same `ls_houses_viking` body into
 * the home (`house01`) and the stock/warehouse (`house02`) skins — so this passes `multiPalette` to fan
 * each value into its own `(bmd, palette)` binding; the caller dedups identical pairs (the ~25 viking-home
 * records repeat one bob+palette pair).
 *
 * The keys are CamelCase like `[GfxLandscape]` (`GfxBobLibs`/`GfxPalette`/`EditName`). A record without a
 * body bob or without any palette is skipped, never thrown — this indexes hundreds of records and one
 * malformed entry must not abort the offline batch. `tribeId`/`jobId` are left undefined (no `logictribe`/
 * `logicjob` keys on a `[GfxHouse]` record): an atlas keys on `(bmd, palette)` only, so the per-tribe
 * `LogicTribeType` cross-ref does not affect the emitted bytes (the render-side per-building-type bob
 * selection is a later, separate leg).
 */
export function extractBuildingGraphics(sections: readonly RuleSection[]): NamedBmdPaletteBinding[] {
  const bindings: NamedBmdPaletteBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const editName = getStr(sec, 'EditName');
    for (const binding of readBmdPaletteBindings(sec, 'GfxBobLibs', 'GfxPalette', true)) {
      bindings.push({ ...binding, editName });
    }
  }
  return bindings;
}

/**
 * Extracts the `[GfxHouse]` building-type → house-bob join from the mod's readable
 * `DataCnmd/budynki12/houses/houses.ini` — the data-pinned twin of the renderer's hand-transcribed
 * per-type table (`real-sprites.ts` `VIKING_HOUSE01_BOBS`). {@link extractBuildingGraphics} reads the
 * same records but keeps only `(bmd, palette)` to emit each recolour atlas; this leg keeps the
 * `(typeId → bobId)` mapping those atlases are indexed by, so the render can draw each building its own
 * house bob from data instead of a transcribed constant (AGENTS.md "content is data, not code").
 *
 * Each house record (recovered by {@link splitGfxHouseRecords} — a `[GfxHouse]` bracket can hold many)
 * pairs two per-level tables by their leading level index — the `sizeIdx` pairing
 * {@link extractConstructionLayers} uses:
 *   - `LogicType <level> <typeId>` — the building `typeId` at that growth level (a home spans levels
 *     0..4 → five distinct typeIds), and
 *   - `GfxBobId <level> <bobId>` — the atlas bob id for that level.
 * For each level present in both tables we emit one {@link BuildingBob} per palette skin
 * (`GfxPalette "house01" "house02"` → two rows, the same bob in each recolour). The body `.bmd` is
 * `GfxBobLibs[0]`; `LogicTribeType` keys the row (the same logic `typeId` recurs per civilization).
 *
 * The join is multi-valued on `(tribeId, typeId, paletteName)`: a logic `typeId` legitimately maps to
 * several bobs — across build levels (a multi-stage wonder, a home's tiers) and across graphics variants
 * sharing one typeId (wall orientations "Mur h"/"Mur V", the HQ vs its "headquarters house", "semiramis"
 * vs "semiramis front"). So this is the faithful `(tribeId, typeId, level, bmd, paletteName) → bobId`
 * table, not a unique per-type lookup — a consumer disambiguates by `level` (build progress) and/or
 * `editName` (the variant). Only byte-identical rows are de-duplicated (a record the mod literally
 * duplicated, e.g. "frank ship small") — distinct levels/variants are all kept.
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
  forEachGfxHouseRecord(sections, (rec, record) => {
    const { tribeId, normalizedBmd, normalizedShadowBmd, palettes, editName, typeByLevel } = record;
    // Pair the two per-level tables by their leading level index. A typeId may recur at several
    // levels; each level keeps its own bob.
    const bobByLevel = new Map<number, number>();
    for (const p of findProps(rec, 'GfxBobId')) {
      const level = Number.parseInt(p.values[0] ?? '', 10);
      const bobId = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(level) || Number.isNaN(bobId)) continue;
      bobByLevel.set(level, bobId);
    }
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
            shadowBmd: normalizedShadowBmd,
            paletteName: pal,
            bobId,
            editName,
            source: makeSource(src, 'GfxHouse'),
          }),
        );
      }
    }
  });
  return bobs;
}
