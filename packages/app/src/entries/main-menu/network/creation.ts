import type { MapsIndexEntry } from '@open-northland/content-resolver/wire';
import { prepareInitialSave } from '@open-northland/net-client';
import type { RoomSeatSetup, RoomSettings } from '@open-northland/net-protocol';
import { loadMapList } from '../../../content/maps-index.js';
import {
  loadPersistedMap,
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
} from '../../../content/transfer/index.js';
import { FOG_MODE_BY_NAME } from '../../../game/fog.js';
import { DEFAULT_SESSION_SEED, DEFAULT_SESSION_SPEED, mapSession } from '../../../game/session-url.js';
import { initialLobbyOptions } from '../lobby/model.js';
import { authoredVacantMode } from '../lobby/roster-state.js';
import type { CreateChoice } from './create-card.js';
import { type PreparedNetworkSave, readNetworkSave, validateNetworkSave } from './save.js';
import { restoreSavedSeats, savedRoster } from './saved-roster.js';

export async function prepareRoomCreation(choice: CreateChoice, params: URLSearchParams) {
  const save = choice.kind === 'save' ? await readNetworkSave(choice.bytes) : null;
  const mapId = choice.kind === 'map' ? choice.map.id : save?.header.mapId;
  if (!mapId) throw new Error('Missing map');
  const local = await loadVerifiedMapDocuments(mapId);
  const cached = local === null ? await loadPersistedMap(mapId) : null;
  const handle = local ?? cached?.handle ?? null;
  if (handle === null) throw new Error('Missing map');
  const { script } = readVerifiedMapDocuments(handle);
  const metadata: MapsIndexEntry | undefined =
    choice.kind === 'map' ? choice.map : (await loadMapList()).find((item) => item.id === mapId);
  const players =
    metadata?.players ??
    script?.players.map((slot) => {
      const allowed = script.multiplayer?.slotOptions.find((row) => row.player === slot.player)?.allowed;
      const { name, ...player } = slot;
      return {
        ...player,
        ...(name === undefined ? {} : { name }),
        claimable: slot.type === 'human' || allowed?.includes('human') === true,
        hidden: script.multiplayer?.hiddenSlots.includes(slot.player) ?? false,
        aiAllowed: allowed === undefined || allowed.includes('ai'),
      };
    });
  if (!players?.some((slot) => slot.claimable && !slot.hidden) || !script?.players.length)
    throw new Error('This map has no playable seats');
  const roster = new Map(players.map((slot) => [slot.player, slot]));
  const vacantMode = (slot: (typeof script.players)[number]) => {
    const metadata = roster.get(slot.player);
    return metadata === undefined ? (slot.type === 'ai' ? 'ai' : 'idle') : authoredVacantMode(metadata);
  };
  const savedColors =
    save?.header.entry == null
      ? new Map<number, number>()
      : new Map(
          mapSession(new URLSearchParams(save.header.entry), script.players).seats.map((seat) => [
            seat.player,
            seat.color,
          ]),
        );
  const authoredSeats: RoomSeatSetup[] = script.players.map((slot) => ({
    player: slot.player,
    color: savedColors.get(slot.player) ?? slot.colorId,
    mode: vacantMode(slot),
  }));
  const seats = save === null ? authoredSeats : restoreSavedSeats(save, authoredSeats);
  const savedSession = save === null ? null : savedRoster(save);
  const options = initialLobbyOptions(params);
  const rules =
    save === null
      ? {
          fog: FOG_MODE_BY_NAME[options.fog],
          progression: options.professionProgression,
          needs: options.settlerNeeds,
        }
      : await validateNetworkSave(save, handle);
  const initial: PreparedNetworkSave | null = save === null ? null : await prepareInitialSave(save);
  const origin = metadata?.provenance?.kind ?? cached?.origin;
  const settings: RoomSettings = {
    name: choice.name,
    world: { kind: 'map', mapId },
    seed: save?.header.seed ?? DEFAULT_SESSION_SEED,
    rules,
    speed: savedSession?.descriptor.speed ?? DEFAULT_SESSION_SPEED,
    ...(savedSession === null
      ? { kickedSeatMode: 'ai' as const }
      : savedSession.descriptor.kickedSeatMode === undefined
        ? {}
        : { kickedSeatMode: savedSession.descriptor.kickedSeatMode }),
    ...(origin === 'mod' || origin === 'user' ? { mapOrigin: origin } : {}),
    ...(initial === null ? {} : { initialSave: initial.identity }),
  };
  return { settings, seats, initial, handle };
}
