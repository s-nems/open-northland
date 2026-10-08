import type { WorkStatus } from '@open-northland/sim';

/** Asks one sweep may send to the sim per read, the stall and idle notes together on the worker read. A
 *  gatherer's diagnosis runs a harvest search of up to 128 candidates on the sim's thread, so this caps
 *  that cost per sweep however many workers stand; a worker past it is asked on a later sweep. */
export const WORK_STATUS_ASKS_PER_SWEEP = 32;

/** Sweeps between two asks about one worker: an answer stays the note's reason this long before the
 *  sim is asked again, and an ask that never landed is sent again after it. */
export const WORK_STATUS_REASK_SWEEPS = 5;

/** One landed answer and the ask it answers: `status` is the sim's answer, undefined when nothing stands
 *  in the way, `asked` the tick of the sweep that asked. */
export interface StatusAnswer<S> {
  readonly status: S | undefined;
  readonly asked: number;
}

/** The sim's answer about an entity for the ask a sweep made on tick `asked`; a new tick asks again.
 *  Undefined until an answer lands; it may be an earlier ask's answer meanwhile. */
export type StatusRead<S> = (entity: number, asked: number) => StatusAnswer<S> | undefined;

/** A worker's diagnosis (`Simulation.workStatus`), as the stall and idle notes read it. */
export type WorkAnswer = StatusAnswer<WorkStatus>;
export type WorkStatusRead = StatusRead<WorkStatus>;

/** When the entity was last asked, never asked sorting first. */
function ageOf<S>(watch: AskWatch<S>): number {
  return watch.askedAt === null ? -1 : watch.askedSweep;
}

interface AskWatch<S> {
  /** The tick and sweep of the last ask, null before the first. */
  askedAt: number | null;
  askedSweep: number;
  /** The newest answer that landed for one of this watch's asks. */
  answer: StatusAnswer<S> | undefined;
}

/**
 * Which entities' answers the sweeps ask the sim for, and when: the first read of an entity asks at once,
 * then every {@link WORK_STATUS_REASK_SWEEPS} sweeps, never more than {@link WORK_STATUS_ASKS_PER_SWEEP}
 * asks a sweep. A sweep grants the next one's asks to the entities it read that are due by then, the
 * longest unasked first, never asked ahead of all; the rest ask only in the room the granted leave. So
 * a crowd past the budget stretches every entity's re-ask alike instead of starving the ones read last.
 * An entity no read touched in a sweep is forgotten, so its next read asks afresh. One instance per
 * read, each with its own budget.
 */
export class StatusAsks<S> {
  private watches = new Map<number, AskWatch<S>>();
  private next = new Map<number, AskWatch<S>>();
  private sweep = 0;
  private tick = 0;
  private budget = 0;
  /** Entities the previous sweep granted an ask this sweep, and the asks kept for the ones still to be
   *  read; the budget never drops below that reserve for an ungranted ask. */
  private granted = new Set<number>();
  private reserved = 0;

  constructor(private readonly read: StatusRead<S>) {}

  begin(tick: number): void {
    this.next = new Map();
    this.sweep++;
    this.tick = tick;
    this.budget = WORK_STATUS_ASKS_PER_SWEEP;
    this.reserved = this.granted.size;
  }

  /** The newest landed answer about `entity`, asking anew when one is due and the sweep has room;
   *  undefined while none has landed since the entity was last forgotten. */
  status(entity: number): StatusAnswer<S> | undefined {
    // A second read in one sweep neither asks nor reads again.
    const read = this.next.get(entity);
    if (read !== undefined) return read.answer;
    const watch = this.watches.get(entity) ?? { askedAt: null, askedSweep: 0, answer: undefined };
    this.next.set(entity, watch);
    const answered = watch.answer !== undefined && watch.answer.asked === watch.askedAt;
    if (watch.askedAt !== null && !answered) this.land(entity, watch);
    const granted = this.granted.has(entity);
    const room = granted ? this.budget > 0 : this.budget > this.reserved;
    if (this.isDue(watch, this.sweep) && room) {
      this.budget--;
      if (granted) this.reserved--;
      watch.askedAt = this.tick;
      watch.askedSweep = this.sweep;
      this.land(entity, watch);
    }
    return watch.answer;
  }

  /** Grant the next sweep's asks to the entities read this sweep that will be due by then, the longest
   *  unasked first; ties keep the order they were read in. */
  end(): void {
    this.watches = this.next;
    const due: [entity: number, watch: AskWatch<S>][] = [];
    for (const [entity, watch] of this.next) {
      if (this.isDue(watch, this.sweep + 1)) due.push([entity, watch]);
    }
    due.sort((a, b) => ageOf(a[1]) - ageOf(b[1]));
    this.granted = new Set(due.slice(0, WORK_STATUS_ASKS_PER_SWEEP).map(([entity]) => entity));
  }

  private isDue(watch: AskWatch<S>, sweep: number): boolean {
    return watch.askedAt === null || sweep - watch.askedSweep >= WORK_STATUS_REASK_SWEEPS;
  }

  /** Read the outstanding ask, keeping an answer only when it answers this watch's latest ask. */
  private land(entity: number, watch: AskWatch<S>): void {
    if (watch.askedAt === null) return;
    const landed = this.read(entity, watch.askedAt);
    if (landed !== undefined && landed.asked === watch.askedAt) watch.answer = landed;
  }
}
