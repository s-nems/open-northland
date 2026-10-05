import { networkInventoryOf, stockCounts } from '@open-northland/render/data';
import type { WorldSnapshot } from '@open-northland/sim';
import { ownerPlayerOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { pickableSeat } from '../../../game/viewer-seat.js';
import { goodCategoryTab } from '../../good-categories.js';
import { goodDef, goodLabel, type UnitPanelModelContext } from './context.js';

export interface NetworkStockRow {
  readonly goodType: number;
  readonly goodId: string | undefined;
  readonly label: string;
  readonly category: number;
  readonly amount: number;
}

export interface SignpostPanelModel {
  readonly kind: 'signpost';
  readonly entityId: number;
  readonly postCount: number;
  readonly stock: readonly NetworkStockRow[];
  readonly canDemolish: boolean;
}

export function signpostPanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  entity: SnapshotEntity,
): SignpostPanelModel | { readonly kind: 'empty' } {
  const seat = ctx.viewer === undefined ? null : pickableSeat(ctx.viewer);
  if (seat !== null && ownerPlayerOf(entity) !== seat) return { kind: 'empty' };
  const network = networkInventoryOf(snapshot, entity.id);
  const stock = stockCounts(network?.stock ?? new Map()).map(({ goodType, amount }) => {
    const goodId = goodDef(ctx, goodType)?.id;
    return {
      goodType,
      goodId,
      amount,
      label: goodLabel(ctx, goodType),
      category: goodCategoryTab(goodId ?? ''),
    };
  });
  return {
    kind: 'signpost',
    entityId: entity.id,
    postCount: network?.postCount ?? 1,
    stock,
    canDemolish: true,
  };
}
