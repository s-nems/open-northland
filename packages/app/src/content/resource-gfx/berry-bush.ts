import type { ResourceLevelRef, ResourceTypeBinding } from '@open-northland/render';
import type { ContentIr, LandscapeGfxRow } from '../ir/rows.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE, bushTwinName } from '../map/resources.js';
import { type GatheringLoopRef, levelsRefFrom } from './refs.js';

/** A resolved berry-bush draw: the fruited-record index (the `gfxIndex` join key) and its three render
 *  states, `flowering` being the regrow midpoint between foraged and fruiting. Each stage is its record's
 *  wind loop. */
export interface BerryBushRef {
  readonly gfxIndex: number;
  readonly ripe: GatheringLoopRef;
  readonly flowering: GatheringLoopRef;
  readonly bare: GatheringLoopRef;
}

/** A bush record's full-grown loop: its top state's frames when the record loops, else its one frame. */
function bushLoopFrom(record: LandscapeGfxRow): GatheringLoopRef | undefined {
  const ref = levelsRefFrom(record);
  const frames = ref?.levels.at(-1);
  return ref === undefined || frames === undefined ? undefined : { stem: ref.stem, frames };
}

/**
 * Resolve every forageable berry bush's three-stage draw from the IR landscape gfx: each fruited-bush record
 * paired with its `bush flowering` and `bush naked` species twins by {@link bushTwinName}. Keyed by the
 * fruited record index.
 */
export function resolveBerryBushRefs(ir: ContentIr | null): BerryBushRef[] {
  const records = ir?.landscapeGfx ?? [];
  const byName = new Map<string, LandscapeGfxRow>();
  for (const g of records) if (g.editName !== undefined) byName.set(g.editName, g);
  const twin = (editName: string, stage: 'bare' | 'flowering'): GatheringLoopRef | undefined => {
    const rec = byName.get(bushTwinName(editName, stage));
    return rec !== undefined ? bushLoopFrom(rec) : undefined;
  };
  const out: BerryBushRef[] = [];
  for (const rec of records) {
    if (rec.logicType !== BUSH_WITH_FRUITS_LOGIC_TYPE || rec.editName === undefined) continue;
    const ripe = bushLoopFrom(rec);
    if (ripe === undefined) continue;
    // Stage twins fall back down the cycle when a record is absent (flowering → ripe, bare → flowering).
    const flowering = twin(rec.editName, 'flowering') ?? ripe;
    const bare = twin(rec.editName, 'bare') ?? flowering;
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
 * three-loop level list bare → flowering → ripe (the empty→full order `DrawItem.level` indexes straight).
 * A flowering or bare frame whose atlas family didn't load reuses the next-higher loaded frame; a bush
 * whose ripe family didn't load is dropped to the placeholder. `default` is the first bush's ripe still,
 * what a bush with no matching `gfxIndex` draws.
 */
export function buildBerryBushBinding(
  refs: readonly BerryBushRef[],
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  const byGfxIndex: Record<number, readonly ResourceLevelRef[]> = {};
  let fallback: GatheringLoopRef | undefined;
  for (const r of refs) {
    if (!loaded.has(r.ripe.stem)) continue;
    const ripeRef: ResourceLevelRef = { layer: r.ripe.stem, frames: r.ripe.frames };
    const floweringRef: ResourceLevelRef = loaded.has(r.flowering.stem)
      ? { layer: r.flowering.stem, frames: r.flowering.frames }
      : ripeRef;
    const bareRef: ResourceLevelRef = loaded.has(r.bare.stem)
      ? { layer: r.bare.stem, frames: r.bare.frames }
      : floweringRef;
    byGfxIndex[r.gfxIndex] = [bareRef, floweringRef, ripeRef];
    fallback ??= r.ripe;
  }
  if (fallback === undefined) return undefined;
  return { byGood: {}, byGfxIndex, default: { layer: fallback.stem, bob: fallback.frames[0] } };
}
