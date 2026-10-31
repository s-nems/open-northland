import { chtBugReport } from './catalogs/cht-bug-report.js';
import { chtCampaign } from './catalogs/cht-campaign.js';
import { chtContent } from './catalogs/cht-content.js';
import { chtGame } from './catalogs/cht-game.js';
import { chtKnowledge } from './catalogs/cht-knowledge.js';
import { chtMapCatalogue } from './catalogs/cht-map-catalogue.js';
import { chtNetwork } from './catalogs/cht-network.js';
import { chtNetworkRelay } from './catalogs/cht-network-relay.js';
import { chtNetworkRoom } from './catalogs/cht-network-room.js';
import { chtSurfaces } from './catalogs/cht-surfaces.js';
import type { Messages } from './en.js';

export const cht = {
  bugReport: chtBugReport,
  campaign: chtCampaign,
  knowledge: chtKnowledge,
  network: chtNetwork,
  mapCatalogue: chtMapCatalogue,
  networkRoom: chtNetworkRoom,
  networkRelay: chtNetworkRelay,
  ...chtContent,
  ...chtSurfaces,
  ...chtGame,
} as const satisfies Messages;
