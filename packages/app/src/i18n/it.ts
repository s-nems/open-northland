import { itBugReport } from './catalogs/it-bug-report.js';
import { itCampaign } from './catalogs/it-campaign.js';
import { itContent } from './catalogs/it-content.js';
import { itGame } from './catalogs/it-game.js';
import { itKnowledge } from './catalogs/it-knowledge.js';
import { itMapCatalogue } from './catalogs/it-map-catalogue.js';
import { itNetwork } from './catalogs/it-network.js';
import { itNetworkRelay } from './catalogs/it-network-relay.js';
import { itNetworkRoom } from './catalogs/it-network-room.js';
import { itSurfaces } from './catalogs/it-surfaces.js';
import type { Messages } from './en.js';

export const it = {
  bugReport: itBugReport,
  campaign: itCampaign,
  knowledge: itKnowledge,
  network: itNetwork,
  mapCatalogue: itMapCatalogue,
  networkRoom: itNetworkRoom,
  networkRelay: itNetworkRelay,
  ...itContent,
  ...itSurfaces,
  ...itGame,
} as const satisfies Messages;
