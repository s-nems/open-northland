import type { ContentSet, TribeType } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

// Read views over the tribe table: which tribes a player may command, and their per-tribe constants.
// The civ-vs-animal split lives in ./animals.ts, keyed on the `animaltypes.ini` record.

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
 * Whether `tribeType` has a `[tribetype]` record but no `jobEnables` edges, so no building can employ it
 * and it reaches no rung of the trade ladder. The monster tribes read this way, and so does every animal
 * tribe; a caller that means only the monsters pairs it with the {@link Person} key.
 *
 * Not `!isPlayableTribe`: a tribe id with no record at all declares nothing either way, and answering
 * "declares no trades" for it would silently reclassify a settler the content never described.
 */
export function declaresNoTrades(content: ContentSet, tribeType: number): boolean {
  const tribe = contentIndex(content).tribes.get(tribeType);
  return tribe !== undefined && tribe.jobEnables.length === 0;
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
