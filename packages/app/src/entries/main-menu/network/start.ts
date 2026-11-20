import { compatibilityIssues } from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../../content/lobby-identity.js';
import { loadRoomMapDocuments, readVerifiedMapDocuments } from '../../../content/transfer/index.js';
import { assertMapRoomSeats } from '../../../game/match/session-roster.js';
import { messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import type { NetworkConnection } from '../../../net/connection.js';
import { stageNetworkHandover } from '../../../net/handover.js';
import { targetSearch } from '../../../view/target-search.js';
import { compatibilityIssuesText } from '../../relay/compatibility.js';
import type { roomAssets } from './assets.js';

export async function launchNetworkGame(
  connection: NetworkConnection,
  assets: ReturnType<typeof roomAssets>,
  launch: LaunchEntry,
  current: () => boolean,
  abandoned: (error: unknown) => void,
  /** The relay's kept copy of the room's map, for a browser that no longer has it. */
  delivered: () => Promise<string>,
): Promise<void> {
  const room = connection.client.room;
  if (room?.settings.world.kind !== 'map') throw new Error('No map session');
  let map = assets.verifiedMap();
  if (map === null) {
    map = await loadRoomMapDocuments(room, { delivered });
    if (!current()) return;
    if (map === null) throw new Error(messages().network.missingMap);
    const report = await loadLobbyCompatibility(map.mapId, undefined, undefined, map);
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
    if (issues.length > 0) throw new Error(compatibilityIssuesText(issues));
  }
  if (!current()) return;
  assertMapRoomSeats(room.seats, readVerifiedMapDocuments(map).script);
  stageNetworkHandover({ connection, map, initialSave: assets.initialSave() }, abandoned);
  const search = new URLSearchParams({ relay: connection.url, room: room.id, network: '1' });
  launch(targetSearch(`?${search}`));
}
