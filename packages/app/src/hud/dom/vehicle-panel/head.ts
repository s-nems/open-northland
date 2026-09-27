import { formatMessage, messages } from '../../../i18n/index.js';
import type { VehiclePanelModel } from '../../details-panel/model/index.js';
import type { SelectionHeadModel } from '../selection-panel.js';
import type { TradePeers } from '../settler-panel/peers.js';

/**
 * The vehicle's head: its class as the kicker with the browse over the seat's vehicles of that class
 * (only when there is another), the type as the title, another seat's owner line. A vehicle has no
 * ring, so the orders medallion stays blank and the orders sit beside the portrait.
 */
export function vehicleHead(model: VehiclePanelModel, peers: TradePeers): SelectionHeadModel {
  const copy = messages().hud;
  const kind = copy.vehiclePanel.classes[model.vehicleClass];
  return {
    kicker: kind,
    browse:
      model.foreign || peers.index < 0 || peers.ids.length < 2
        ? null
        : {
            index: peers.index + 1,
            count: peers.ids.length,
            prevTooltip: copy.vehiclePanel.prevTooltip,
            nextTooltip: copy.vehiclePanel.nextTooltip,
            kickerTooltip: formatMessage(copy.vehiclePanel.selectClass, { kind }),
          },
    title: model.title,
    rename: null,
    meta: model.meta,
    orders: null,
    labels: {
      close: copy.settlerPanel.close,
      prev: copy.settlerPanel.prev,
      next: copy.settlerPanel.next,
    },
  };
}
