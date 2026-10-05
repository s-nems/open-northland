import type { PanelClick } from './pointer-intent.js';

/** The orders a decoded {@link PanelClick} issues. An absent optional handler leaves its button inert. */
export interface PanelClickActions {
  readonly onDemolishPalisade?: (entityId: number) => void;
  readonly onCancelRoadSite?: (entityId: number) => void;
}

export function applyPanelClick(click: PanelClick, actions: PanelClickActions): void {
  switch (click.kind) {
    case 'demolishPalisade':
      actions.onDemolishPalisade?.(click.entityId);
      return;
    case 'cancelRoadSite':
      actions.onCancelRoadSite?.(click.entityId);
      return;
    default: {
      const unreachable: never = click;
      throw new Error(`unhandled panel click: ${JSON.stringify(unreachable)}`);
    }
  }
}
