import type { EquipSlotRef } from './layout/index.js';
import type { PanelClick } from './pointer-intent.js';

/** The orders a decoded {@link PanelClick} issues. An absent optional handler leaves its button inert. */
export interface PanelClickActions {
  readonly onDemolish: (entityId: number) => void;
  /** Begin upgrading the selected building into its next level - the Upgrade button (housewindow 110). */
  readonly onUpgrade: (entityId: number) => void;
  /** Abort the selected building's running upgrade - the Cancel button (housewindow 112). */
  readonly onCancelUpgrade: (entityId: number) => void;
  readonly onDemolishSignpost: (entityId: number) => void;
  /** Raise or lower the alarm on the selected garrison building - the Obrona window's shield toggle. */
  readonly onSetDefenceMode: (entityId: number, enabled: boolean) => void;
  readonly onSetHouseholdGoodUse: (
    player: number,
    effect: 'cooking' | 'rest' | 'piety',
    allowed: boolean,
  ) => void;
  /** Enter "assign a workplace" pick mode for the selected settler. */
  readonly onAssignWorkplace?: (settlerId: number) => void;
  /** Take the selected settler off its workplace at once, with no pick mode. */
  readonly onUnassignWorkplace?: (settlerId: number) => void;
  /** Enter "assign a home" pick mode for the selected settler. */
  readonly onAssignHome?: (settlerId: number) => void;
  /** Remove the selected settler's family from its current home at once, with no pick mode. */
  readonly onUnassignHome?: (settlerId: number) => void;
  /** Open the equip pick menu for one of the selected settler's equipment slots. */
  readonly onEquipSlot?: (settlerId: number, ref: EquipSlotRef) => void;
  /** Order the worn item in `ref` taken off. */
  readonly onUnequipSlot?: (settlerId: number, ref: EquipSlotRef) => void;
  /** Enter "add a house to the trade route" pick mode for the selected trader. */
  readonly onAttachTradeHouse?: (settlerId: number) => void;
  readonly onDetachTradeHouse?: (settlerId: number, house: number) => void;
  readonly onSetTradeImport?: (settlerId: number, house: number, goodType: number, on: boolean) => void;
  /** Trade on the agreement at `agreement` in the map's table; -1 drops the choice. */
  readonly onSetTradeAgreement?: (settlerId: number, agreement: number) => void;
  readonly onSetGatherGood: (entityId: number, goodType: number | null) => void;
  /** Replace a craft worker's product selection (the `setCraftGoods` command); `[]` = every product. */
  readonly onSetCraftGoods: (entityId: number, goods: readonly number[]) => void;
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
    case 'setGatherGood':
      actions.onSetGatherGood(click.entityId, click.goodType);
      return;
    case 'setCraftGoods':
      actions.onSetCraftGoods(click.entityId, click.goods);
      return;
    case 'equipSlot':
      actions.onEquipSlot?.(click.entityId, click.ref);
      return;
    case 'unequipSlot':
      actions.onUnequipSlot?.(click.entityId, click.ref);
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
    case 'assignWorkplace':
      actions.onAssignWorkplace?.(click.entityId);
      return;
    case 'unassignWorkplace':
      actions.onUnassignWorkplace?.(click.entityId);
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
    case 'setTradeAgreement':
      actions.onSetTradeAgreement?.(click.entityId, click.agreement);
      return;
    case 'assignHome':
      actions.onAssignHome?.(click.entityId);
      return;
    case 'unassignHome':
      actions.onUnassignHome?.(click.entityId);
      return;
    default: {
      const unreachable: never = click;
      throw new Error(`unhandled panel click: ${JSON.stringify(unreachable)}`);
    }
  }
}
