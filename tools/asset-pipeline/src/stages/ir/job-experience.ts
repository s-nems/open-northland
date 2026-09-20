import type { HumanJobExperienceType, TribeType } from '@open-northland/data';

/**
 * Rebinds a specialization whose good was moved to another profession by the mod's `jobEnablesGood`
 * table while `humanjobexperiencetypes.ini` retained the base-game owner. The move is accepted only
 * when every good on the track has the same single active owner. An obsolete source track is retained
 * when that owner already has a specialization for all its goods, preserving stable track ids without
 * creating two tracks for the same `(job, good)` pair.
 */
export function rebindMovedJobExperience(
  tracks: readonly HumanJobExperienceType[],
  tribes: readonly TribeType[],
): HumanJobExperienceType[] {
  const ownersByGood = new Map<number, Set<number>>();
  for (const tribe of tribes) {
    for (const edge of tribe.jobEnables) {
      if (edge.kind !== 'good') continue;
      let owners = ownersByGood.get(edge.targetId);
      if (owners === undefined) {
        owners = new Set<number>();
        ownersByGood.set(edge.targetId, owners);
      }
      owners.add(edge.jobType);
    }
  }

  return tracks.map((track) => {
    if (track.goodTypes.length === 0) return track;
    let candidates: Set<number> | undefined;
    for (const good of track.goodTypes) {
      const owners = ownersByGood.get(good);
      if (owners === undefined || owners.size === 0) return track;
      candidates =
        candidates === undefined
          ? new Set(owners)
          : new Set([...candidates].filter((job) => owners.has(job)));
    }
    if (candidates === undefined || candidates.has(track.jobType) || candidates.size !== 1) return track;
    const [newJobType] = candidates;
    if (newJobType === undefined) return track;

    const destinationAlreadyCovered = tracks.some(
      (other) =>
        other.typeId !== track.typeId &&
        other.jobType === newJobType &&
        track.goodTypes.every((good) => other.goodTypes.includes(good)),
    );
    return destinationAlreadyCovered ? track : { ...track, jobType: newJobType };
  });
}
