import { aiControlEntity, StalledPlacements } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../ai-shared/cadence.js';
import type { EntryStatus, LineStatuses } from './entries.js';
import { type BuildLineId, type BuildOrder, type StepKey, stepKey } from './entries.js';
import { STALLED_PLACEMENT_RETRY_DECISIONS } from './limits.js';

/**
 * The seat's {@link StalledPlacements} record over one decision: which steps' spot searches wait, and the
 * one holding each line. A seat with no AI carrier (a module run directly) keeps no record and searches
 * every decision. The component is dropped as soon as nothing is pending.
 */
export class StalledSearches {
  private readonly carrier: Entity | null;

  /** `statusOf` answers this decision's status of a step, undefined for a key the order no longer has. */
  constructor(
    private readonly world: World,
    player: number,
    statusOf: (key: StepKey) => EntryStatus | undefined,
  ) {
    this.carrier = aiControlEntity(world, player);
    const record = this.read();
    if (record === undefined) return;
    // A step that stands met or skipped searches nothing: its wait goes, so a later regression of it
    // searches at once.
    for (const key of [...record.retryTicks.keys()]) {
      if (statusOf(key) !== 'unmet') this.forget(key);
    }
  }

  /** Whether the step still waits for its retry tick. */
  waits(line: BuildLineId, step: number, tick: number): boolean {
    const retry = this.read()?.retryTicks.get(stepKey(line, step));
    return retry !== undefined && tick < retry;
  }

  /** Record a search of the step: a spot found clears its wait; none found arms the retry and, when the
   *  step `holds` its line, marks it the line's holding one. */
  searched(line: BuildLineId, step: number, tick: number, found: boolean, holds: boolean): void {
    if (this.carrier === null) return;
    const key = stepKey(line, step);
    if (found) {
      this.forget(key);
      return;
    }
    const retryTick = tick + STALLED_PLACEMENT_RETRY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS;
    const record = this.read();
    if (record === undefined) {
      this.world.add(this.carrier, StalledPlacements, {
        retryTicks: new Map([[key, retryTick]]),
        holding: holds ? new Map([[line, key]]) : new Map(),
      });
      return;
    }
    const live = this.world.mut(this.carrier, StalledPlacements);
    live.retryTicks.set(key, retryTick);
    if (holds) live.holding.set(line, key);
  }

  /** The line acts on the step now: the line's earlier holder's wait goes with its hold, since the room it
   *  lacked may be what the step now acting frees or fills. Other lines' holds stay. */
  acting(line: BuildLineId, step: number): void {
    const holding = this.read()?.holding.get(line);
    if (holding !== undefined && holding !== stepKey(line, step)) this.forget(holding);
  }

  private read():
    | Readonly<{
        retryTicks: ReadonlyMap<StepKey, number>;
        holding: ReadonlyMap<BuildLineId, StepKey>;
      }>
    | undefined {
    return this.carrier === null ? undefined : this.world.tryGet(this.carrier, StalledPlacements);
  }

  private forget(key: StepKey): void {
    const record = this.read();
    if (this.carrier === null || record === undefined || !record.retryTicks.has(key)) return;
    if (record.retryTicks.size <= 1) {
      this.world.remove(this.carrier, StalledPlacements);
      return;
    }
    const live = this.world.mut(this.carrier, StalledPlacements);
    live.retryTicks.delete(key);
    for (const [line, held] of live.holding) if (held === key) live.holding.delete(line);
  }
}

/** Every step's status by its {@link StepKey}, built only when a stalled-search record asks. */
export function keyedStatuses(
  order: BuildOrder,
  statuses: LineStatuses,
): (key: StepKey) => EntryStatus | undefined {
  let byKey: Map<StepKey, EntryStatus> | undefined;
  return (key) => {
    if (byKey === undefined) {
      byKey = new Map();
      for (const line of order.lines) {
        for (const [step, status] of (statuses.get(line.id) ?? []).entries())
          byKey.set(stepKey(line.id, step), status);
      }
    }
    return byKey.get(key);
  };
}
