import { type AtomicAnimation, type ContentSet, resolveJobAtomics } from '@open-northland/data';

/** The build-wall slot bound for the builder job, swung for a wall's one-wood finish and its repairs (source
 *  basis the `viking_builder_build_wall` binding in `DataCnmd/tribetypes12/tribetypes.ini` and the
 *  builder's `allowatomic 42` in `jobtypes.ini`). */
export const BUILD_WALL_ATOMIC_ID = 42;

/** The build-road slot bound for the builder job, swung for a road site's one-stone finish (source basis
 *  the `viking_builder_build_road` binding in `DataCnmd/tribetypes12/tribetypes.ini` and the builder's
 *  `allowatomic 41` in `jobtypes.ini`). */
export const BUILD_ROAD_ATOMIC_ID = 41;

/**
 * Ticks each authored tick of a one-strike site's clip lasts. Original behavior: an atomic runs its
 * `length` in logic ticks, one per tick at 12 ticks per second, and a road or wall site finishes on its one
 * strike, so the 15-tick swing lasts 1.25 s. Approximation: that single swing reads hurried, so it
 * plays at half pace; house strikes, which repeat, keep the data's pace.
 */
const ONE_STRIKE_CLIP_PACE = 2;

const PACED_ATOMICS: ReadonlyMap<number, number> = new Map([
  [BUILD_ROAD_ATOMIC_ID, ONE_STRIKE_CLIP_PACE],
  [BUILD_WALL_ATOMIC_ID, ONE_STRIKE_CLIP_PACE],
]);

/**
 * The `atomicanimations.ini` clips keyed by exact `name` (first-wins), with every clip a tribe binds to a
 * {@link PACED_ATOMICS} slot stretched: its length and event ticks scale by the pace, so the atomic lasts
 * longer while each event still fires once, in the same place within the swing.
 */
export function atomicAnimationTable(
  content: ContentSet,
  bindings: ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>>,
): ReadonlyMap<string, AtomicAnimation> {
  const paceByName = new Map<string, number>();
  for (const byJob of bindings.values()) {
    for (const byAtomic of byJob.values()) {
      for (const [atomicId, name] of byAtomic) {
        const pace = PACED_ATOMICS.get(atomicId);
        if (pace !== undefined) paceByName.set(name, pace);
      }
    }
  }
  const out = new Map<string, AtomicAnimation>();
  for (const clip of content.atomicAnimations) {
    if (out.has(clip.name)) continue;
    const pace = paceByName.get(clip.name);
    out.set(clip.name, pace === undefined ? clip : pacedClip(clip, pace));
  }
  return out;
}

/** `clip` played at `pace` ticks per authored tick; an event keeps the first tick of its stretched frame. */
function pacedClip(clip: AtomicAnimation, pace: number): AtomicAnimation {
  return {
    ...clip,
    length: clip.length * pace,
    events: clip.events.map((event) =>
      event.at === 0 ? event : { ...event, at: (event.at - 1) * pace + 1 },
    ),
  };
}

/** The flag-gathering trades: a job whose resolved atomics include some non-farmed good's harvest
 *  atomic, whether declared or inherited from its base job. */
export function harvestCapableJobs(content: ContentSet): ReadonlySet<number> {
  const harvestAtomics = new Set<number>();
  for (const g of content.goods) {
    if (g.farming !== undefined) continue; // field-farmed - its harvester is a bound farmer, not a flag gatherer
    if (g.atomics.harvest !== undefined) harvestAtomics.add(g.atomics.harvest);
  }
  const jobs = new Set<number>();
  for (const [typeId, atomics] of resolveJobAtomics(content.jobs)) {
    for (const harvest of harvestAtomics) {
      if (atomics.has(harvest)) {
        jobs.add(typeId);
        break;
      }
    }
  }
  return jobs;
}

/** The per-tribe `setatomic` binding tables: first-wins per tribe typeId, last-wins per binding. */
export function atomicBindingTables(
  content: ContentSet,
): ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>> {
  const byTribe = new Map<number, Map<number, Map<number, string>>>();
  for (const tribe of content.tribes) {
    if (byTribe.has(tribe.typeId)) continue;
    const byJob = new Map<number, Map<number, string>>();
    for (const b of tribe.atomicBindings) {
      let byAtomic = byJob.get(b.jobType);
      if (byAtomic === undefined) {
        byAtomic = new Map<number, string>();
        byJob.set(b.jobType, byAtomic);
      }
      byAtomic.set(b.atomicId, b.animation);
    }
    byTribe.set(tribe.typeId, byJob);
  }
  return byTribe;
}
