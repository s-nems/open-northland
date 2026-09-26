import { type EntitySnapshot, entityById, type WorldSnapshot } from '@open-northland/sim';
import type { DrawListOptions, LiveRefs } from './sprite-scene.js';

export type EntitySource = Pick<
  DrawListOptions,
  'viewport' | 'index' | 'onlyRefs' | 'staticRefs' | 'portraitRef' | 'portraitHouse' | 'insetRefs'
>;

/** The returned view reads `collected` live, so refs the caller adds afterwards count too. Only the
 *  index mode answers without having walked the map, and adds the index's drawables, minus the static
 *  ones, to that view. */
export function emitEntities(
  snapshot: WorldSnapshot,
  source: EntitySource,
  collected: Set<number>,
  emit: (entity: EntitySnapshot) => void,
): LiveRefs {
  const { viewport, index, onlyRefs, staticRefs, portraitRef, portraitHouse, insetRefs } = source;
  if (index !== undefined && viewport !== undefined && onlyRefs === undefined) {
    // Each bucket candidate still runs the emitter's per-item cull, so the emitted set matches the full
    // walk's.
    index.update(snapshot);
    for (const entity of index.query(viewport)) emit(entity);
    // The portrait subjects may sit outside the queried buckets.
    const force = (ref: number | undefined): void => {
      if (ref === undefined || collected.has(ref)) return;
      const subject = entityById(snapshot, ref);
      if (subject !== undefined) emit(subject);
    };
    force(portraitRef);
    force(portraitHouse);
    for (const ref of insetRefs ?? []) force(ref);
    return { has: (ref) => collected.has(ref) || (index.has(ref) && staticRefs?.has(ref) !== true) };
  }
  if (onlyRefs !== undefined) {
    // Binary search per ref, instead of walking a decoded map's tens of thousands of entities.
    for (const ref of onlyRefs) {
      const entity = entityById(snapshot, ref);
      if (entity !== undefined) emit(entity);
    }
    return collected;
  }
  for (const entity of snapshot.entities) emit(entity);
  return collected;
}
