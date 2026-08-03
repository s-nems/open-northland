import { type Simulation, systems } from '@open-northland/sim';
import { PRIMARY_TRIBE } from '../../rules.js';
import { GATHERERS } from '../ids/index.js';

/**
 * The starting XP that clears every `needforgood` gate on the primary tribe's gatherable goods, as
 * `[trackTypeId, points]` pairs. A `need` requirement sums repeats across its named tracks, so granting
 * the whole amount into its first track satisfies it. Scene-only: curated scenes show their camps
 * working, while decoded maps spawn fresh settlers that earn gates like `needforgood 6/7 10` in play.
 */
export function gatherMasteryExperience(sim: Simulation): ReadonlyArray<readonly [number, number]> {
  const tribeType = sim.content.tribes.find((t) => t.typeId === PRIMARY_TRIBE);
  if (tribeType === undefined) return [];
  const gathered = new Set(GATHERERS.map((g) => g.good));
  const byTrack = new Map<number, number>();
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== 'good' || !gathered.has(req.targetId)) continue;
    const trackId = req.experienceTypes[0];
    if (trackId === undefined) continue;
    const track = sim.content.jobExperience.find((t) => t.typeId === trackId);
    byTrack.set(trackId, Math.max(byTrack.get(trackId) ?? 0, systems.rawXpForRepeats(track, req.amount)));
  }
  return [...byTrack].sort((a, b) => a[0] - b[0]);
}
