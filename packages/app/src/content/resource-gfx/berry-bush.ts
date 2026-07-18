import type { LayeredBobRef, ResourceTypeBinding } from '@open-northland/render';
import type { ContentIr, LandscapeGfxRow } from '../ir.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../map-resources.js';
import { type GatheringNodeRef, nodeRefFrom } from './refs.js';

/** A resolved berry-bush draw: the fruited-record index (the {@link import('@open-northland/sim').BerryBush.gfxIndex}
 *  → {@link import('@open-northland/render').DrawItem.gfxIndex} join key) and its three render states — `ripe`
 *  (holds fruit), `flowering` (blooming, the regrow midpoint) and `bare` (foraged), each a served atlas stem + bob. */
export interface BerryBushRef {
  readonly gfxIndex: number;
  readonly ripe: GatheringNodeRef;
  readonly flowering: GatheringNodeRef;
  readonly bare: GatheringNodeRef;
}

/**
 * Resolve every forageable berry bush's three-stage draw from the IR landscape gfx: each fruited-bush record
 * (`logicType === bush with fruits`) paired with its species twins — the "… flower" record (`bush flowering`)
 * and the "… empty" record (`bush naked`), matched by editName ("bush 01 fruits" → "bush 01 flower" / "bush 01
 * empty"). A twin with no decoded record reuses a fallback frame (flowering → ripe, bare → flowering) so a
 * bush with a missing stage still draws. Keyed by the fruited record index. Pure; degrades to empty on an
 * older ir.json.
 */
export function resolveBerryBushRefs(ir: ContentIr | null): BerryBushRef[] {
  const records = ir?.landscapeGfx ?? [];
  const byName = new Map<string, LandscapeGfxRow>();
  for (const g of records) if (g.editName !== undefined) byName.set(g.editName, g);
  const twin = (editName: string, suffix: string): GatheringNodeRef | undefined => {
    const rec = byName.get(editName.replace(/fruits?$/i, suffix));
    return rec !== undefined ? nodeRefFrom(rec) : undefined;
  };
  const out: BerryBushRef[] = [];
  for (const rec of records) {
    if (rec.logicType !== BUSH_WITH_FRUITS_LOGIC_TYPE || rec.editName === undefined) continue;
    const ripe = nodeRefFrom(rec);
    if (ripe === undefined) continue;
    // Stage twins fall back down the cycle when a record is absent (flowering → ripe, bare → its flowering),
    // so a species missing a decoded stage still draws something plausible instead of the placeholder.
    const flowering = twin(rec.editName, 'flower') ?? ripe;
    const bare = twin(rec.editName, 'empty') ?? flowering;
    out.push({ gfxIndex: rec.index, ripe, flowering, bare });
  }
  return out;
}

/** Atlas stems a set of {@link BerryBushRef}s draw from (both ripe + bare states) — folded into the loaded
 *  gathering families so the live pool can draw a bush in either state after its static→live handover. */
export function berryBushAtlasStems(refs: readonly BerryBushRef[]): Set<string> {
  const out = new Set<string>();
  for (const r of refs) {
    out.add(r.ripe.stem);
    out.add(r.flowering.stem);
    out.add(r.bare.stem);
  }
  return out;
}

/**
 * Reduce resolved berry-bush refs to a {@link ResourceTypeBinding}: each bush keyed under its fruited
 * `gfxIndex` with a three-frame level list — level 1 (bare) → empty frame, level 2 (flowering) → flower
 * frame, level 3 (ripe) → fruited frame (the empty→full order {@link import('./bindings.js').buildResourceBinding}
 * uses, so `DrawItem.level` picks straight). A flowering/bare frame whose atlas family didn't load reuses
 * the next-higher loaded frame (flowering → ripe, bare → flowering); a bush whose ripe family didn't load
 * is dropped to the placeholder. `default` is the first bush's ripe frame — what a bush with no matching
 * `gfxIndex` draws. Undefined when nothing loaded. Pure + unit-tested.
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
    const floweringRef: LayeredBobRef = loaded.has(r.flowering.stem)
      ? { layer: r.flowering.stem, bob: r.flowering.bob }
      : ripeRef; // no flower atlas — fall back to the fruited frame
    const bareRef: LayeredBobRef = loaded.has(r.bare.stem)
      ? { layer: r.bare.stem, bob: r.bare.bob }
      : floweringRef; // no empty atlas — fall back to the flowering frame
    byGfxIndex[r.gfxIndex] = [bareRef, floweringRef, ripeRef]; // level 1 = bare, 2 = flowering, 3 = ripe
    fallback ??= ripeRef;
  }
  if (fallback === undefined) return undefined;
  return { byGood: {}, byGfxIndex, default: fallback };
}
