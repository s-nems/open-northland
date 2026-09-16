import type { UiCue } from '@open-northland/audio';
import { matchesMouseBinding } from '../../hud/keybindings.js';
import { type Tile, worldToTile } from '../picking.js';
import type { UnitOrderController } from './orders.js';
import { type PickModeController, pickPressCue } from './pick-mode.js';

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
  readonly workFlagBinding: () => string | null;
  /** The GUI click: an order that commanded someone confirms, a called-off pick fails. Absent, silent. */
  readonly cue?: (cue: UiCue) => void;
}

/** True when the press became an order, so the overview must not also scroll the view to it. */
export type OverviewPress = (worldX: number, worldY: number, event: MouseEvent) => boolean;

export function createOverviewOrders(deps: OverviewOrderDeps): OverviewPress {
  const confirmIf = (ordered: boolean): void => {
    if (ordered) deps.cue?.('confirm');
  };
  return (worldX, worldY, event) => {
    // The flat inverse: the overview plots the map without the world view's terrain lift.
    const target: Tile = worldToTile(worldX, worldY);
    const pick = deps.pickMode.handleOverviewPress(event.button, target);
    if (pick !== null) {
      const cue = pickPressCue(pick);
      if (cue !== null) deps.cue?.(cue);
      return true;
    }
    if (matchesMouseBinding(event, deps.workFlagBinding())) {
      confirmIf(deps.orders().issueSetWorkFlag(target));
      return true;
    }
    if (event.button !== 2) return false;
    // The press is the overview's whether or not anyone was free to walk; the click follows the order.
    confirmIf(deps.orders().issueMoveTo(target));
    return true;
  };
}
