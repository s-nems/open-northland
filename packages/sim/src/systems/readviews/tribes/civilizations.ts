import type { ContentSet, TribeType } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

// Read views for the data-defined civ-vs-animal tribe split, read off each tribe's tech graph.

/**
 * The playable (controllable) tribes, distinguished from the animal/monster tribes by the data alone rather
 * than by a hardcoded name or count. `content.tribes` is a flat list of every extracted `[tribetype]`: the 5
 * civilizations and the 36 animal/monster tribes. Only a civilization carries `jobEnables` edges (and,
 * equivalently, `{need,train}for*` `jobRequirements`); an animal tribe is purely an atomic-binding
 * vocabulary with `jobEnables.length === 0`.
 *
 * Sorted ascending by `typeId` so enumeration order is stable regardless of declaration order.
 */
export function playableTribes(content: ContentSet): TribeType[] {
  return content.tribes.filter((t) => t.jobEnables.length > 0).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether `tribeType` is a playable civilization - the membership half of {@link playableTribes}, without
 * materializing the sorted list. An unknown `tribeType` is not playable.
 */
export function isPlayableTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = contentIndex(content).tribes.get(tribeType);
  return tribe !== undefined && tribe.jobEnables.length > 0;
}

/**
 * The hitpoint pool an adult settler of `tribeType` carries, `0` when the tribe has no record or leaves it
 * unset - which each caller answers for itself.
 *
 * Approximation: the original's human HP is not in the readable data, so {@link TribeType.hitpoints} is
 * supplied at the content boundary.
 */
export function settlerHitpoints(content: ContentSet, tribeType: number): number {
  return contentIndex(content).tribes.get(tribeType)?.hitpoints ?? 0;
}

/**
 * Whether `tribeType` is a known animal/monster tribe - an extracted `[tribetype]` carrying no tech graph
 * (`jobEnables.length === 0`), the same signature {@link playableTribes} splits on.
 *
 * Not the negation of {@link isPlayableTribe}: an unknown `tribeType` with no record at all is
 * `!isPlayableTribe` but is not an animal, and must not be silently reclassified as wildlife.
 */
export function isAnimalTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = contentIndex(content).tribes.get(tribeType);
  return tribe !== undefined && tribe.jobEnables.length === 0;
}
