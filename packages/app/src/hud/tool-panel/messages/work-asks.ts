import type { WorkStatus } from '@open-northland/sim';

/** Asks about workers' diagnoses one sweep may send to the sim, the stall and idle notes together. A
 *  gatherer's diagnosis runs a harvest search of up to 128 candidates on the sim's thread, so this caps
 *  that cost per sweep however many workers stand; a worker past it is asked on a later sweep. */
export const WORK_STATUS_ASKS_PER_SWEEP = 32;

/** Sweeps between two asks about one worker: an answer stays the note's reason this long before the
 *  sim is asked again, and an ask that never landed is sent again after it. */
export const WORK_STATUS_REASK_SWEEPS = 5;

/** One landed diagnosis and the ask it answers: `status` is undefined when nothing stands in the
 *  worker's way, `asked` the tick of the sweep that asked. */
export interface WorkAnswer {
  readonly status: WorkStatus | undefined;
  readonly asked: number;
}

/** The sim's diagnosis of a worker (`Simulation.workStatus`) for the ask a sweep made on tick `asked`;
 *  a new tick asks again. Undefined until an answer lands; it may be an earlier ask's answer meanwhile. */
export type WorkStatusRead = (entity: number, asked: number) => WorkAnswer | undefined;

interface AskWatch {
  /** The tick and sweep of the last ask, null before the first. */
  askedAt: number | null;
  askedSweep: number;
  /** The newest answer that landed for one of this watch's asks. */
  answer: WorkAnswer | undefined;
}

/**
 * Which workers' diagnoses the sweeps ask for, and when: the first read of a worker asks at once, then
 * every {@link WORK_STATUS_REASK_SWEEPS} sweeps, never more than {@link WORK_STATUS_ASKS_PER_SWEEP} asks
 * a sweep. A worker no read touched in a sweep is forgotten, so its next read asks afresh.
 */
export class WorkStatusAsks {
  private watches = new Map<number, AskWatch>();
  private next = new Map<number, AskWatch>();
  private sweep = 0;
  private tick = 0;
  private budget = 0;

  constructor(private readonly read: WorkStatusRead) {}

  begin(tick: number): void {
    this.next = new Map();
    this.sweep++;
    this.tick = tick;
    this.budget = WORK_STATUS_ASKS_PER_SWEEP;
  }

  /** The newest landed answer about `entity`, asking anew when one is due and the sweep has room;
   *  undefined while none has landed since the worker was last forgotten. */
  status(entity: number): WorkAnswer | undefined {
    // A second read in one sweep neither asks nor reads again.
    const read = this.next.get(entity);
    if (read !== undefined) return read.answer;
    const watch = this.watches.get(entity) ?? { askedAt: null, askedSweep: 0, answer: undefined };
    this.next.set(entity, watch);
    const answered = watch.answer !== undefined && watch.answer.asked === watch.askedAt;
    if (watch.askedAt !== null && !answered) this.land(entity, watch);
    const due = watch.askedAt === null || this.sweep - watch.askedSweep >= WORK_STATUS_REASK_SWEEPS;
    if (due && this.budget > 0) {
      this.budget--;
      watch.askedAt = this.tick;
      watch.askedSweep = this.sweep;
      this.land(entity, watch);
    }
    return watch.answer;
  }

  end(): void {
    this.watches = this.next;
  }

  /** Read the outstanding ask, keeping an answer only when it answers this watch's latest ask. */
  private land(entity: number, watch: AskWatch): void {
    if (watch.askedAt === null) return;
    const landed = this.read(entity, watch.askedAt);
    if (landed !== undefined && landed.asked === watch.askedAt) watch.answer = landed;
  }
}
