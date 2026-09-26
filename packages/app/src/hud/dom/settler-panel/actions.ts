import type { NeedKind } from '@open-northland/sim';
import type { EquipSlotRef } from '../../details-panel/model/index.js';
import type { BuildingHoverModel } from '../../hover-card/model.js';
import type { ResidentRow } from '../../tool-panel/residents/rows.js';
import type { GoodIconPainter } from '../good-art.js';
import type { HoverCard } from '../hover-card.js';
import type { TipChip } from '../parts/tip-layer.js';
import type { OrdersPress } from '../selection-panel.js';

/**
 * What the settler panel's controls ask for. The owner checks the viewer's ownership and the sim's
 * gates before a command leaves; the panel only decides which control was pressed.
 */
export interface SettlerPanelActions {
  readonly centre: (id: number) => void;
  /** A link: the workplace, the home, the spouse or the child. */
  readonly select: (id: number) => void;
  /** A browse chevron or Tab: select this peer and bring it into view. */
  readonly showPeer: (id: number) => void;
  /** A double click on the trade: select every peer as a group. */
  readonly selectGroup: (ids: readonly number[]) => void;
  readonly clearSelection: () => void;
  /** Open the action ring for the settler at the press (the medallion, a right click on the portrait),
   *  as close to the cursor as the canvas under the panel allows. */
  readonly openOrders: (id: number, press: OrdersPress) => void;
  readonly rename: (id: number, name: string) => void;
  readonly orderNeed: (id: number, need: NeedKind) => void;
  readonly assignWorkplace: (id: number) => void;
  readonly unassignWorkplace: (id: number) => void;
  readonly assignHome: (id: number) => void;
  readonly unassignHome: (id: number) => void;
  /** Arm the pick of the person to marry. */
  readonly pickPartner: (id: number) => void;
  readonly equip: (id: number, ref: EquipSlotRef) => void;
  readonly unequip: (id: number, ref: EquipSlotRef) => void;
  readonly setProductionCount: (id: number, goodType: number, count: number) => void;
  /** "Only this product": this one never stops, every other product or gathered good stops. */
  readonly onlyProduct: (id: number, goodType: number) => void;
  readonly setStance: (id: number, mode: number) => void;
  readonly setRegeneration: (id: number, allowed: boolean) => void;
  readonly attachTradeHouse: (id: number) => void;
  readonly detachTradeHouse: (id: number, house: number) => void;
  readonly setTradeImport: (id: number, house: number, goodType: number, on: boolean) => void;
  /** Trade on the agreement at `index` in the map's table; -1 drops the choice. */
  readonly setTradeAgreement: (id: number, index: number) => void;
  /** The good's Knowledge page, once the Knowledge window exists; absent leaves the lock inert. */
  readonly openKnowledge?: (goodType: number) => void;
}

/** What the panel reads besides its model. */
export interface SettlerPanelDeps {
  readonly plane: HTMLElement;
  readonly actions: SettlerPanelActions;
  readonly icons: GoodIconPainter;
  /** The seat's people, for browsing the trade; read on a selection change and at most every few
   *  seconds, never per tick. */
  readonly residents: () => readonly ResidentRow[];
  /** The player-facing label of the ring hotkey's current binding, for the orders tooltip. */
  readonly keyLabel: (action: 'actionRing') => string;
  /** The card the workplace link shows while the cursor rests on it. */
  readonly hoverCard: HoverCard;
  /** The cursor-following chip every control's tooltip shows in after the tip layer's delay, and a
   *  stat line's numbers at once while the cursor is over it. */
  readonly tooltip: TipChip;
  readonly buildingHover: (id: number) => BuildingHoverModel | null;
  /** Wall clock in ms, the peer list's refresh cadence. */
  readonly now: () => number;
}
