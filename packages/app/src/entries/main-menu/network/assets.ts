import { parseSavedSessionMetadata, type SavedSessionMetadata } from '@open-northland/lockstep';
import { type RelayClient, verifyInitialSave } from '@open-northland/net-client';
import {
  type LobbyCompatibility,
  type RoomView,
  type ServerMessage,
  sameCompatibility,
} from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../../content/lobby-identity.js';
import { createRoomMapTransfer, type VerifiedMapDocuments } from '../../../content/transfer/index.js';
import { type PreparedNetworkSave, validateNetworkSave } from './save.js';

interface AssetServices {
  readonly transfer: typeof createRoomMapTransfer;
  readonly compatibility: (mapId: string, map: VerifiedMapDocuments | null) => Promise<LobbyCompatibility>;
  readonly verifySave: typeof verifyInitialSave;
  readonly validateSave: typeof validateNetworkSave;
}

export function roomAssets(
  client: RelayClient,
  onError: (error: unknown) => void,
  services: Partial<AssetServices> = {},
  onChanged: () => void = () => undefined,
) {
  const loadCompatibility =
    services.compatibility ?? ((mapId, map) => loadLobbyCompatibility(mapId, fetch, undefined, map));
  const verify = services.verifySave ?? verifyInitialSave;
  const validate = services.validateSave ?? validateNetworkSave;
  let room: RoomView | null = null;
  let epoch = 0;
  let revision = 0;
  let validationRevision = 0;
  let validationPending = false;
  let report: LobbyCompatibility | null = null;
  let map: VerifiedMapDocuments | null = null;
  let prepared: PreparedNetworkSave | null = null;
  let verifiedSave: PreparedNetworkSave | null = null;
  let savedRoster: SavedSessionMetadata | null = null;
  let saveRequest = false;
  let uploaded = false;
  let disposed = false;
  const transfer = (services.transfer ?? createRoomMapTransfer)({
    client,
    onError(error) {
      if (!disposed) onError(error);
    },
    onVerified(handle) {
      if (disposed || room?.state !== 'lobby') return;
      map = handle;
      invalidateValidation();
      void refresh();
    },
  });

  function invalidateValidation(): void {
    validationRevision++;
    validationPending = false;
    verifiedSave = null;
    if (savedRoster !== null) {
      savedRoster = null;
      if (!disposed) onChanged();
    }
  }

  async function refresh(): Promise<void> {
    const current = room;
    if (disposed || current?.settings.world.kind !== 'map') return;
    const mine = epoch;
    const task = ++revision;
    try {
      const next = await loadCompatibility(current.settings.world.mapId, map);
      if (disposed || mine !== epoch || task !== revision) return;
      report = { ...next, save: verifiedSave?.identity.fingerprint ?? null };
      publish();
      void validateSave();
    } catch (error) {
      if (!disposed && mine === epoch && task === revision) onError(error);
    }
  }

  function publish(): void {
    const own = room?.members.find((member) => member.nick === client.nick)?.compatibility;
    if (!disposed && report !== null && room?.state === 'lobby' && !sameCompatibility(own ?? null, report))
      client.setCompatibility(report);
  }

  async function validateSave(): Promise<void> {
    const identity = room?.settings.initialSave;
    const handle = map;
    const initial = prepared;
    if (disposed || !identity || !handle || !initial || verifiedSave !== null || validationPending) return;
    const mine = epoch;
    const task = validationRevision;
    const active = () =>
      !disposed && mine === epoch && task === validationRevision && map === handle && prepared === initial;
    validationPending = true;
    try {
      const save = await verify(initial.bytes, identity, handle.mapId);
      if (!active()) return;
      await validate(save, handle);
      if (!active()) return;
      const metadata = parseSavedSessionMetadata(save.header.session);
      verifiedSave = initial;
      savedRoster = metadata;
      onChanged();
      if (report !== null) report = { ...report, save: identity.fingerprint };
      publish();
    } catch (error) {
      if (active()) onError(error);
    } finally {
      if (active()) validationPending = false;
    }
  }

  /** The creator uploads once; anyone else asks once per room, since the relay broadcasts the upload
   *  to every member and a refusal means it has not arrived yet. Retry asks again by hand. */
  function requestSave(): void {
    if (disposed || !room?.settings.initialSave || room.state !== 'lobby') return;
    if (
      room.creator === client.nick &&
      prepared?.identity.fingerprint === room.settings.initialSave.fingerprint
    ) {
      if (!uploaded) {
        uploaded = true;
        client.sendBlob({
          type: 'initialSave',
          to: null,
          tick: prepared.identity.tick,
          bytes: prepared.bytes,
        });
      }
    } else if (!saveRequest) {
      saveRequest = true;
      client.requestInitialSave();
    }
  }

  return {
    prepare(initial: PreparedNetworkSave | null, handle: VerifiedMapDocuments): void {
      if (disposed) return;
      prepared = initial;
      invalidateValidation();
      transfer.prepare(handle);
    },
    observe(next: RoomView | null): void {
      if (disposed) return;
      if (next?.id !== room?.id) {
        epoch++;
        revision++;
        report = null;
        map = null;
        saveRequest = false;
        uploaded = false;
        invalidateValidation();
        if (next?.settings.initialSave?.fingerprint !== prepared?.identity.fingerprint) prepared = null;
      }
      room = next;
      transfer.observe(next);
      requestSave();
      publish();
    },
    observeMessage(message: ServerMessage): void {
      if (disposed) return;
      transfer.observeBlob(message);
      if (
        message.kind === 'blob' &&
        message.type === 'initialSave' &&
        room?.state === 'lobby' &&
        room.settings.initialSave
      ) {
        if (prepared?.bytes !== message.bytes) {
          prepared = { identity: room.settings.initialSave, bytes: message.bytes };
          invalidateValidation();
        }
        void validateSave();
      }
    },
    retry(): void {
      if (disposed || room?.state !== 'lobby') return;
      revision++;
      report = null;
      saveRequest = false;
      uploaded = false;
      invalidateValidation();
      client.setCompatibility(null);
      transfer.retry();
      requestSave();
    },
    verifiedMap: () => map,
    initialSave: () => verifiedSave,
    savedRoster: () => savedRoster,
    dispose(): void {
      disposed = true;
      epoch++;
      revision++;
      invalidateValidation();
      transfer.dispose();
      room = null;
      map = null;
      prepared = null;
      report = null;
    },
  };
}
