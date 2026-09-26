import { aiPlayerEntity, StalledPlacements } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { AI_DECISION_INTERVAL_TICKS } from '../cadence.js';
import { STALLED_PLACEMENT_RETRY_DECISIONS } from './entries.js';
import type { EntryStatus } from './progress.js';

/**
 * The seat's {@link StalledPlacements} record over one decision: which entries' spot searches wait, and
 * the one holding the list. A seat with no AI carrier (a module run directly) keeps no record and searches
 * every decision. The component is dropped as soon as nothing is pending.
 */
export class StalledSearches {
  private readonly carrier: Entity | null;

  constructor(
    private readonly world: World,
    player: number,
    statuses: readonly EntryStatus[],
  ) {
    this.carrier = aiPlayerEntity(world, player);
    const record = this.read();
    if (record === undefined) return;
    // An entry that stands met or skipped searches nothing: its wait goes, so a later regression of it
    // searches at once.
    for (const entryIndex of [...record.retryTicks.keys()]) {
      if (statuses[entryIndex] !== 'unmet') this.forget(entryIndex);
    }
  }

  /** Whether `entryIndex` still waits for its retry tick. */
  waits(entryIndex: number, tick: number): boolean {
    const retry = this.read()?.retryTicks.get(entryIndex);
    return retry !== undefined && tick < retry;
  }

  /** Record a search of `entryIndex`: a spot found clears its wait; none found arms the retry and, when
   *  the entry `holds` the list, marks it the holding one. */
  searched(entryIndex: number, tick: number, found: boolean, holds: boolean): void {
    if (this.carrier === null) return;
    if (found) {
      this.forget(entryIndex);
      return;
    }
    const retryTick = tick + STALLED_PLACEMENT_RETRY_DECISIONS * AI_DECISION_INTERVAL_TICKS;
    const record = this.read();
    if (record === undefined) {
      this.world.add(this.carrier, StalledPlacements, {
        retryTicks: new Map([[entryIndex, retryTick]]),
        holding: holds ? entryIndex : null,
      });
      return;
    }
    const live = this.world.mut(this.carrier, StalledPlacements);
    live.retryTicks.set(entryIndex, retryTick);
    if (holds) live.holding = entryIndex;
  }

  /** The list acts on `entryIndex` now: an earlier holder's wait goes with its hold, since the room it
   *  lacked may be what the entry now acting frees or fills. */
  acting(entryIndex: number): void {
    const holding = this.read()?.holding ?? null;
    if (holding !== null && holding !== entryIndex) this.forget(holding);
  }

  private read(): Readonly<{ retryTicks: ReadonlyMap<number, number>; holding: number | null }> | undefined {
    return this.carrier === null ? undefined : this.world.tryGet(this.carrier, StalledPlacements);
  }

  private forget(entryIndex: number): void {
    const record = this.read();
    if (this.carrier === null || record === undefined) return;
    if (!record.retryTicks.has(entryIndex) && record.holding !== entryIndex) return;
    if (record.retryTicks.size <= (record.retryTicks.has(entryIndex) ? 1 : 0)) {
      this.world.remove(this.carrier, StalledPlacements);
      return;
    }
    const live = this.world.mut(this.carrier, StalledPlacements);
    live.retryTicks.delete(entryIndex);
    if (live.holding === entryIndex) live.holding = null;
  }
}
