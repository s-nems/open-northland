import type { LayeredBobRef, ResourceTypeBinding } from '@open-northland/render';
import type { ContentIr } from '../ir/rows.js';
import { type GatheringNodeRef, nodeRefFrom } from './refs.js';

/** The `[GfxLandscape].logicType` of the two chest landscapes (`landscapetypes.ini` 85 and 86). */
const CHEST_LOGIC_TYPES: ReadonlySet<number> = new Set([85, 86]);

/** A resolved chest draw: the record index a spawned chest carries as its `gfxIndex`, and its one frame. */
export interface ChestRef {
  readonly gfxIndex: number;
  readonly node: GatheringNodeRef;
}

/** Every chest record's draw, keyed by record index, in record order. */
export function resolveChestRefs(ir: ContentIr | null): ChestRef[] {
  const out: ChestRef[] = [];
  for (const rec of ir?.landscapeGfx ?? []) {
    if (!CHEST_LOGIC_TYPES.has(rec.logicType)) continue;
    const node = nodeRefFrom(rec);
    if (node !== undefined) out.push({ gfxIndex: rec.index, node });
  }
  return out;
}

export function chestAtlasStems(refs: readonly ChestRef[]): Set<string> {
  return new Set(refs.map((r) => r.node.stem));
}

/**
 * Reduce the chest refs to a binding keyed under each record's `gfxIndex`, one frame each. `default` is
 * the first loaded chest's frame, what a scene chest with no record tag draws; `undefined` when no chest
 * family loaded, so a chest falls back to the placeholder.
 */
export function buildChestBinding(
  refs: readonly ChestRef[],
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  let fallback: LayeredBobRef | undefined;
  for (const r of refs) {
    if (!loaded.has(r.node.stem)) continue;
    const ref: LayeredBobRef = { layer: r.node.stem, bob: r.node.bob };
    byGfxIndex[r.gfxIndex] = [ref];
    fallback ??= ref;
  }
  if (fallback === undefined) return undefined;
  return { byGood: {}, byGfxIndex, default: fallback };
}
