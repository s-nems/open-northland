import { type MapScript, mapLobbySlots } from '@open-northland/data';
import { absentSeatsOf, type GameSession } from '@open-northland/lockstep';
import { neverDiesSeats, scriptDecidesRoster } from './match-participants.js';
import { sessionRoles } from './session-roles.js';
import { isMapComputerSeat } from './session-url.js';
import type { MapScriptWorld } from './world/build.js';

/**
 * The session's share of a map world's options: who plays, who is left off the map, which computer seats
 * the lobby chose rather than the map and how hard each plays, who assists, whom the match counts, the stances between them
 * and the rule overrides. One derivation serves a fresh
 * boot and the child world a sub-mission opens, so a seat reads the same on both sides of the
 * transition.
 */
export function sessionWorldOptions(session: GameSession, script: MapScript | null, world: MapScriptWorld) {
  const roles = sessionRoles(session, script === null ? [] : neverDiesSeats(script));
  const absent = new Set(absentSeatsOf(session));
  const matchParticipants = (
    (scriptDecidesRoster(world) ? world.participants : undefined) ?? roles.matchParticipants
  ).filter((seat) => !absent.has(seat));
  const mapComputer = new Set(
    script === null
      ? []
      : mapLobbySlots(script)
          .filter(isMapComputerSeat)
          .map((slot) => slot.player),
  );
  return {
    aiSeats: roles.aiSeats,
    absentSeats: absentSeatsOf(session),
    lobbyAiSeats: roles.aiSeats.filter((seat) => !mapComputer.has(seat)),
    aiDifficulties: new Map(
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
