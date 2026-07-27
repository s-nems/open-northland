import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { canStoreGood } from './stock.js';

/** Tick-local memo for the position-independent question "can any store accept this good?".
 * Actual nearest-store picks still use {@link nearestStoreFor}; this only replaces repeated null
 * probes, so it cannot change a winner. */
export class SinkAvailability {
  private readonly ordinary = new Map<number, boolean>();
  private readonly storageOnly = new Map<number, boolean>();

  constructor(
    private readonly candidates: readonly Entity[],
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {}

  has(goodType: number, excludeProducers = false): boolean {
    const memo = excludeProducers ? this.storageOnly : this.ordinary;
    if (memo.has(goodType)) return memo.get(goodType) === true;
    const available = this.candidates.some((entity) =>
      canStoreGood(this.world, this.ctx, entity, goodType, excludeProducers),
    );
    memo.set(goodType, available);
    return available;
  }
}
