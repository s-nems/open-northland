import type { Component, Entity } from './component.js';

/** Retained span length past which the oldest span is dropped (`base` advances) instead of growing forever:
 *  a consumer further behind rebuilds from scratch. Generous versus real churn, since an incremental index
 *  catches up within the same dispatch loop, typically a handful of ops behind. */
export const MEMBERSHIP_JOURNAL_LIMIT = 1024;

/** One store's retained ops: entry `i` is the entity whose add/remove/destroy bumped that store's
 *  generation to `base + i + 1`. */
interface MembershipJournal {
  base: number;
  entities: Entity[];
}

/**
 * The membership-op journals an incremental index replays instead of rebuilding on every generation bump.
 * Only components passed to {@link start} are journaled; the rest pay nothing.
 */
export class MembershipJournals {
  private readonly byComponent = new Map<Component<unknown>, MembershipJournal>();

  /** Idempotent; a new journal starts at `generation`, so nothing before it is replayable. */
  start(component: Component<unknown>, generation: number): void {
    if (!this.byComponent.has(component)) {
      this.byComponent.set(component, { base: generation, entities: [] });
    }
  }

  record(component: Component<unknown>, entity: Entity): void {
    const journal = this.byComponent.get(component);
    if (journal === undefined) return;
    if (journal.entities.length >= MEMBERSHIP_JOURNAL_LIMIT) {
      journal.base += journal.entities.length;
      journal.entities.length = 0;
    }
    journal.entities.push(entity);
  }

  /**
   * The entities recorded for `component` since generation `since`, in mutation order, or `null` when the
   * journal cannot cover that span (never journaled, or `since` predates the retained window), in which case
   * the caller must rebuild from the store. One entity may appear more than once; replay must be idempotent
   * per entry.
   */
  deltasSince(component: Component<unknown>, since: number): readonly Entity[] | null {
    const journal = this.byComponent.get(component);
    if (journal === undefined || since < journal.base || since > journal.base + journal.entities.length) {
      return null;
    }
    return journal.entities.slice(since - journal.base);
  }
}
