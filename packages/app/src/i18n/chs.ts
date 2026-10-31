import { chsBugReport } from './catalogs/chs-bug-report.js';
import { chsCampaign } from './catalogs/chs-campaign.js';
import { chsContent } from './catalogs/chs-content.js';
import { chsGame } from './catalogs/chs-game.js';
import { chsKnowledge } from './catalogs/chs-knowledge.js';
import { chsMapCatalogue } from './catalogs/chs-map-catalogue.js';
import { chsNetwork } from './catalogs/chs-network.js';
import { chsNetworkRelay } from './catalogs/chs-network-relay.js';
import { chsNetworkRoom } from './catalogs/chs-network-room.js';
import { chsSurfaces } from './catalogs/chs-surfaces.js';
import type { Messages } from './en.js';

export const chs = {
  bugReport: chsBugReport,
  campaign: chsCampaign,
  knowledge: chsKnowledge,
  network: chsNetwork,
  mapCatalogue: chsMapCatalogue,
  networkRoom: chsNetworkRoom,
  networkRelay: chsNetworkRelay,
  ...chsContent,
  ...chsSurfaces,
  ...chsGame,
} as const satisfies Messages;
