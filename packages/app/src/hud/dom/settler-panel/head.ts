import { formatMessage, messages } from '../../../i18n/index.js';
import { SETTLER_NAME_MAX_CHARS, type SettlerPanelModel } from '../../details-panel/model/index.js';
import type { SelectionHeadModel } from '../selection-panel.js';
import type { TradePeers } from './peers.js';

/**
 * The settler's head: the trade as the kicker with its browse over the seat's people of that trade
 * (only for the seat's own, and only when there is someone else of it), the name with the rename pen (not a hero's, not another seat's person),
 * the owner line, and the orders medallion with the ring's hotkey `ordersKey` in its tooltip (another
 * seat's person takes no orders).
 */
export function settlerHead(
  model: SettlerPanelModel,
  peers: TradePeers,
  ordersKey: string,
): SelectionHeadModel {
  const copy = messages().hud.settlerPanel;
  const trade = model.profession;
  return {
    kicker: trade,
    browse:
      model.foreign || peers.index < 0 || peers.ids.length < 2
        ? null
        : {
            index: peers.index + 1,
            count: peers.ids.length,
            prevTooltip: formatMessage(copy.prevTooltip, { trade }),
            nextTooltip: formatMessage(copy.nextTooltip, { trade }),
            kickerTooltip: formatMessage(copy.selectTrade, { trade }),
          },
    title: model.name,
    rename: model.renamable ? { tooltip: copy.rename, maxLength: SETTLER_NAME_MAX_CHARS } : null,
    meta: model.meta,
    orders: model.foreign ? null : { tooltip: formatMessage(copy.ordersTooltip, { key: ordersKey }) },
    labels: { close: copy.close, prev: copy.prev, next: copy.next },
  };
}
