import { type Tile, worldToTile } from '../picking.js';
import type { UnitOrderController } from './orders.js';
import type { PickModeController } from './pick-mode.js';

/**
 * Orders named on the map overview rather than the world view: it draws the map flat and its dots are
 * coarser than any sprite, so a press there names ground and never the thing standing on it. The right
 * button walks the selection to the spot; an armed spot-target mode resolves at it.
 *
 * Named addition: the original's overview window only scrolls the view.
 */

export interface OverviewOrderDeps {
  readonly pickMode: Pick<PickModeController, 'handleOverviewPress'>;
  /** Read at press time; the order controller is built after the pick mode it resolves through. */
  readonly orders: () => UnitOrderController;
}

/** True when the press became an order, so the overview must not also scroll the view to it. */
export type OverviewPress = (worldX: number, worldY: number, event: MouseEvent) => boolean;

export function createOverviewOrders(deps: OverviewOrderDeps): OverviewPress {
  return (worldX, worldY, event) => {
    // The flat inverse: the overview plots the map without the world view's terrain lift.
    const target: Tile = worldToTile(worldX, worldY);
    if (deps.pickMode.handleOverviewPress(event.button, target)) return true;
    if (event.button !== 2) return false;
    if (event.ctrlKey || event.metaKey) deps.orders().issueSetWorkFlag(target);
    else deps.orders().issueMoveTo(target);
    return true;
  };
}
