import type { LayeredBobRef, ResourceTypeBinding } from '@open-northland/render';
import type { ContentIr, LandscapeGfxRow } from '../ir.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../map-resources.js';
import { type GatheringNodeRef, nodeRefFrom } from './refs.js';

/** A resolved berry-bush draw: the fruited-record INDEX (the {@link import('@open-northland/sim').BerryBush.gfxIndex}
 *  → {@link import('@open-northland/render').DrawItem.gfxIndex} join key) and its two render states — `ripe`
 *  (holds fruit) and `bare` (foraged, regrowing), each a served atlas stem + bob. */
export interface BerryBushRef {
  readonly gfxIndex: number;
  readonly ripe: GatheringNodeRef;
  readonly bare: GatheringNodeRef;
}

/**
 * Resolve every forageable berry bush's ripe+bare draw from the IR landscape gfx: each fruited-bush record
 * (`logicType === bush with fruits`) paired with its bare twin — the same species' "… empty" record
 * (`bush naked`), matched by editName ("bush 01 fruits" → "bush 01 empty"). A bush with no matching empty
 * record reuses its fruited frame for the bare state (degraded, still drawn). Keyed by the fruited record
 * index. Pure; degrades to empty on an older ir.json.
 */
export function resolveBerryBushRefs(ir: ContentIr | null): BerryBushRef[] {
  const records = ir?.landscapeGfx ?? [];
  const byName = new Map<string, LandscapeGfxRow>();
  for (const g of records) if (g.editName !== undefined) byName.set(g.editName, g);
  const out: BerryBushRef[] = [];
  for (const rec of records) {
    if (rec.logicType !== BUSH_WITH_FRUITS_LOGIC_TYPE || rec.editName === undefined) continue;
    const ripe = nodeRefFrom(rec);
    if (ripe === undefined) continue;
    // The bare twin: the same species' "… empty" record (bush naked). Fall back to the ripe frame when
    // absent, so a bush with no decoded empty state still draws (just always fruited).
    const emptyRec = byName.get(rec.editName.replace(/fruits?$/i, 'empty'));
    const bare = emptyRec !== undefined ? (nodeRefFrom(emptyRec) ?? ripe) : ripe;
    out.push({ gfxIndex: rec.index, ripe, bare });
  }
  return out;
}

/** Atlas stems a set of {@link BerryBushRef}s draw from (both ripe + bare states) — folded into the loaded
 *  gathering families so the live pool can draw a bush in either state after its static→live handover. */
export function berryBushAtlasStems(refs: readonly BerryBushRef[]): Set<string> {
  const out = new Set<string>();
  for (const r of refs) {
    out.add(r.ripe.stem);
    out.add(r.bare.stem);
  }
  return out;
}

/**
 * Reduce resolved berry-bush refs to a {@link ResourceTypeBinding}: each bush keyed under its fruited
 * `gfxIndex` with a TWO-frame level list — level 1 (bare) → empty frame, level 2 (ripe) → fruited frame
 * (the empty→full order {@link import('./bindings.js').buildResourceBinding} uses, so `DrawItem.level`
 * picks straight). A bare frame whose atlas family didn't load reuses the ripe frame; a bush whose RIPE
 * family didn't load is dropped to the placeholder. `default` is the first bush's ripe frame — what a bush
 * with no matching `gfxIndex` draws. Undefined when nothing loaded. Pure + unit-tested.
 */
export function buildBerryBushBinding(
  refs: readonly BerryBushRef[],
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  let fallback: LayeredBobRef | undefined;
  for (const r of refs) {
    if (!loaded.has(r.ripe.stem)) continue; // no fruited atlas — drop it (placeholder)
    const ripeRef: LayeredBobRef = { layer: r.ripe.stem, bob: r.ripe.bob };
    const bareRef: LayeredBobRef = loaded.has(r.bare.stem)
      ? { layer: r.bare.stem, bob: r.bare.bob }
      : ripeRef; // no empty atlas — reuse the fruited frame for the bare state
    byGfxIndex[r.gfxIndex] = [bareRef, ripeRef]; // level 1 = bare, level 2 = ripe
    fallback ??= ripeRef;
  }
  if (fallback === undefined) return undefined;
  return { byGood: {}, byGfxIndex, default: fallback };
}
