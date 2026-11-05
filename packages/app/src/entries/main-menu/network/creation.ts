import { mapLobbySlots } from '@open-northland/data';
import type { ComputerDifficulty, SessionSeat } from '@open-northland/lockstep';
import { prepareInitialSave } from '@open-northland/net-client';
import type { RoomSeatSetup, RoomSettings } from '@open-northland/net-protocol';
import { findMapSource } from '../../../content/map-source/index.js';
import {
  loadPersistedMap,
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
} from '../../../content/transfer/index.js';
import { FOG_MODE_BY_NAME } from '../../../game/fog.js';
import { assertMultiplayerMap } from '../../../game/map/multiplayer.js';
import { mapSessionWorld, variantMapScript } from '../../../game/map/variant.js';
import { DEFAULT_SESSION_SPEED, drawSessionSeed, mapSession } from '../../../game/match/session-url.js';
import { initialLobbyOptions } from '../lobby/model.js';
import {
  authoredVacantMode,
  type MapPlayerSlot,
  offersDifficulty,
  SAVED_COMPUTER_DIFFICULTY,
  startingDifficulty,
  vacantOffers,
} from '../lobby/roster-state.js';
import type { CreateChoice } from './create-card.js';
import { type PreparedNetworkSave, readNetworkSave, validateNetworkSave } from './save.js';
import { restoreSavedSeats, savedMapWorld, savedRoster } from './saved-roster.js';

/** A network room starts with allies sharing the map, whatever the map's kind. */
const ROOM_ALLIED_VISION = true;

export async function prepareRoomCreation(choice: CreateChoice, params: URLSearchParams) {
  const save = choice.kind === 'save' ? await readNetworkSave(choice.bytes) : null;
  const mapId = choice.kind === 'map' ? choice.mapId : save?.header.mapId;
  if (!mapId) throw new Error('Missing map');
  const source = await findMapSource(mapId);
  const playable = source !== null && !source.stale ? source : null;
  const local = await loadVerifiedMapDocuments(mapId, playable?.fetch);
  const cached = local === null ? await loadPersistedMap(mapId) : null;
  const handle = local ?? cached?.handle ?? null;
  if (handle === null) throw new Error('Missing map');
  const world =
    save === null
      ? mapSessionWorld(mapId, choice.kind === 'map' ? choice.variant : null)
      : savedMapWorld(save, mapId);
  const script = variantMapScript(readVerifiedMapDocuments(handle).script, world);
  assertMultiplayerMap(script);
  const metadata = playable?.entry;
  const players = script === null ? [] : mapLobbySlots(script);
  if (!players?.some((slot) => slot.claimable && !slot.hidden) || !script?.players.length)
    throw new Error('This map has no playable seats');
  // A single-player save names its seats in its entry search; its world already plays their tribes.
  const savedSeats = new Map(
    save?.header.entry == null
      ? []
      : mapSession(new URLSearchParams(save.header.entry), players).seats.map((seat) => [seat.player, seat]),
  );
  // A save's computer seats play the level its entry names, and `setAiControl`'s hard where it names none.
  const startLevel = (saved: SessionSeat | undefined, listed: MapPlayerSlot): ComputerDifficulty =>
    saved?.difficulty ?? (save === null ? startingDifficulty(listed) : SAVED_COMPUTER_DIFFICULTY);
  const authoredSeats: RoomSeatSetup[] = players.map((slot) => {
    const saved = savedSeats.get(slot.player);
    return {
      player: slot.player,
      color: saved?.color ?? slot.colorId,
      mode: authoredVacantMode(slot),
      offers: vacantOffers(slot),
      claimable: slot.claimable && !slot.hidden,
      authoredTribe: slot.tribeId,
      ...(saved?.tribe === undefined ? {} : { tribe: saved.tribe }),
      ...(!offersDifficulty(slot) ? {} : { difficulty: startLevel(saved, slot) }),
    };
  });
  const seats =
    save === null
      ? authoredSeats
      : restoreSavedSeats(
          save,
          authoredSeats,
          save.header.entry === null ? undefined : [...savedSeats.values()],
        );
  const savedSession = save === null ? null : savedRoster(save);
  const options = initialLobbyOptions(params, ROOM_ALLIED_VISION);
  const rules =
    save === null
      ? {
          fog: FOG_MODE_BY_NAME[options.fog],
          progression: options.professionProgression,
          needs: options.settlerNeeds,
          weather: options.weather,
          dayNight: options.dayNight,
          alliedVision: options.alliedVision,
          peace: options.peace,
        }
      : await validateNetworkSave(save, handle);
  // The saving client's fog memory is its own seat's alone: every member would download it for nothing.
  const initial: PreparedNetworkSave | null =
    save === null ? null : await prepareInitialSave({ ...save, presentation: null });
  const origin = metadata?.provenance?.kind ?? cached?.origin;
  const catalog = playable?.catalog;
  const settings: RoomSettings = {
    name: choice.name,
    world,
    seed: save?.header.seed ?? drawSessionSeed(),
    rules,
    speed: savedSession?.descriptor.speed ?? DEFAULT_SESSION_SPEED,
    kickedSeatMode: 'idle',
    // An installed catalogue map is announced by reference, so members fetch it from the catalogue.
    ...(catalog !== undefined && local !== null
      ? {
          mapOrigin: 'catalog' as const,
          catalogMap: {
            entryId: catalog.entryId,
            mapId,
            fingerprint: local.fingerprint,
            irVersion: catalog.irVersion,
          },
        }
      : // A catalogue map known only from a relay delivery has no entry to announce.
        origin === 'mod' || origin === 'user'
        ? { mapOrigin: origin }
        : {}),
    ...(initial === null ? {} : { initialSave: initial.identity }),
  };
  return { settings, seats, initial, handle };
}
