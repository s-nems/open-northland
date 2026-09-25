import type { MapScript } from '@open-northland/data';
import { absentSeatsOf, type GameSession } from '@open-northland/lockstep';
import { neverDiesSeats } from './match-participants.js';
import { sessionRoles } from './session-roles.js';
import { sessionDiplomacy, sessionSharedVision } from './session-teams.js';
import type { MapScriptWorld } from './world/build.js';

/**
 * The session's share of a map world's options: who plays, who is left off the map, who assists, whom the match counts, the
 * stances between them, who shares a fog mask and the rule overrides. One derivation serves a fresh
 * boot and the child world a sub-mission opens, so a seat reads the same on both sides of the
 * transition.
 */
export function sessionWorldOptions(session: GameSession, script: MapScript | null, world: MapScriptWorld) {
  const roles = sessionRoles(session, script === null ? [] : neverDiesSeats(script));
  // A story script decides the match for the seats it names; a multiplayer setup script without a
  // verdict leaves the roster to the session's seats.
  const absent = new Set(absentSeatsOf(session));
  const matchParticipants = (
    (world.victory === 'script' ? world.participants : undefined) ?? roles.matchParticipants
  ).filter((seat) => !absent.has(seat));
  return {
    aiSeats: roles.aiSeats,
    absentSeats: absentSeatsOf(session),
    assistantSeats: roles.assistantSeats,
    matchParticipants,
    diplomacy: sessionDiplomacy(session, script?.diplomacy ?? []),
    sharedVision: sessionSharedVision(session),
    ...session.rules,
  };
}
