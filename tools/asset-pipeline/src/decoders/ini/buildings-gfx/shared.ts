/**
 * Machinery shared across the `[GfxHouse]` graphics-table extractors: the per-record size-level join,
 * the multi-house record splitter, the deterministic collision winner, and the body+palette preamble
 * every per-level graphics extractor reads.
 */
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
 * The `LogicType <sizeIdx> <typeId>` table of one `[GfxHouse]` section/sub-record — the size-level →
 * building-typeId join every graphics-table extractor pairs its per-level lines against
 * (construction costs, footprints, construction layers, building bobs). Malformed lines are skipped.
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
 * Splits one `[GfxHouse]` section into its constituent house records. The mod packs several houses
 * under a single `[GfxHouse]` bracket — five blocks lump 4..24 houses (the saracen + egypt families) —
 * each sub-house delimited only by a fresh `EditName` line, not a new bracket. `parseIniSections` opens
 * a section only on a `[...]` header, so it lumps the block into one {@link RuleSection}; without this
 * split the first sub-house's `GfxBobLibs`/`GfxPalette` would be stapled to last-wins `LogicType`/
 * `GfxBobId` across the whole block (dropping/mis-joining 63 of the 234 building types). Walking the
 * props in file order and starting a new record at each `EditName` recovers each house with its own
 * `GfxBobLibs`/`GfxPalette`/`LogicTribeType`/`LogicType`/`GfxBobId` block. Props before the first
 * `EditName` (none in the real file) are ignored; a single-house section yields one record.
 *
 * {@link import('./structure.js').extractConstructionCosts} and
 * {@link import('./visuals.js').extractBuildingGraphics} read the same sections with the same
 * pre-existing lumping bug (so saracen/egypt costs + atlases are likewise incomplete) — a flagged
 * follow-up (source basis); this helper exists to be reused when that lands.
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
 * Whether an already-recorded `[GfxHouse]` winner outranks a new `(tribeType, sizeIdx)` candidate, so
 * the candidate is skipped. The cost / hitpoints / footprint overlays are each keyed by `typeId` but
 * genuinely multi-valued in the source (per tribe, per size level); all three collapse
 * deterministically to the lowest `LogicTribeType` (the reference-tribe convention), and within a
 * tribe the lowest `sizeIdx` (the base build stage), independent of file/parse order.
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
  /** The record's `EditName`, or undefined when absent. */
  readonly editName: string | undefined;
  /** The `(sizeIdx → typeId)` join ({@link logicTypeByLevel}). */
  readonly typeByLevel: Map<number, number>;
}

/**
 * Reads the shared preamble off one house record for the per-level graphics extractors (construction
 * layers, animated overlays, building bobs): the tribe, the normalized body `.bmd`, the palette skins,
 * the `EditName`, and the size-level join. Returns `undefined` when the record lacks a tribe, a body
 * bob, or any palette — the common skip guard, so one malformed record never aborts the offline batch.
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
 * Visits each well-formed `[GfxHouse]` graphics record, skipping the malformed: it
 * {@link splitGfxHouseRecords splits} every lumped bracket and drops records whose
 * {@link readGfxHouseGraphicsRecord preamble} fails to resolve. `rec` is the raw section for reading
 * per-level property lines; `record` is the resolved preamble.
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
