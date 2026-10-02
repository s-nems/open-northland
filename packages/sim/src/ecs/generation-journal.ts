import type { Component, Entity } from './component.js';

/** Ops retained per journal: a consumer more than this many generations behind rebuilds from scratch. */
export const GENERATION_JOURNAL_LIMIT = 1024;

/** One store's retained ops, a ring over the last {@link GENERATION_JOURNAL_LIMIT}: the op that bumped the
 *  journaled generation to `g` sits at slot `(g - 1) % LIMIT`. Allocated once, so recording never grows it. */
interface GenerationJournal {
  /** The generation journaling started at; nothing before it is replayable. */
  readonly start: number;
  /** The generation the last recorded op bumped the store to. */
  head: number;
  readonly entities: Int32Array;
}

/**
 * The per-component op journals an incremental index replays instead of rebuilding on every bump of one
 * generation counter (membership or value writes), indexed by {@link Component.id}. Only components
 * passed to {@link start} are journaled; the rest pay one array read.
 */
export class GenerationJournals {
  private readonly byComponent: Array<GenerationJournal | undefined> = [];

  /** Idempotent; a new journal starts at `generation`, so nothing before it is replayable. */
  start(component: Component<unknown>, generation: number): void {
    if (this.byComponent[component.id] === undefined) {
      this.byComponent[component.id] = {
        start: generation,
        head: generation,
        entities: new Int32Array(GENERATION_JOURNAL_LIMIT),
      };
    }
  }

  record(component: Component<unknown>, entity: Entity): void {
    const journal = this.byComponent[component.id];
    if (journal === undefined) return;
    journal.entities[journal.head % GENERATION_JOURNAL_LIMIT] = entity;
    journal.head++;
  }

  /**
   * The entities recorded for `component` since generation `since`, in mutation order, or `null` when the
   * journal cannot cover that span (never journaled, or `since` predates the retained window), in which case
   * the caller must rebuild from the store. One entity may appear more than once; replay must be idempotent
   * per entry.
   */
  deltasSince(component: Component<unknown>, since: number): readonly Entity[] | null {
    const journal = this.byComponent[component.id];
    if (
      journal === undefined ||
      since < journal.start ||
      since < journal.head - GENERATION_JOURNAL_LIMIT ||
      since > journal.head
    ) {
      return null;
    }
    const out: Entity[] = [];
    for (let g = since; g < journal.head; g++)
      out.push(journal.entities[g % GENERATION_JOURNAL_LIMIT] as Entity);
    return out;
  }
}
