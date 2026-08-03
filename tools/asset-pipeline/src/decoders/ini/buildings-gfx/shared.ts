import {
  findProp,
  findProps,
  getInt,
  getStr,
  normalizeAssetPath,
  normalizeOptionalPath,
  type RuleProp,
  type RuleSection,
} from '../grammar.js';

/**
 * The `LogicType <sizeIdx> <typeId>` table of one `[GfxHouse]` record: the size-level → building-typeId
 * join every per-level line is paired against.
 */
export function logicTypeByLevel(sec: RuleSection): Map<number, number> {
  const typeByLevel = new Map<number, number>();
  for (const p of findProps(sec, 'LogicType')) {
    const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
    const typeId = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(sizeIdx) || Number.isNaN(typeId)) continue;
    typeByLevel.set(sizeIdx, typeId);
  }
  return typeByLevel;
}

/**
 * Splits one `[GfxHouse]` section into its constituent house records. The mod packs several houses under
 * a single bracket, each sub-house delimited only by a fresh `EditName` line, and `parseIniSections`
 * opens a section only on a `[...]` header. Props before the first `EditName` are ignored. Every
 * `[GfxHouse]` extractor walks these records, never the raw section.
 */
export function splitGfxHouseRecords(sec: RuleSection): RuleSection[] {
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
 * Whether an already-recorded winner outranks a new `(tribeType, sizeIdx)` candidate, so the candidate
 * is skipped. The per-typeId overlays collapse to the lowest `LogicTribeType` (the reference-tribe
 * convention) and, within a tribe, the lowest `sizeIdx` (the base build stage), independent of file
 * order.
 */
export function existingGfxHouseWins(
  existing: { tribeType: number; sizeIdx: number } | undefined,
  tribeType: number,
  sizeIdx: number,
): boolean {
  return (
    existing !== undefined &&
    (existing.tribeType < tribeType || (existing.tribeType === tribeType && existing.sizeIdx <= sizeIdx))
  );
}

/** The body+palette preamble every per-level `[GfxHouse]` graphics extractor shares. */
export interface GfxHouseGraphicsRecord {
  /** The owning tribe (`LogicTribeType`). */
  readonly tribeId: number;
  /** The body bob set (`GfxBobLibs[0]`), path-normalized. */
  readonly normalizedBmd: string;
  /** The shadow bob set (`GfxBobLibs[1]`), path-normalized, when the record names one. */
  readonly normalizedShadowBmd: string | undefined;
  /** The non-empty palette skins on the record's `GfxPalette` line, in file order. */
  readonly palettes: string[];
  /** The record's `EditName`. */
  readonly editName: string | undefined;
  /** The `LogicType` `(sizeIdx → typeId)` join. */
  readonly typeByLevel: Map<number, number>;
}

/**
 * Reads the shared preamble off one house record. Returns `undefined` when the record lacks a tribe, a
 * body bob, or any palette, the common skip guard so one malformed record never aborts the offline batch.
 */
export function readGfxHouseGraphicsRecord(rec: RuleSection): GfxHouseGraphicsRecord | undefined {
  const tribeId = getInt(rec, 'LogicTribeType');
  if (tribeId === undefined) return undefined;
  const libs = findProp(rec, 'GfxBobLibs');
  const bmd = libs?.values[0];
  if (bmd === undefined || bmd.trim() === '') return undefined;
  const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
  if (palettes.length === 0) return undefined;
  return {
    tribeId,
    normalizedBmd: normalizeAssetPath(bmd),
    normalizedShadowBmd: normalizeOptionalPath(libs?.values[1]),
    palettes,
    editName: getStr(rec, 'EditName'),
    typeByLevel: logicTypeByLevel(rec),
  };
}

/**
 * Visits each well-formed `[GfxHouse]` graphics record, skipping those whose preamble fails to resolve.
 * `rec` is the raw section for reading per-level property lines; `record` is the resolved preamble.
 */
export function forEachGfxHouseRecord(
  sections: readonly RuleSection[],
  visit: (rec: RuleSection, record: GfxHouseGraphicsRecord) => void,
): void {
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const record = readGfxHouseGraphicsRecord(rec);
      if (record === undefined) continue;
      visit(rec, record);
    }
  }
}
