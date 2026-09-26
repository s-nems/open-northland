import type { VehicleOrder } from './model/index.js';
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
  /** Enter "add a house to the trade route" pick mode for the selected trader. */
  readonly onAttachTradeHouse?: (settlerId: number) => void;
  readonly onDetachTradeHouse?: (settlerId: number, house: number) => void;
  readonly onSetTradeImport?: (settlerId: number, house: number, goodType: number, on: boolean) => void;
  /** Trade on the agreement at `agreement` in the map's table; -1 drops the choice. */
  readonly onSetTradeAgreement?: (settlerId: number, agreement: number) => void;
  /** Select the settler or vehicle a crew row names, as a click on it in the world would. */
  readonly onSelectEntity?: (entityId: number) => void;
  /** One of the vehicle window's order buttons; the spot and target orders arm a pick mode. */
  readonly onVehicleOrder?: (vehicleId: number, order: VehicleOrder) => void;
  /** Ask for `amount` units of `goodType` in the vehicle's hold (`setVehicleWanted`). */
  readonly onSetVehicleWanted?: (vehicleId: number, goodType: number, amount: number) => void;
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
    case 'attachTradeHouse':
      actions.onAttachTradeHouse?.(click.entityId);
      return;
    case 'detachTradeHouse':
      actions.onDetachTradeHouse?.(click.entityId, click.house);
      return;
    case 'setTradeImport':
      actions.onSetTradeImport?.(click.entityId, click.house, click.goodType, click.on);
      return;
    case 'setTradeBalance':
      // A mark kept for the balance is cleared first, so it sheds the one-way limits a balanced flow
      // does not show (the settler panel's direction strip does the same).
      for (const house of click.houses) {
        if (click.on) actions.onSetTradeImport?.(click.entityId, house, click.goodType, false);
        actions.onSetTradeImport?.(click.entityId, house, click.goodType, click.on);
      }
      return;
    case 'setTradeAgreement':
      actions.onSetTradeAgreement?.(click.entityId, click.agreement);
      return;
    case 'selectEntity':
      actions.onSelectEntity?.(click.entityId);
      return;
    case 'vehicleOrder':
      actions.onVehicleOrder?.(click.entityId, click.order);
      return;
    case 'setVehicleWanted':
      actions.onSetVehicleWanted?.(click.entityId, click.goodType, click.amount);
      return;
    default: {
      const unreachable: never = click;
      throw new Error(`unhandled panel click: ${JSON.stringify(unreachable)}`);
    }
  }
}
