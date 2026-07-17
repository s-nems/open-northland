import type { ContentSet } from '@open-northland/data';
import type { Simulation } from '@open-northland/sim';
import { PRIMARY_TRIBE } from '../../rules.js';
import { GATHERERS } from '../ids/index.js';

/**
 * The starting XP that clears every `needforgood` gate on the sandbox's gatherable goods for
 * {@link PRIMARY_TRIBE}, as `[trackTypeId, points]` pairs. Each `need` requirement sums the XP across
 * its named tracks, so granting its `amount` into its FIRST track satisfies it. Real extracted content
 * gates iron/gold behind clay/stone-digging XP (`needforgood 6/7 10` over tracks 4+5) — a fresh
 * collector pinned to an iron camp would never qualify and stands idle beside the deposit, so sandbox
 * collectors spawn as veterans instead. Empty on the synthetic sandbox content (it declares no
 * requirements), keeping the headless twin byte-identical.
 */
export function gatherMasteryExperience(sim: Simulation): ReadonlyArray<readonly [number, number]> {
  return gatherMasteryExperienceFor(sim.content, PRIMARY_TRIBE);
}

/** {@link gatherMasteryExperience} over an explicit content + tribe — the shared core the decoded-map
 *  entry reuses for its authored humans (per-placement tribes, no sim yet at resolve time). */
export function gatherMasteryExperienceFor(
  content: ContentSet,
  tribe: number,
): ReadonlyArray<readonly [number, number]> {
  const tribeType = content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return [];
  const gathered = new Set(GATHERERS.map((g) => g.good));
  const byTrack = new Map<number, number>();
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== 'good' || !gathered.has(req.targetId)) continue;
    const track = req.experienceTypes[0];
    if (track === undefined) continue;
    byTrack.set(track, Math.max(byTrack.get(track) ?? 0, req.amount));
  }
  return [...byTrack].sort((a, b) => a[0] - b[0]);
}
