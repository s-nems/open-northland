import type { LayeredBobRef, ResourceTypeBinding } from '@open-northland/render';
import type { ContentIr, LandscapeGfxRow } from '../ir/rows.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../map-resources.js';
import { type GatheringNodeRef, nodeRefFrom } from './refs.js';

/** A resolved berry-bush draw: the fruited-record index (the `gfxIndex` join key) and its three render
 *  states, `flowering` being the regrow midpoint between foraged and fruiting. */
export interface BerryBushRef {
  readonly gfxIndex: number;
  readonly ripe: GatheringNodeRef;
  readonly flowering: GatheringNodeRef;
  readonly bare: GatheringNodeRef;
}

/**
 * Resolve every forageable berry bush's three-stage draw from the IR landscape gfx: each fruited-bush record
 * paired with its `bush flowering` and `bush naked` species twins, matched by editName ("bush 01 fruits" →
 * "bush 01 flower" / "bush 01 empty"). Keyed by the fruited record index.
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
    // Stage twins fall back down the cycle when a record is absent (flowering → ripe, bare → flowering).
    const flowering = twin(rec.editName, 'flower') ?? ripe;
    const bare = twin(rec.editName, 'empty') ?? flowering;
    out.push({ gfxIndex: rec.index, ripe, flowering, bare });
  }
  return out;
}

/** The atlas stems these bushes draw from, folded into the loaded gathering families so the live pool can
 *  draw a bush in any state. */
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
 * Reduce resolved berry-bush refs to a binding keyed under each bush's fruited `gfxIndex`, with a
 * three-frame level list bare → flowering → ripe (the empty→full order `DrawItem.level` indexes straight).
 * A flowering or bare frame whose atlas family didn't load reuses the next-higher loaded frame; a bush
 * whose ripe family didn't load is dropped to the placeholder. `default` is the first bush's ripe frame,
 * what a bush with no matching `gfxIndex` draws.
 */
export function buildBerryBushBinding(
  refs: readonly BerryBushRef[],
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  let fallback: LayeredBobRef | undefined;
  for (const r of refs) {
    if (!loaded.has(r.ripe.stem)) continue;
    const ripeRef: LayeredBobRef = { layer: r.ripe.stem, bob: r.ripe.bob };
    const floweringRef: LayeredBobRef = loaded.has(r.flowering.stem)
      ? { layer: r.flowering.stem, bob: r.flowering.bob }
      : ripeRef;
    const bareRef: LayeredBobRef = loaded.has(r.bare.stem)
      ? { layer: r.bare.stem, bob: r.bare.bob }
      : floweringRef;
    byGfxIndex[r.gfxIndex] = [bareRef, floweringRef, ripeRef];
    fallback ??= ripeRef;
  }
  if (fallback === undefined) return undefined;
  return { byGood: {}, byGfxIndex, default: fallback };
}
