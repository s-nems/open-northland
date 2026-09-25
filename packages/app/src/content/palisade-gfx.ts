import type { LayeredBobRef, PalisadeBinding } from '@open-northland/render';
import { servedAtlasStem } from './ir/joins.js';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { playerWallRows, WALL_LOGIC_ID } from './palisade-rows.js';
import { firstBobsByStateAscending } from './resource-gfx/refs.js';

/** The source landscape rows used by walls and their open/closed gate variants. */
export interface PalisadeGfxRefs {
  readonly records: readonly {
    readonly gfxIndex: number;
    readonly stem: string;
    readonly bobs: readonly number[];
  }[];
  /** Only ordinary post variants participate in the repeated-post cycle. */
  readonly wallVariantOrder: readonly number[];
}

/**
 * Resolve the original wall family by logic-table identity. This keeps the join data-driven while retaining
 * every authored gate orientation and state in the same atlas binding.
 */
export function resolvePalisadeGfxRefs(ir: ContentIr | null): PalisadeGfxRefs {
  const walls = playerWallRows(ir);
  const records: Array<{ gfxIndex: number; stem: string; bobs: readonly number[] }> = [];
  const wallVariantOrder: number[] = [];
  for (const record of ir?.landscapeGfx ?? []) {
    const logicId = walls.get(record.logicType)?.logicId;
    if (logicId === undefined) continue;
    const ref = palisadeRecordRef(record);
    if (ref === undefined) continue;
    records.push(ref);
    if (logicId === WALL_LOGIC_ID && record.editName?.startsWith('wall_0') === true)
      wallVariantOrder.push(record.index);
  }
  return { records, wallVariantOrder };
}

function palisadeRecordRef(
  record: LandscapeGfxRow,
): { gfxIndex: number; stem: string; bobs: readonly number[] } | undefined {
  const stem = servedAtlasStem(record);
  const bobs = firstBobsByStateAscending(record);
  return stem === undefined || bobs === undefined ? undefined : { gfxIndex: record.index, stem, bobs };
}

export function palisadeAtlasStems(refs: PalisadeGfxRefs): ReadonlySet<string> {
  return new Set(refs.records.map((record) => record.stem));
}

/** Build the layer-qualified post/gate table after the referenced atlas families have loaded. */
export function buildPalisadeBinding(
  refs: PalisadeGfxRefs,
  loaded: ReadonlySet<string>,
): PalisadeBinding | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  for (const record of refs.records) {
    if (!loaded.has(record.stem)) continue;
    byGfxIndex[record.gfxIndex] = record.bobs.map((bob) => ({ layer: record.stem, bob }));
  }
  const first = refs.records.find((record) => byGfxIndex[record.gfxIndex] !== undefined);
  if (first === undefined) return undefined;
  const frames = byGfxIndex[first.gfxIndex];
  const fallback = frames?.at(-1);
  if (fallback === undefined) return undefined;
  return {
    byGfxIndex,
    variantOrder: refs.wallVariantOrder.filter((gfxIndex) => byGfxIndex[gfxIndex] !== undefined),
    default: fallback,
  };
}
