/**
 * `[GfxHouse]` visual bindings from the mod's readable `DataCnmd/budynki12/houses/houses.ini`, the
 * graphics twin of the logic house table. A malformed record or line is skipped, never thrown.
 */
import {
  BuildingBob,
  BuildingConstructionLayer,
  BuildingFlagPoint,
  BuildingOverlay,
} from '@open-northland/data';
import { type NamedBmdPaletteBinding, readBmdPaletteBindings } from '../bindings/index.js';
import {
  findProps,
  getStr,
  makeSource,
  normalizePaletteName,
  type RuleSection,
  type SourceRef,
} from '../grammar.js';
import { gfxHouseGraphicsRecords, gfxHouseRecords } from './shared.js';

/**
 * Extracts the construction-stage layers, `GfxBobConstructionLayer <sizeIdx> <upgrade> <bobId>
 * <shadowBobId|-1> <fromPct> <toPct>`, one row per palette skin.
 */
export function extractConstructionLayers(
  sections: readonly RuleSection[],
  src: SourceRef,
): BuildingConstructionLayer[] {
  const layers: BuildingConstructionLayer[] = [];
  for (const record of gfxHouseGraphicsRecords(sections)) {
    const { rec, tribeId, normalizedBmd, palettes, editName, typeByLevel } = record;
    // Source file order per level, which is the draw stacking order.
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
  }
  return layers;
}

/** The `GfxOverlay` type discriminator (2nd int) of the two-state animated overlays. */
const ANIMATED_OVERLAY_TYPE = 4;
/** Leading ints of a type-4 `GfxOverlay` line before its frame list: `<sizeIdx> <type> <state> <x> <y> <step>`. */
const OVERLAY_HEADER_FIELDS = 6;

/**
 * Extracts the animated state overlays, `GfxOverlay <sizeIdx> 4 <state> <x> <y> <step> <bobId…>`, one
 * row per palette skin. Only `ANIMATED_OVERLAY_TYPE` rows are consumed.
 */
export function extractBuildingOverlays(sections: readonly RuleSection[], src: SourceRef): BuildingOverlay[] {
  const overlays: BuildingOverlay[] = [];
  for (const record of gfxHouseGraphicsRecords(sections)) {
    const { rec, tribeId, normalizedBmd, palettes, editName, typeByLevel } = record;
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
  }
  return overlays;
}

/**
 * Extracts the sign-post anchors, `GfxFlagPoint <sizeIdx> <x> <y>`. A few records repeat a level line
 * with differing values; the engine's resolution order is unobserved, so last-wins is a deterministic
 * approximation.
 */
export function extractBuildingFlagPoints(
  sections: readonly RuleSection[],
  src: SourceRef,
): BuildingFlagPoint[] {
  return extractHousePoints(sections, src, 'GfxFlagPoint');
}

/**
 * Extracts the garrison-flag anchors, `gfxsoldierflagpoint <sizeIdx> <x> <y>`. The key is spelled
 * all-lowercase in both the base `houses.cif` and the mod's `houses.ini`, unlike its CamelCase siblings,
 * and `.ini` keys are case-sensitive, so it is matched as authored.
 */
export function extractBuildingSoldierFlagPoints(
  sections: readonly RuleSection[],
  src: SourceRef,
): BuildingFlagPoint[] {
  return extractHousePoints(sections, src, 'gfxsoldierflagpoint');
}

/** The shared `<level> <x> <y>` anchor read behind both point keys. */
function extractHousePoints(
  sections: readonly RuleSection[],
  src: SourceRef,
  key: string,
): BuildingFlagPoint[] {
  const points: BuildingFlagPoint[] = [];
  for (const record of gfxHouseGraphicsRecords(sections)) {
    const { rec, tribeId, editName, typeByLevel } = record;
    const byLevel = new Map<number, { x: number; y: number }>();
    for (const p of findProps(rec, key)) {
      const [level, x, y] = p.values.map((v) => Number.parseInt(v, 10));
      if (level === undefined || x === undefined || y === undefined) continue;
      if ([level, x, y].some((n) => Number.isNaN(n))) continue;
      byLevel.set(level, { x, y });
    }
    for (const [level, point] of byLevel) {
      const typeId = typeByLevel.get(level);
      if (typeId === undefined) continue;
      points.push(
        BuildingFlagPoint.parse({
          tribeId,
          typeId,
          level,
          x: point.x,
          y: point.y,
          editName,
          source: makeSource(src, 'GfxHouse'),
        }),
      );
    }
  }
  return points;
}

/**
 * Extracts the building `(bmd, palette)` bindings from the CamelCase `GfxBobLibs`/`GfxPalette`/`EditName`
 * keys. Unlike a landscape record, a house record commonly carries several palette values on one
 * `GfxPalette` line (`GfxPalette "house01" "house02"` recolours one body into the home and the
 * stock/warehouse skins), so each value fans into its own binding; the caller dedups identical pairs.
 */
export function extractBuildingGraphics(sections: readonly RuleSection[]): NamedBmdPaletteBinding[] {
  const bindings: NamedBmdPaletteBinding[] = [];
  for (const rec of gfxHouseRecords(sections)) {
    const editName = getStr(rec, 'EditName');
    for (const binding of readBmdPaletteBindings(rec, 'GfxBobLibs', 'GfxPalette', true)) {
      bindings.push({ ...binding, editName });
    }
  }
  return bindings;
}

/**
 * Extracts the building-type → house-bob join: `LogicType <level> <typeId>` paired with `GfxBobId
 * <level> <bobId>` by their leading level index, one row per palette skin. A level with a `LogicType`
 * but no matching `GfxBobId` is omitted.
 *
 * The join is multi-valued on `(tribeId, typeId, paletteName)`: one logic `typeId` maps to several bobs
 * across build levels and across graphics variants sharing that typeId, so a consumer disambiguates by
 * `level` or `editName`. Only byte-identical rows are dropped.
 */
export function extractBuildingBobs(sections: readonly RuleSection[], src: SourceRef): BuildingBob[] {
  const bobs: BuildingBob[] = [];
  const seen = new Set<string>();
  for (const record of gfxHouseGraphicsRecords(sections)) {
    const { rec, tribeId, normalizedBmd, normalizedShadowBmd, palettes, editName, typeByLevel } = record;
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
  }
  return bobs;
}
