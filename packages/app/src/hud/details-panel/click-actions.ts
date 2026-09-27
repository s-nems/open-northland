import type { PanelClick } from './pointer-intent.js';

/** The orders a decoded {@link PanelClick} issues. An absent optional handler leaves its button inert. */
export interface PanelClickActions {
  readonly onDemolish: (entityId: number) => void;
  /** Begin upgrading the selected building into its next level - the Upgrade button (housewindow 110). */
  readonly onUpgrade: (entityId: number) => void;
  /** Abort the selected building's running upgrade - the Cancel button (housewindow 112). */
  readonly onCancelUpgrade: (entityId: number) => void;
  readonly onDemolishSignpost: (entityId: number) => void;
  readonly onDemolishPalisade?: (entityId: number) => void;
  readonly onSetPalisadeGate?: (entityId: number, open: boolean) => void;
  /** Raise or lower the alarm on the selected garrison building - the Obrona window's shield toggle. */
  readonly onSetDefenceMode: (entityId: number, enabled: boolean) => void;
  readonly onSetHouseholdGoodUse: (
    player: number,
    effect: 'cooking' | 'rest' | 'piety',
    allowed: boolean,
  ) => void;
  readonly onCenterOnEntity: (entityId: number) => void;
}

/** `stockTab` is panel-local view state, so it takes its own handler rather than an order in
 *  {@link PanelClickActions}. */
export function applyPanelClick(
  click: PanelClick,
  actions: PanelClickActions,
  selectStockTab: (tab: number) => void,
): void {
  switch (click.kind) {
    case 'centerOnEntity':
      actions.onCenterOnEntity(click.entityId);
      return;
    case 'stockTab':
      selectStockTab(click.tab);
      return;
    case 'upgrade':
      actions.onUpgrade(click.entityId);
      return;
    case 'cancelUpgrade':
      actions.onCancelUpgrade(click.entityId);
      return;
    case 'demolish':
      actions.onDemolish(click.entityId);
      return;
    case 'setDefenceMode':
      actions.onSetDefenceMode(click.entityId, click.enabled);
      return;
    case 'setHouseholdGoodUse':
      actions.onSetHouseholdGoodUse(click.player, click.effect, click.allowed);
      return;
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
