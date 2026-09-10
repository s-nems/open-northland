/** One frame per sim tick; equal to the sim's `TICKS_PER_SECOND`, which a test pins. */
export const TICKS_PER_SECOND = 12;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Seat indices a room may carry; equal to the sim's `MAX_PLAYERS`, which a test pins. */
export const MAX_SEATS = 16;
/** People in one room, seated or not. */
export const MAX_MEMBERS = 12;

/** Envelopes one member may land on one tick; the rest are dropped and reported. */
export const MAX_COMMANDS_PER_TICK = 20;
/** Bytes of one envelope as JSON; the largest declared payload is well under it. */
export const MAX_ENVELOPE_BYTES = 1024;
/** Pauses one member may start in one game. */
export const PAUSE_BUDGET = 3;
export const MAX_SPEED = 8;

/** Bytes of one JSON message from a client. A frame from the relay is bounded by the members' budgets
 *  instead: `MAX_MEMBERS * MAX_COMMANDS_PER_TICK` envelopes, each under this cap. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
export const MIN_TOKEN_LENGTH = 16;
export const MAX_TOKEN_LENGTH = 128;
export const MAX_NICK_LENGTH = 24;
export const MAX_ROOM_NAME_LENGTH = 48;
export const MAX_CHAT_LENGTH = 500;
export const MAX_ROOM_ID_LENGTH = 32;
export const MAX_WORLD_ID_LENGTH = 128;
export const MAX_COMMAND_KIND_LENGTH = 64;
export const MAX_REASON_LENGTH = 200;
