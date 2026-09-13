import { contentFingerprint, jsonFingerprint } from '@open-northland/data';
import { type LobbyCompatibility, PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { loadRealContent, mergeRealContent } from './real-content.js';
import {
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
} from './transfer/index.js';

declare const __CLIENT_BUILD__: string;

export async function loadLobbyCompatibility(
  mapId: string,
  fetchImpl: typeof fetch = fetch,
  client = typeof __CLIENT_BUILD__ === 'string' ? __CLIENT_BUILD__ : 'unbundled',
  supplied?: VerifiedMapDocuments | null,
): Promise<LobbyCompatibility> {
  if (!/^[a-z0-9_-]+$/i.test(mapId)) throw new Error('Invalid lobby map id');
  const [content, documents] = await Promise.all([
    loadRealContent(fetchImpl),
    supplied === undefined ? loadVerifiedMapDocuments(mapId, fetchImpl) : supplied,
  ]);
  if (content === null) throw new Error('Missing game content');
  if (documents !== null) readVerifiedMapDocuments(documents, mapId);
  return {
    content: jsonFingerprint({
      content: contentFingerprint(content),
      resolved: contentFingerprint(mergeRealContent(content).content),
      revision: content.manifest.contentRevision,
      modVersion: content.manifest.modVersion ?? null,
      // Authored placements join raw script names before the runtime localizes display labels.
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
