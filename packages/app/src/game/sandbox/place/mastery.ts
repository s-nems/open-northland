import { type Simulation, systems } from '@open-northland/sim';
import { PRIMARY_TRIBE } from '../../rules.js';
import { GATHERERS } from '../ids/index.js';

/**
 * The starting XP that clears every `needforgood` gate on the sandbox's gatherable goods for
 * {@link PRIMARY_TRIBE}, as `[trackTypeId, points]` pairs. Each `need` requirement sums REPEATS
 * across its named tracks, so granting `rawXpForRepeats(track, amount)` into its FIRST track
 * satisfies it. Real extracted content gates iron/gold behind clay/stone-digging XP
 * (`needforgood 6/7 10` over tracks 4+5) — a fresh collector pinned to an iron camp would never
 * qualify and stands idle beside the deposit. A SCENE-ONLY veteran stamp: curated scenes exist to
 * show their camps working, so their pinned gatherers skip the apprenticeship; decoded maps spawn
 * fresh settlers that earn the gates in play. Empty on the synthetic sandbox content (it declares
 * no requirements), keeping the headless twin byte-identical.
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
