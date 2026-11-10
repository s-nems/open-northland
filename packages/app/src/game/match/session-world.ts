import { type MapScript, mapLobbySlots } from '@open-northland/data';
import { absentSeatsOf, type GameSession } from '@open-northland/lockstep';
import type { MapScriptWorld } from '../world/build.js';
import { neverDiesSeats } from './participants.js';
import { sessionRoles } from './session-roles.js';
import { isReservedMapAiSeat } from './session-url.js';

/**
 * The session's share of a map world's options: who plays, who is left off the map, who keeps the lobby
 * peace, how hard each computer seat plays, who assists, whom the match counts, the stances between them
 * and the rule overrides. One derivation serves a fresh
 * boot and the child world a sub-mission opens, so a seat reads the same on both sides of the
 * transition.
 */
export function sessionWorldOptions(session: GameSession, script: MapScript | null, world: MapScriptWorld) {
  const roles = sessionRoles(session, script === null ? [] : neverDiesSeats(script));
  const absent = new Set(absentSeatsOf(session));
  // The map's roster decides whom the match counts; the session's seats stand in only without one.
  const matchParticipants = (world.participants ?? roles.matchParticipants).filter(
    (seat) => !absent.has(seat),
  );
  const reservedMapAi = new Set(
    script === null
      ? []
      : mapLobbySlots(script)
          .filter(isReservedMapAiSeat)
          .map((slot) => slot.player),
  );
  return {
    machineSeats: roles.machineSeats,
    absentSeats: absentSeatsOf(session),
    // A multiplayer map's idle seat is a player's seat nobody took. A campaign's idle seat is the map's
    // own scripted village, which its script still feeds.
    idleSeats:
      script?.multiplayer === undefined
        ? []
        : session.seats.filter((seat) => seat.mode === 'idle').map((seat) => seat.player),
    // A reserved map AI seat plays its map script, which the peace must not hold back.
    peaceSeats: session.seats
      .filter(
        (seat) =>
          seat.mode === 'human' ||
          seat.mode === 'idle' ||
          (seat.mode === 'computer' && !reservedMapAi.has(seat.player)),
      )
      .map((seat) => seat.player),
    computerSeats: session.seats.filter((seat) => seat.mode === 'computer').map((seat) => seat.player),
    computerDifficulties: new Map(
      session.seats.flatMap((seat) =>
        seat.difficulty === undefined ? [] : [[seat.player, seat.difficulty]],
      ),
    ),
    assistantSeats: roles.assistantSeats,
    matchParticipants,
    diplomacy: script?.diplomacy ?? [],
    ...session.rules,
  };
}
