import type { ContentSet, JobType } from '@open-northland/data';
import { isFighterRole, jobRoleOfId } from './jobs.js';

/** The good types backing a weapon or piece of armor (their `goodType`, when present). */
export function militaryGoodTypes(content: ContentSet): ReadonlySet<number> {
  const goods = new Set<number>();
  for (const w of content.weapons) if (w.goodType !== undefined) goods.add(w.goodType);
  for (const a of content.armor) if (a.goodType !== undefined) goods.add(a.goodType);
  return goods;
}

/** Civilian trades inherit bare hands from the readable `civilist` job family. This fallback is an
 * approximation: `weapons.ini` supplies the fist's values but binds it only to the unarmed soldier. */
export function civilianJobTypes(jobs: ReadonlyMap<number, JobType>): ReadonlySet<number> {
  const result = new Set<number>();
  for (const [typeId, row] of jobs) {
    if (isFighterRole(jobRoleOfId(row.id))) continue;
    let job: JobType | undefined = row;
    const seen = new Set<number>();
    while (job !== undefined && !seen.has(job.typeId)) {
      if (job.id === 'civilist') {
        result.add(typeId);
        break;
      }
      seen.add(job.typeId);
      job = job.baseJob === undefined ? undefined : jobs.get(job.baseJob);
    }
  }
  return result;
}
