import type { JobType } from '@open-northland/data';
import { indexesOf, listedWhere, systems, type WorldSnapshot } from '@open-northland/sim';
import { readPosition } from '../snapshot/index.js';
import { readBehaviourImported, readJobType } from './snapshot-readers/index.js';

/** A person a campaign script points the player at, at its fixed-point snapshot `Position`. */
export interface ImportMarker {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** The humans whose behaviour mask carries the import bit: the few a script marked, so a frame's read
 *  scales with them rather than with the population. */
const IMPORT_MARKED = listedWhere((e) => readBehaviourImported(e.components), 'import markers', {
  values: ['MissionBehaviour'],
});

/**
 * The jobs whose holder never wears the import marker. Original behavior (reading, unconfirmed against
 * the running original): a hero does not wear it, except Xena. Approximation over the job slug: the
 * `heroine_*` class is hers, so only the other hero classes are exempt.
 */
export function importMarkerExemptJobs(jobs: readonly Pick<JobType, 'typeId' | 'id'>[]): ReadonlySet<number> {
  const exempt = new Set<number>();
  for (const job of jobs) {
    if (systems.isHeroJobRow(job) && !job.id.startsWith('heroine')) exempt.add(job.typeId);
  }
  return exempt;
}

/** Every marked person outside `exemptJobs`, ascending by id. Whether he is drawn this frame, and so
 *  whether fog or a roof hides the marker, is the layer's test. */
export function importMarkersOf(snapshot: WorldSnapshot, exemptJobs: ReadonlySet<number>): ImportMarker[] {
  const out: ImportMarker[] = [];
  for (const e of indexesOf(snapshot).get(IMPORT_MARKED)) {
    const job = readJobType(e.components);
    if (job !== undefined && exemptJobs.has(job)) continue;
    const pos = readPosition(e.components);
    if (pos === null) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y });
  }
  return out;
}
