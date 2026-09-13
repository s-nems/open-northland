import type { ContentSet } from '@open-northland/data';
import { Settler } from '../components/index.js';
import type { World } from '../ecs/world.js';
import { MAX_EXPERIENCE_REPEATS } from '../systems/progression/experience.js';

const DUAL_TRACK_CONTENT_REVISION = 11;

/** Older counters stored specializations instead of simultaneously crediting the general track. */
export function migrateProgression(world: World, content: ContentSet, savedRevision: number): void {
  if (
    savedRevision >= DUAL_TRACK_CONTENT_REVISION ||
    content.manifest.contentRevision < DUAL_TRACK_CONTENT_REVISION
  )
    return;
  for (const entity of world.query(Settler)) {
    const experience = world.get(entity, Settler).experience;
    for (const general of content.jobExperience) {
      if (general.goodType !== undefined || general.experienceFactor <= 0) continue;
      let repeats = 0;
      for (const track of content.jobExperience) {
        if (track.jobType !== general.jobType || track.goodType === undefined || track.experienceFactor <= 0)
          continue;
        repeats += Math.trunc((experience.get(track.typeId) ?? 0) / track.experienceFactor);
      }
      if (repeats > 0)
        world
          .mut(entity, Settler)
          .experience.set(
            general.typeId,
            Math.min(
              MAX_EXPERIENCE_REPEATS * general.experienceFactor,
              (experience.get(general.typeId) ?? 0) + repeats * general.experienceFactor,
            ),
          );
    }
  }
}
