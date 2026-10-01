import type { components, NeedKind } from '@open-northland/sim';
import type { ActionOrderId } from '../../action-ring/index.js';
import type { GroupStance } from '../../details-panel/model/index.js';
import type { GoodIconPainter } from '../good-art.js';
import type { TipChip } from '../parts/tip-layer.js';
import type { OrdersPress } from '../selection-panel.js';

/**
 * What the group panel's controls ask for. Every order names the members of the shown scope; the owner
 * keeps the viewer's own members and lets the action ring's gates pick who takes it.
 */
export interface GroupPanelActions {
  /** Select this member alone, which opens its own panel. */
  readonly selectOnly: (id: number) => void;
  /** Replace the selection: narrow it to a kind, or drop members from it. */
  readonly select: (ids: readonly number[]) => void;
  readonly centre: (id: number) => void;
  readonly clearSelection: () => void;
  /** Open the action ring for the group around the press. */
  readonly openOrders: (press: OrdersPress) => void;
  readonly closeOrders: () => void;
  readonly orderNeed: (ids: readonly number[], need: NeedKind) => void;
  readonly setStance: (ids: readonly number[], stance: GroupStance) => void;
  readonly setRegeneration: (ids: readonly number[], allowed: boolean) => void;
  readonly setVehicleStance: (ids: readonly number[], stance: components.VehicleStance) => void;
}

export interface GroupPanelDeps {
  readonly plane: HTMLElement;
  readonly actions: GroupPanelActions;
  readonly icons: GoodIconPainter;
  readonly tooltip: TipChip;
  /** The player-facing label of the ring hotkey's current binding, for the orders tooltip. */
  readonly keyLabel: (action: 'actionRing') => string;
  /** How many of `ids` an action-ring order reaches through the ring's own gates. */
  readonly reach: (order: ActionOrderId, ids: readonly number[]) => number;
}
