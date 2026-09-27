import { messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import type { SelectionHeadModel } from '../selection-panel.js';
import type { TradePeers } from '../settler-panel/peers.js';

/**
 * The building's head: its class as the kicker with the browse over the owner's buildings of its type
 * (only when there is another), the building's name as the title, the owner line or the civilization.
 * A building has no action ring, so the orders medallion stays blank and its orders sit beside the
 * portrait.
 */
export function buildingHead(model: BuildingPanelModel, peers: TradePeers): SelectionHeadModel {
  const hud = messages().hud;
  const copy = hud.buildingPanel;
  return {
    kicker: model.kicker,
    browse:
      model.foreign || peers.index < 0 || peers.ids.length < 2
        ? null
        : {
            index: peers.index + 1,
            count: peers.ids.length,
            prevTooltip: copy.prevTooltip,
            nextTooltip: copy.nextTooltip,
            kickerTooltip: '',
          },
    title: model.title,
    rename: null,
    meta: model.meta,
    orders: null,
    labels: {
      close: hud.settlerPanel.close,
      prev: hud.settlerPanel.prev,
      next: hud.settlerPanel.next,
    },
  };
}
