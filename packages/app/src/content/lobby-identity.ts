import { contentFingerprint, jsonFingerprint } from '@open-northland/data';
import { type LobbyCompatibility, PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { mapFetch } from './map-source/sources.js';
import { activeContentModIds } from './mods/store.js';
import { loadRealContent, mergeRealContent } from './real-content.js';
import {
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
  validMapId,
} from './transfer/index.js';
import { type ContentFetch, contentFetch } from './url.js';

declare const __CLIENT_BUILD__: string;

export async function loadLobbyCompatibility(
  mapId: string,
  fetchImpl: ContentFetch = contentFetch,
  client = typeof __CLIENT_BUILD__ === 'string' ? __CLIENT_BUILD__ : 'unbundled',
  supplied?: VerifiedMapDocuments | null,
): Promise<LobbyCompatibility> {
  validMapId(mapId);
  const [content, documents] = await Promise.all([
    loadRealContent(fetchImpl),
    supplied === undefined
      ? mapFetch(mapId, fetchImpl).then((files) => loadVerifiedMapDocuments(mapId, files))
      : supplied,
  ]);
  const mods = fetchImpl === contentFetch ? await activeContentModIds() : [];
  if (content === null) throw new Error('Missing game content');
  if (documents !== null) readVerifiedMapDocuments(documents, mapId);
  return {
    content: jsonFingerprint({
      content: contentFingerprint(content),
      resolved: contentFingerprint(mergeRealContent(content).content),
      mods,
      // Authored placements join script names against these.
      authoredNames: {
        goods: content.goods.map((row) => [row.typeId, row.name ?? row.id]),
        jobs: content.jobs.map((row) => [row.typeId, row.name ?? row.id]),
      },
    }),
    map: documents?.fingerprint ?? null,
    client,
    protocol: PROTOCOL_VERSION,
  };
}
