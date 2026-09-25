import { formatMessage, messages } from '../../../i18n/index.js';
import { SETTLER_NAME_MAX_CHARS, type SettlerPanelModel } from '../../details-panel/model/index.js';
import type { SelectionHeadModel } from '../selection-panel.js';
import type { TradePeers } from './peers.js';

/**
 * The settler's head: the trade as the kicker with its browse over the seat's people of that trade
 * (only for the seat's own), the name with the rename pen (not a hero's, not another seat's person),
 * and the owner line.
 */
export function settlerHead(model: SettlerPanelModel, peers: TradePeers): SelectionHeadModel {
  const copy = messages().hud.settlerPanel;
  const trade = model.profession;
  return {
    kicker: trade,
    browse:
      model.foreign || peers.index < 0
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
    labels: { close: copy.close, prev: copy.prev, next: copy.next },
  };
}
