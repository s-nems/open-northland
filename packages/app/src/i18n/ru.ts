import { ruCampaign } from './catalogs/ru-campaign.js';
import { ruContent } from './catalogs/ru-content.js';
import { ruGame } from './catalogs/ru-game.js';
import { ruMapCatalogue } from './catalogs/ru-map-catalogue.js';
import { ruNetwork } from './catalogs/ru-network.js';
import { ruNetworkRelay } from './catalogs/ru-network-relay.js';
import { ruNetworkRoom } from './catalogs/ru-network-room.js';
import { ruSurfaces } from './catalogs/ru-surfaces.js';
import type { Messages } from './en.js';

export const ru = {
  campaign: ruCampaign,
  network: ruNetwork,
  mapCatalogue: ruMapCatalogue,
  networkRoom: ruNetworkRoom,
  networkRelay: ruNetworkRelay,
  ...ruContent,
  ...ruSurfaces,
  ...ruGame,
} as const satisfies Messages;
