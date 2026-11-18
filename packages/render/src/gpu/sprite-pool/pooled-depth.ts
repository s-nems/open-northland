import { type DrawItem, drawPassOf, screenDepth } from '../../data/scene/index.js';
import { signpostBoardSteps } from '../../data/scene/signpost-boards.js';
import { PLOT_BOUNDS } from '../placement/plan-road.js';
import type { PooledEntity } from './pooled-entity.js';

/**
 * A pooled entity's painter depth, the feet-anchor screen y plus a small deterministic x tiebreak, the
 * same key the tall map objects use, so a settler and the tree it walks behind sort into one painter
 * order. Adding back `item.lift` restores the pre-lift y, so occlusion sorts by map row while the
 * sprite rides the hill. An unclaimed road plot and goods on the ground paint in passes of their own
 * ({@link drawPassOf}); a claimed plot keeps its flag among the standing sprites but sorts at the
 * plot's back edge, so a walker on the plot is never painted under its stones. The flag then covers a
 * walker at most the plot's half-depth behind its pole.
 *
 * Both the pool's present and the occlusion ghost scan call this over the item being drawn and the
 * entity's drawn motion, so both read the depth this frame sorts at - a container's kept `zIndex`
 * lags behind a still frame's re-placed entity.
 */
export function pooledDepth(pe: PooledEntity, item: DrawItem): number {
  const plotBack = item.roadSite === 'claimed' ? PLOT_BOUNDS.top : 0;
  const row = item.sortY ?? pe.motion.drawY + (item.lift ?? 0);
  return screenDepth(
    pe.motion.drawX,
    row + plotBack,
    item.kind,
    drawPassOf(item),
    item.boardIndex === undefined ? 0 : signpostBoardSteps(item.boardIndex),
  );
}
