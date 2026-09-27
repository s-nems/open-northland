import type { PanelClick } from './pointer-intent.js';

/** The orders a decoded {@link PanelClick} issues. An absent optional handler leaves its button inert. */
export interface PanelClickActions {
  readonly onDemolishSignpost: (entityId: number) => void;
  readonly onDemolishPalisade?: (entityId: number) => void;
  readonly onSetPalisadeGate?: (entityId: number, open: boolean) => void;
}

export function applyPanelClick(click: PanelClick, actions: PanelClickActions): void {
  switch (click.kind) {
    case 'demolishSignpost':
      actions.onDemolishSignpost(click.entityId);
      return;
    case 'demolishPalisade':
      actions.onDemolishPalisade?.(click.entityId);
      return;
    case 'setPalisadeGate':
      actions.onSetPalisadeGate?.(click.entityId, click.open);
      return;
    default: {
      const unreachable: never = click;
      throw new Error(`unhandled panel click: ${JSON.stringify(unreachable)}`);
    }
  }
}
