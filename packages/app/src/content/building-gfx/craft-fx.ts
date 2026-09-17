import type { CraftFxBinding, CraftFxLoopRef, WaveLoop } from '@open-northland/render';
import { landscapeRecordsByName, servedAtlasStem } from '../ir/joins.js';
import type { ContentIr, LandscapeGfxRow } from '../ir/rows.js';

/** A resolved staged-effect draw: the `[GfxLandscape]` record's served atlas stem and its loop, keyed
 *  by the `EditName` the in-house programs name it by. */
export interface CraftFxRef {
  readonly name: string;
  readonly loop: CraftFxLoopRef;
}

/** The lowest state's whole frame list: the record's loop, which every `fx` record authors in one state. */
function loopFrames(record: LandscapeGfxRow): WaveLoop<number> | undefined {
  const lowest = [...(record.frames ?? [])].sort((a, b) => a.state - b.state)[0];
  const [first, ...rest] = lowest?.bobIds ?? [];
  return first === undefined ? undefined : [first, ...rest];
}

/** Every effect the extracted in-house programs stage, resolved to its record once per distinct name;
 *  a name no record carries, or one naming no drawable atlas, stages nothing. */
export function resolveCraftFxRefs(ir: ContentIr | null): CraftFxRef[] {
  const out: CraftFxRef[] = [];
  if (ir === null) return out;
  const records = landscapeRecordsByName(ir);
  const seen = new Set<string>();
  for (const program of ir.gfxInHousePrograms ?? []) {
    for (const entry of program.entries) {
      if (entry.kind !== 'landscape' || seen.has(entry.name)) continue;
      seen.add(entry.name);
      const record = records.get(entry.name);
      if (record === undefined) continue;
      const stem = servedAtlasStem(record);
      const frames = loopFrames(record);
      if (stem === undefined || frames === undefined) continue;
      out.push({ name: entry.name, loop: { layer: stem, frames } });
    }
  }
  return out;
}

export function craftFxAtlasStems(refs: readonly CraftFxRef[]): Set<string> {
  return new Set(refs.map((r) => r.loop.layer));
}

/** The binding over exactly the effects whose family loaded; `undefined` when none did, so a staged
 *  effect falls back to the placeholder. */
export function buildCraftFxBinding(
  refs: readonly CraftFxRef[],
  loaded: ReadonlySet<string>,
): CraftFxBinding | undefined {
  const byName: Record<string, CraftFxLoopRef> = {};
  let any = false;
  for (const r of refs) {
    if (!loaded.has(r.loop.layer)) continue;
    byName[r.name] = r.loop;
    any = true;
  }
  return any ? { byName } : undefined;
}
