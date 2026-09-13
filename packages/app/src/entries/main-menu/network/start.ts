import { compatibilityIssues } from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../../content/lobby-identity.js';
import { loadRoomMapDocuments } from '../../../content/transfer/index.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import type { NetworkConnection } from '../../../net/connection.js';
import { stageNetworkHandover } from '../../../net/handover.js';
import { targetSearch } from '../target-search.js';
import type { roomAssets } from './assets.js';

export async function launchNetworkGame(
  connection: NetworkConnection,
  assets: ReturnType<typeof roomAssets>,
  launch: LaunchEntry,
  current: () => boolean,
): Promise<void> {
  const room = connection.client.room;
  if (room?.settings.world.kind !== 'map') throw new Error('No map session');
  let map = assets.verifiedMap();
  if (map === null) {
    map = await loadRoomMapDocuments(room);
    if (!current()) return;
    if (map === null) throw new Error(messages().network.missingMap);
    const report = await loadLobbyCompatibility(map.mapId, fetch, undefined, map);
    const issues = compatibilityIssues(
      [
        ...room.members,
        {
          nick: connection.client.nick,
          compatibility: { ...report, save: room.settings.initialSave?.fingerprint ?? null },
        },
      ],
      room.creator,
      room.settings.initialSave,
    );
    if (issues.length > 0) {
      const copy = messages().net;
      throw new Error(
        issues
          .map((issue) =>
            formatMessage(
              issue.reason === 'missing' ? copy.compatibilityMissing : copy.compatibilityMismatch,
              { nick: issue.nick, kind: copy.compatibilityKinds[issue.kind] },
            ),
          )
          .join('; '),
      );
    }
  }
  if (!current()) return;
  stageNetworkHandover({ connection, map, initialSave: assets.initialSave() });
  const search = new URLSearchParams({ relay: connection.url, room: room.id, network: '1' });
  launch(targetSearch(`?${search}`));
}
