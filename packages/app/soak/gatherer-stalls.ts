/**
 * The gatherer soak's pure half: per-sample gatherer observations in, the stalled-collector report
 * out. Kept free of sim construction and I/O so it unit-tests without running a world
 * (`test/gatherer-stalls.test.ts`, in the normal suite) — the observing half lives in
 * `gatherers.soak.ts`.
 *
 * A "stall" here is the idle-loop signature the soak hunts: a settler that holds a gatherer trade
 * yet neither swings a harvest atomic nor carries a load for a long stretch of game time. That is
 * deliberately behavioural, not causal — the shape field only classifies what the world looked like
 * while it happened, and the diagnosis is the reader's job.
 */

/** One gatherer's state at one sample tick. */
export interface GathererSample {
  readonly entity: number;
  readonly player: number;
  /** The gatherer trade it holds. */
  readonly jobType: number | null;
  /** The good the collector is pinned to (`WorkFlag.goodType` / `GatherSelection`), or null when it
   *  forages every good its trade allows. */
  readonly goodType: number | null;
  /** Whether it is bound to a work flag (the AI's collectors always are). */
  readonly flagged: boolean;
  /** Swinging a harvest atomic or carrying a load — the "it is actually collecting" signal. */
  readonly productive: boolean;
  /** Parked in the stranded-route retry window (`Stranded`) at this sample. */
  readonly stranded: boolean;
}

/** How a stalled gatherer's world looked while it idled — a classification, not a root cause. */
export type StallShape =
  /** Spent most of the stall in the failed-route retry park: it keeps picking a target it cannot walk to. */
  | 'stranded'
  /** Flag-bound and never stranded: its target scan found nothing inside the flag's work area. */
  | 'parkedAtFlag'
  /** Unbound roamer that found no target at all. */
  | 'noTarget';

/** One uninterrupted run of unproductive samples by one gatherer. */
export interface GathererStall {
  readonly entity: number;
  readonly player: number;
  readonly jobType: number | null;
  readonly goodType: number | null;
  /** The first sample tick of the unproductive run — "when it stopped collecting". */
  readonly fromTick: number;
  /** The last sample tick of the run (the end of the soak when it never recovered). */
  readonly toTick: number;
  readonly samples: number;
  readonly shape: StallShape;
  /** Whether the run was still going when the soak ended (never recovered). */
  readonly openAtEnd: boolean;
}

export interface GathererSoakReport {
  readonly ticks: number;
  readonly sampleEveryTicks: number;
  readonly stallTicks: number;
  /** Distinct settlers seen holding a gatherer trade at any sample. */
  readonly gatherersSeen: number;
  /** Stalls, longest first — ties broken by (player, goodType, entity) so the report is stable. */
  readonly stalls: readonly GathererStall[];
}

/** Fraction of a stall's samples that must show `Stranded` for it to be classed a route stall. */
const STRANDED_SHAPE_MAJORITY = 0.5;

interface OpenRun {
  readonly entity: number;
  player: number;
  jobType: number | null;
  goodType: number | null;
  flagged: boolean;
  fromTick: number;
  toTick: number;
  samples: number;
  strandedSamples: number;
}

/**
 * Folds a stream of per-sample gatherer observations into stalls. Feed it one {@link observe} call
 * per sample tick in ascending tick order, then {@link finish}. A gatherer disappearing from a
 * sample (it died, or its trade changed) closes its open run, so a stall is never stitched across a
 * settler that stopped being a collector.
 */
export class StallTracker {
  private readonly open = new Map<number, OpenRun>();
  private readonly closed: GathererStall[] = [];
  private readonly seen = new Set<number>();
  private lastTick = 0;

  /** @param stallTicks the unproductive span (in ticks) at or beyond which a run counts as a stall. */
  constructor(private readonly stallTicks: number) {}

  observe(tick: number, samples: Iterable<GathererSample>): void {
    this.lastTick = tick;
    const present = new Set<number>();
    for (const s of samples) {
      present.add(s.entity);
      this.seen.add(s.entity);
      if (s.productive) {
        this.close(s.entity, false);
        continue;
      }
      let run = this.open.get(s.entity);
      if (run === undefined) {
        run = {
          entity: s.entity,
          player: s.player,
          jobType: s.jobType,
          goodType: s.goodType,
          flagged: s.flagged,
          fromTick: tick,
          toTick: tick,
          samples: 0,
          strandedSamples: 0,
        };
        this.open.set(s.entity, run);
      }
      // The latest classification wins: a collector re-pinned mid-stall is reported as what it is now.
      run.player = s.player;
      run.jobType = s.jobType;
      run.goodType = s.goodType;
      run.flagged = s.flagged;
      run.toTick = tick;
      run.samples++;
      if (s.stranded) run.strandedSamples++;
    }
    for (const entity of [...this.open.keys()]) {
      if (!present.has(entity)) this.close(entity, false);
    }
  }

  /** Close every open run and return the report body, longest stall first. */
  finish(): readonly GathererStall[] {
    for (const entity of [...this.open.keys()]) this.close(entity, true);
    return [...this.closed].sort(
      (a, b) =>
        b.toTick - b.fromTick - (a.toTick - a.fromTick) ||
        a.player - b.player ||
        (a.goodType ?? -1) - (b.goodType ?? -1) ||
        a.entity - b.entity,
    );
  }

  get gatherersSeen(): number {
    return this.seen.size;
  }

  private close(entity: number, openAtEnd: boolean): void {
    const run = this.open.get(entity);
    if (run === undefined) return;
    this.open.delete(entity);
    if (run.toTick - run.fromTick < this.stallTicks) return; // a normal walk-to-the-next-tree gap
    this.closed.push({
      entity: run.entity,
      player: run.player,
      jobType: run.jobType,
      goodType: run.goodType,
      fromTick: run.fromTick,
      toTick: openAtEnd ? this.lastTick : run.toTick,
      samples: run.samples,
      shape:
        run.strandedSamples >= run.samples * STRANDED_SHAPE_MAJORITY
          ? 'stranded'
          : run.flagged
            ? 'parkedAtFlag'
            : 'noTarget',
      openAtEnd,
    });
  }
}

/** The human-readable stall table (stdout). `goodName` renders a pinned good id and `jobName` the
 *  held trade; a collector with no good pin prints `*`. */
export function formatStallReport(
  report: GathererSoakReport,
  goodName: (goodType: number) => string,
  jobName: (jobType: number) => string,
): string {
  const lines = [
    `gatherer soak — ${report.ticks} ticks, sampled every ${report.sampleEveryTicks}`,
    `${report.gatherersSeen} settler(s) held a gatherer trade; ${report.stalls.length} stall(s) of >= ${report.stallTicks} unproductive ticks`,
    '',
    `${'player'.padEnd(7)}${'job'.padEnd(16)}${'good'.padEnd(10)}${'settler'.padStart(8)}${'from'.padStart(8)}${'to'.padStart(8)}${'ticks'.padStart(7)}  shape`,
    '-'.repeat(88),
  ];
  for (const s of report.stalls) {
    const good = s.goodType === null ? '*' : goodName(s.goodType);
    const job = s.jobType === null ? '*' : jobName(s.jobType);
    lines.push(
      `${String(s.player).padEnd(7)}${job.padEnd(16)}${good.padEnd(10)}${String(s.entity).padStart(8)}${String(s.fromTick).padStart(8)}${String(s.toTick).padStart(8)}${String(s.toTick - s.fromTick).padStart(7)}  ${s.shape}${s.openAtEnd ? ' (never recovered)' : ''}`,
    );
  }
  if (report.stalls.length === 0) lines.push('(none)');
  return lines.join('\n');
}
