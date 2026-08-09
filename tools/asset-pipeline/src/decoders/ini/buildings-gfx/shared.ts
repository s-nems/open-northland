import type { RuleProp, RuleSection } from '../grammar.js';
import { normalizeAssetPath, normalizeOptionalPath } from '../ir-fields.js';
import { findProp, findProps, getInt, getStr } from '../props.js';

/**
 * The `LogicType <sizeIdx> <typeId>` table of one `[GfxHouse]` record: the size-level → building-typeId
 * join every per-level line is paired against.
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

/**
 * Splits one `[GfxHouse]` section into its constituent house records. The mod packs several houses under
 * a single bracket, each sub-house delimited only by a fresh `EditName` line, and `parseIniSections`
 * opens a section only on a `[...]` header. Props before the first `EditName` are ignored.
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

/** Every house record of every `[GfxHouse]` section, in file order: the one traversal each extractor walks. */
export function* gfxHouseRecords(sections: readonly RuleSection[]): Generator<RuleSection> {
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    yield* splitGfxHouseRecords(sec);
  }
}

/** The rank and join preamble the per-typeId overlays read off one house record. */
export interface GfxHouseLogicRecord {
  readonly rec: RuleSection;
  /** `LogicTribeType`; a record without one takes `Infinity` so it ranks behind every named tribe. */
  readonly tribeType: number;
  readonly typeByLevel: Map<number, number>;
}

export function* gfxHouseLogicRecords(sections: readonly RuleSection[]): Generator<GfxHouseLogicRecord> {
  for (const rec of gfxHouseRecords(sections)) {
    yield {
      rec,
      tribeType: getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY,
      typeByLevel: logicTypeByLevel(rec),
    };
  }
}

/** The body+palette preamble every per-level `[GfxHouse]` graphics extractor shares. */
export interface GfxHouseGraphicsRecord {
  readonly rec: RuleSection;
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
function readGfxHouseGraphicsRecord(rec: RuleSection): GfxHouseGraphicsRecord | undefined {
  const tribeId = getInt(rec, 'LogicTribeType');
  if (tribeId === undefined) return undefined;
  const libs = findProp(rec, 'GfxBobLibs');
  const bmd = libs?.values[0];
  if (bmd === undefined || bmd.trim() === '') return undefined;
  const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
  if (palettes.length === 0) return undefined;
  return {
    rec,
    tribeId,
    normalizedBmd: normalizeAssetPath(bmd),
    normalizedShadowBmd: normalizeOptionalPath(libs?.values[1]),
    palettes,
    editName: getStr(rec, 'EditName'),
    typeByLevel: logicTypeByLevel(rec),
  };
}

/** Every `[GfxHouse]` record whose graphics preamble resolves; the rest are skipped. */
export function* gfxHouseGraphicsRecords(
  sections: readonly RuleSection[],
): Generator<GfxHouseGraphicsRecord> {
  for (const rec of gfxHouseRecords(sections)) {
    const record = readGfxHouseGraphicsRecord(rec);
    if (record !== undefined) yield record;
  }
}
