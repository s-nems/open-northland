import type { Component, Entity } from './component.js';

/** Ops retained per journal: a consumer more than this many generations behind rebuilds from scratch.
 *  Sized so a tick's churn of a busy store, such as path requests added by the planner and removed by
 *  the pathfinder for thousands of settlers, stays replayable. A power of two, like the ring. */
export const GENERATION_JOURNAL_LIMIT = 1 << 14;

/** Slots a new journal's ring holds before it first doubles; a rarely written store stays this small. */
const INITIAL_JOURNAL_CAPACITY = 64;

/** One store's retained ops, a ring over the last `entities.length` of them: the op that bumped the
 *  journaled generation to `g` sits at slot `(g - 1) % entities.length`. The ring doubles while full,
 *  up to {@link GENERATION_JOURNAL_LIMIT}, then overwrites its oldest op. */
interface GenerationJournal {
  /** The generation journaling started at; nothing before it is replayable. */
  readonly start: number;
  /** The generation the last recorded op bumped the store to. */
  head: number;
  entities: Int32Array;
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
        entities: new Int32Array(INITIAL_JOURNAL_CAPACITY),
      };
    }
  }

  record(component: Component<unknown>, entity: Entity): void {
    const journal = this.byComponent[component.id];
    if (journal === undefined) return;
    const capacity = journal.entities.length;
    if (capacity < GENERATION_JOURNAL_LIMIT && journal.head - journal.start >= capacity) grow(journal);
    journal.entities[journal.head % journal.entities.length] = entity;
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
    if (journal === undefined) return null;
    const { entities, head } = journal;
    if (since < journal.start || since < head - entities.length || since > head) return null;
    if (since === head) return NO_DELTAS;
    const out: Entity[] = [];
    for (let g = since; g < head; g++) out.push(entities[g % entities.length] as Entity);
    return out;
  }

  /** {@link deltasSince} handed to `visit` one by one rather than collected: false, visiting nothing,
   *  when the journal cannot cover the span. */
  replaySince(component: Component<unknown>, since: number, visit: (entity: Entity) => void): boolean {
    const journal = this.byComponent[component.id];
    if (journal === undefined) return false;
    const { entities, head } = journal;
    if (since < journal.start || since < head - entities.length || since > head) return false;
    for (let g = since; g < head; g++) visit(entities[g % entities.length] as Entity);
    return true;
  }
}

/** What a caught-up reader gets: shared, so the common empty answer allocates nothing. */
const NO_DELTAS: readonly Entity[] = [];

/** Double a full ring, moving each retained op to its slot in the larger one. */
function grow(journal: GenerationJournal): void {
  const old = journal.entities;
  const next = new Int32Array(Math.min(old.length * 2, GENERATION_JOURNAL_LIMIT));
  for (let g = journal.head - old.length; g < journal.head; g++) {
    next[g % next.length] = old[g % old.length] as number;
  }
  journal.entities = next;
}
