import type { ContentSet, WeaponType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { isFighterJob, isScoutJob } from './jobs.js';

/** The house bow of `tribe` - the extracted `weapons.ini` type 20 (`jobtype 6`, the civilist base trade),
 *  or undefined when the content declares none, in which case a garrison shelters unarmed. A sheltering
 *  settler keeps its own trade, so the bow binds by weapon id, not the `(tribe, job)` class lookup. */
export function houseBow(content: ContentSet, tribe: number): WeaponType | undefined {
  return contentIndex(content).houseBowByTribe.get(tribe);
}

/** How many civilians a building type shelters in defence mode (`BuildingType.shelterCapacity`), `0` for a
 *  type that has no defence mode and for an unknown type. */
export function shelterCapacityOf(content: ContentSet, buildingType: number): number {
  return contentIndex(content).buildings.get(buildingType)?.shelterCapacity ?? 0;
}

/** Whether a settler of `jobType` runs for cover when the alarm goes up. Authored: everyone hides but the
 *  fighters and the scout. Babies and children hide with the rest; `defence/manning.ts` is what keeps a
 *  bow out of their hands. */
export function sheltersOnAlarm(content: ContentSet, jobType: number | null): boolean {
  return !isFighterJob(content, jobType) && !isScoutJob(content, jobType);
}
