import type { ContentSet, TribeType } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

// Pure, terminal **read views** for tribe classification + animal behaviour — the data-defined
// civ-vs-animal split (off each tribe's tech graph) and the `animaltypes.ini` behaviour flags the
// CombatSystem's targeting drive reads. No mechanic is added here; see ./index.ts for how read views relate to systems.

/**
 * The **playable (controllable) tribes** as a derived **read view** over `content` — the N civilizations
 * a player can command, distinguished from the animal/monster tribes *by the data alone*, never by a
 * hardcoded name or count ("two"). `content.tribes` is a flat list of every `[tribetype]` the pipeline
 * extracted — the 5 civilizations (viking/frank/saracen/byzantine/egypt) **and** the 36 animal/monster
 * tribes (`bears`, `wolves`, `weresnake`, …). The distinguishing signature is the **tech graph**: only a
 * civilization carries `jobEnables` edges (and, equivalently, `{need,train}for*` `jobRequirements`) — an
 * animal tribe is purely an atomic-binding vocabulary with `jobEnables.length === 0`. So a playable
 * tribe is exactly one with a non-empty `jobEnables` graph; this is the data-defined "N tribes" the
 * combat targeting and the upcoming non-controllable-animals item both build on, with nothing hardcoded.
 *
 * Returned as a {@link TribeType} **array** sorted ascending by `typeId` (not a Map keyed by id) so the
 * enumeration order is stable regardless of `content.tribes` declaration order — the canonical order a
 * "for each playable tribe" loop (births, AI, scoring) wants. {@link isPlayableTribe} is the matching
 * membership predicate for a single `tribeType` without materializing the list.
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted tribe IR, like {@link goodsGraph}
 * — it adds no mechanic (nothing produced/consumed/moved) and invents no classification: the
 * playable-vs-animal split is read straight off whether the source `[tribetype]` block declared a
 * `jobEnables*` tech graph, the faithful param the pipeline pinned (historical plan phase 4 "N data-defined
 * tribes": asymmetry through each tribe's bindings + `allow*`/`needfor*` graph, never hardcode "two").
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock) over the plain
 * `content.tribes` array, explicitly **sorted** by `typeId`, so the same content yields a byte-identical
 * array (and iteration order) every call.
 */
export function playableTribes(content: ContentSet): TribeType[] {
  return content.tribes.filter((t) => t.jobEnables.length > 0).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether `tribeType` is a **playable (controllable) civilization** — the single-tribe membership half
 * of {@link playableTribes}, for a caller (combat enemy-vs-animal targeting, a per-tribe AI gate) that
 * has a `tribe` id and only needs the yes/no, without materializing the sorted list. A tribe is playable
 * iff its `[tribetype]` carries a non-empty `jobEnables` tech graph (see {@link playableTribes}); an
 * unknown `tribeType` (no matching record) is **not** playable. Pure over `content`, no RNG/wall-clock.
 */
export function isPlayableTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = contentIndex(content).tribes.get(tribeType);
  return tribe !== undefined && tribe.jobEnables.length > 0;
}

/**
 * Whether `tribeType` is a **known animal/monster tribe** — a `[tribetype]` the pipeline DID extract
 * (so it has a record) but that carries **no tech graph** (`jobEnables.length === 0`). This is the
 * complement of {@link isPlayableTribe} *restricted to recorded tribes*: of the 41 extracted tribes
 * the 5 civilizations are playable and the other 36 are animals, distinguished by the same data
 * signature ({@link playableTribes} — only a civilization carries `jobEnables` edges), never by a
 * hardcoded name or count.
 *
 * The distinction from `!isPlayableTribe` matters at the boundary: an **unknown** `tribeType` (no
 * matching record at all — e.g. a synthetic test fixture's enemy, or a not-yet-loaded tribe) is
 * `!isPlayableTribe` but is **not** an animal — we know nothing about it, so it must not be silently
 * reclassified as wildlife. So this returns `true` only for a tribe we have a record for AND that
 * record proves animal (empty tech graph); an absent record is `false` here just as it is in
 * {@link isPlayableTribe}. The combat targeting drive (`conflict/targeting.ts`) uses this to keep an
 * animal tribe out of the **player-vs-player** enemy predicate — civ-vs-animal aggression is a
 * separate, data-driven (`animaltypes.ini`) model, not the same-different-tribe rule.
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted tribe IR, like
 * {@link isPlayableTribe} — it adds no mechanic and invents no classification; the animal-vs-civ split
 * is read straight off whether the source `[tribetype]` declared a `jobEnables*` tech graph. Pure over
 * `content`, no RNG/wall-clock.
 */
export function isAnimalTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = contentIndex(content).tribes.get(tribeType);
  return tribe !== undefined && tribe.jobEnables.length === 0;
}
