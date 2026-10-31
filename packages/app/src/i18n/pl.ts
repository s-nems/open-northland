import { plBugReport } from './catalogs/pl-bug-report.js';
import { plCampaign } from './catalogs/pl-campaign.js';
import { plContent } from './catalogs/pl-content.js';
import { plGame } from './catalogs/pl-game.js';
import { plKnowledge } from './catalogs/pl-knowledge.js';
import { plMapCatalogue } from './catalogs/pl-map-catalogue.js';
import { plNetwork } from './catalogs/pl-network.js';
import { plNetworkRelay } from './catalogs/pl-network-relay.js';
import { plNetworkRoom } from './catalogs/pl-network-room.js';
import { plSurfaces } from './catalogs/pl-surfaces.js';
import type { Messages } from './en.js';

export type { Messages } from './en.js';

export const pl = {
  bugReport: plBugReport,
  campaign: plCampaign,
  knowledge: plKnowledge,
  network: plNetwork,
  mapCatalogue: plMapCatalogue,
  networkRoom: plNetworkRoom,
  networkRelay: plNetworkRelay,
  ...plContent,
  ...plSurfaces,
  ...plGame,
} as const satisfies Messages;
