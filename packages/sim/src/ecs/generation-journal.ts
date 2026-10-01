import type { Component, Entity } from './component.js';

/** Retained span length past which the oldest span is dropped (`base` advances) instead of growing
 *  forever; a consumer further behind rebuilds from scratch. */
export const GENERATION_JOURNAL_LIMIT = 1024;

/** One store's retained ops: entry `i` is the entity whose op bumped that store's journaled generation
 *  to `base + i + 1`. The buffer is allocated once at the limit, so recording never grows it. */
interface GenerationJournal {
  base: number;
  readonly entities: Int32Array;
  count: number;
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
        base: generation,
        entities: new Int32Array(GENERATION_JOURNAL_LIMIT),
        count: 0,
      };
    }
  }

  record(component: Component<unknown>, entity: Entity): void {
    const journal = this.byComponent[component.id];
    if (journal === undefined) return;
    if (journal.count >= GENERATION_JOURNAL_LIMIT) {
      journal.base += journal.count;
      journal.count = 0;
    }
    journal.entities[journal.count++] = entity;
  }

  /**
   * The entities recorded for `component` since generation `since`, in mutation order, or `null` when the
   * journal cannot cover that span (never journaled, or `since` predates the retained window), in which case
   * the caller must rebuild from the store. One entity may appear more than once; replay must be idempotent
   * per entry.
   */
  deltasSince(component: Component<unknown>, since: number): readonly Entity[] | null {
    const journal = this.byComponent[component.id];
    if (journal === undefined || since < journal.base || since > journal.base + journal.count) {
      return null;
    }
    const out: Entity[] = [];
    for (let i = since - journal.base; i < journal.count; i++) out.push(journal.entities[i] as Entity);
    return out;
  }
}
