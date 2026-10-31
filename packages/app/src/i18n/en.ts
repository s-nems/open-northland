import { enBugReport } from './catalogs/en-bug-report.js';
import { enCampaign } from './catalogs/en-campaign.js';
import { enContent } from './catalogs/en-content.js';
import { enGame } from './catalogs/en-game.js';
import { enKnowledge } from './catalogs/en-knowledge.js';
import { enMapCatalogue } from './catalogs/en-map-catalogue.js';
import { enNetwork } from './catalogs/en-network.js';
import { enNetworkRelay } from './catalogs/en-network-relay.js';
import { enNetworkRoom } from './catalogs/en-network-room.js';
import { enSurfaces } from './catalogs/en-surfaces.js';

export const en = {
  bugReport: enBugReport,
  campaign: enCampaign,
  knowledge: enKnowledge,
  network: enNetwork,
  mapCatalogue: enMapCatalogue,
  networkRoom: enNetworkRoom,
  networkRelay: enNetworkRelay,
  ...enContent,
  ...enSurfaces,
  ...enGame,
} as const;

type DeepStrings<T> = { readonly [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };

export type Messages = DeepStrings<typeof en>;
