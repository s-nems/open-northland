/**
 * The lab's world: the room's seats from the map script, the rules a fresh room starts with, and the
 * documents each client builds its world from, shared by the relayed lab and the save builder so both
 * play the world the relayed entry builds.
 */
import { readFileSync } from 'node:fs';
import { mapLobbySlots } from '@open-northland/data';
import { type GameSession, OBSERVER_SEAT, type SessionSeat } from '@open-northland/lockstep';
import type { RoomSeatSetup, RoomSettings } from '@open-northland/net-protocol';
import type { SaveGame } from '@open-northland/sim';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { initialLobbyOptions } from '../../src/entries/main-menu/lobby/model.js';
import {
  authoredVacantMode,
  offersDifficulty,
  startingDifficulty,
  vacantOffers,
} from '../../src/entries/main-menu/lobby/roster-state.js';
import { restoreSavedSeats, savedRoster } from '../../src/entries/main-menu/network/saved-roster.js';
import type { MapWorkerBoot } from '../../src/entries/map/world-inputs.js';
import { FOG_MODE_BY_NAME } from '../../src/game/fog.js';
import { loadContentUnderTest, rawIrUnderTest } from '../../test/real-content/helpers.js';
import { realMapPath, realMapScript } from '../../test/real-content/real-map-world.js';
import type { ComputerDifficulty } from './config.js';
import type { LabSeats } from './report.js';

/** A network room starts with allies sharing the map, as the main menu creates it. */
const ROOM_ALLIED_VISION = true;

export interface SeatRequest {
  readonly mapId: string;
  readonly humans: number;
  /** Computer seats taken from the claimable seats left after the humans; null takes all of them. */
  readonly computers: number | null;
  readonly difficulty: ComputerDifficulty;
}

export interface RoomSeats {
  readonly setup: RoomSeatSetup[];
  readonly seats: LabSeats;
}

function scriptOf(mapId: string) {
  const script = realMapScript(mapId);
  if (script === null) throw new Error(`${mapId} ships no script`);
  return script;
}

/** The room's seats from the map script: humans take the first claimable seats, computers the next. */
export function labSeats(request: SeatRequest): RoomSeats {
  const slots = mapLobbySlots(scriptOf(request.mapId));
  const claimable = slots.filter((slot) => slot.claimable && !slot.hidden);
  if (claimable.length < request.humans) {
    throw new Error(
      `${request.mapId} has ${claimable.length} claimable seats, ${request.humans} humans asked`,
    );
  }
  const human = claimable.slice(0, request.humans).map((slot) => slot.player);
  const rest = claimable.slice(request.humans);
  const computerCount = request.computers ?? rest.length;
  if (computerCount > rest.length) {
    throw new Error(
      `${request.mapId} leaves ${rest.length} claimable seats, ${computerCount} computers asked`,
    );
  }
  const computer = rest.slice(0, computerCount).map((slot) => slot.player);
  const setup = slots.map((slot): RoomSeatSetup => {
    const asComputer = computer.includes(slot.player);
    const offers = vacantOffers(slot);
    if (asComputer && !offers.includes('computer')) {
      throw new Error(`${request.mapId} seat ${slot.player} offers no computer player`);
    }
    return {
      player: slot.player,
      color: slot.colorId,
      mode: asComputer ? 'computer' : authoredVacantMode(slot),
      offers,
      claimable: slot.claimable && !slot.hidden,
      authoredTribe: slot.tribeId,
      ...(asComputer
        ? { difficulty: request.difficulty }
        : offersDifficulty(slot)
          ? { difficulty: startingDifficulty(slot) }
          : {}),
    };
  });
  return { setup, seats: seatsSummary(setup, human, computer, request.difficulty) };
}

function seatsSummary(
  setup: readonly RoomSeatSetup[],
  human: readonly number[],
  computer: readonly number[],
  difficulty: ComputerDifficulty,
): LabSeats {
  const others = setup
    .filter((seat) => !human.includes(seat.player) && !computer.includes(seat.player))
    .map((seat) => ({ player: seat.player, mode: seat.mode }));
  return { human, computer, difficulty, others };
}

/**
 * The seats of a room resumed from `save`, as the lobby restores them from the save's roster: humans
 * take over the claimable seats the save's computers held, in seat order, and the computers keep the
 * next ones, all of them unless `computers` says how many; the rest idle. Every other seat keeps its
 * saved mode, since the saved world already stands.
 */
export function savedLabSeats(save: SaveGame, humans: number, computers: number | null): RoomSeats {
  const mapId = save.header.mapId;
  if (mapId === null) throw new Error('the save names no map');
  const authored = mapLobbySlots(scriptOf(mapId)).map(
    (slot): RoomSeatSetup => ({
      player: slot.player,
      color: slot.colorId,
      mode: authoredVacantMode(slot),
      offers: vacantOffers(slot),
      claimable: slot.claimable && !slot.hidden,
      authoredTribe: slot.tribeId,
      ...(offersDifficulty(slot) ? { difficulty: startingDifficulty(slot) } : {}),
    }),
  );
  const restored = restoreSavedSeats(save, authored);
  const held = restored
    .filter((seat) => seat.claimable && seat.mode === 'computer')
    .map((seat) => seat.player);
  if (held.length < humans) {
    throw new Error(`the save's computers hold ${held.length} claimable seats, ${humans} humans asked`);
  }
  const human = held.slice(0, humans);
  const rest = held.slice(humans);
  const computerCount = computers ?? rest.length;
  if (computerCount > rest.length) {
    throw new Error(`the save leaves ${rest.length} computer seats, ${computerCount} computers asked`);
  }
  const computer = rest.slice(0, computerCount);
  const setup = restored.map(
    (seat): RoomSeatSetup =>
      seat.mode === 'computer' && !human.includes(seat.player) && !computer.includes(seat.player)
        ? { ...seat, mode: 'idle' }
        : seat,
  );
  const difficulty =
    setup.find((seat) => computer.includes(seat.player))?.difficulty ??
    setup.find((seat) => human.includes(seat.player))?.difficulty ??
    'hard';
  return { setup, seats: seatsSummary(setup, human, computer, difficulty) };
}

/** The rules a fresh room starts with: the main menu's defaults. */
export function roomRules(): RoomSettings['rules'] {
  const options = initialLobbyOptions(new URLSearchParams(), ROOM_ALLIED_VISION);
  return {
    fog: FOG_MODE_BY_NAME[options.fog],
    progression: options.professionProgression,
    needs: options.settlerNeeds,
    weather: options.weather,
    dayNight: options.dayNight,
    alliedVision: options.alliedVision,
    peace: options.peace,
  };
}

/** The rules a saved room keeps: its recorded descriptor's, else the main menu's defaults. */
export function savedRules(save: SaveGame): RoomSettings['rules'] {
  return savedRoster(save)?.descriptor.rules ?? roomRules();
}

/** The descriptor the relay would start an observer with for `setup`: each seat's mode and colour,
 *  and its level only while the computer plays it. */
export function observerSession(
  mapId: string,
  seed: number,
  speed: number,
  setup: readonly RoomSeatSetup[],
): GameSession {
  const seats = setup.map(
    (seat): SessionSeat => ({
      player: seat.player,
      mode: seat.mode,
      color: seat.color,
      ...((seat.mode === 'computer' || seat.mode === 'map-ai') && seat.difficulty !== undefined
        ? { difficulty: seat.difficulty }
        : {}),
    }),
  );
  return {
    world: { kind: 'map', mapId },
    seed,
    seats,
    localSeat: OBSERVER_SEAT,
    rules: roomRules(),
    speed,
    kickedSeatMode: 'idle',
  };
}

/** What each client builds its world from: the documents the relayed entry loads, the map parsed per
 *  client so no two worlds share an object. */
export async function worldBoot(mapId: string): Promise<(session: GameSession) => MapWorkerBoot> {
  const { merge } = await loadContentUnderTest();
  const mapText = readFileSync(realMapPath(mapId), 'utf8');
  const ir = rawIrUnderTest() as ContentIr;
  const script = realMapScript(mapId);
  return (session) => ({
    map: JSON.parse(mapText),
    ir,
    script,
    content: merge.content,
    session,
    missions: null,
    saveText: null,
  });
}
