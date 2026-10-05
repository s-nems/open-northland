/** One frame per sim tick; equal to the sim's `TICKS_PER_SECOND`, which a test pins. */
export const TICKS_PER_SECOND = 12;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Seat indices a room may carry; equal to the sim's `MAX_PLAYERS`, which a test pins. */
export const MAX_SEATS = 16;
/** People in one room, seated or not. */
export const MAX_MEMBERS = 12;

/** The envelope version the wire carries; equal to the sim's `COMMAND_ENVELOPE_VERSION`, which a test
 *  pins. */
export const ENVELOPE_VERSION = 1;
/** Envelopes one member may land on one tick; the rest are dropped and reported. */
export const MAX_COMMANDS_PER_TICK = 20;
/** Bytes of one envelope as JSON; the largest declared payload is well under it. */
export const MAX_ENVELOPE_BYTES = 1024;
export const MAX_SPEED = 8;
/** A reported smoothed tick cost; a client whose tick takes a minute has long been voted out. */
export const MAX_REPORTED_TICK_MS = 60 * 1000;
const SECONDS_PER_HOUR = 60 * 60;
/** A reported frame backlog: an hour of frames at the top speed, which no playing client holds. */
export const MAX_REPORTED_BUFFERED = SECONDS_PER_HOUR * TICKS_PER_SECOND * MAX_SPEED;
/** A boot progress report counts whole percent. */
export const MAX_LOADING_PROGRESS = 100;
/** The sim's `FOG_MODE` ids, which a test pins; the descriptor refuses any other. */
export const FOG_MODES: readonly number[] = [0, 1, 2, 3, 4];
/** The widest tribe id a seat may carry, a sanity bound: which ids name a civilization is the
 *  content's to say, and the relay holds no content. */
export const MAX_TRIBE_ID = 0xff;
/** The sim seeds its generator with 32 bits; a wider seed would collapse onto another. */
export const MAX_SEED = 0xffff_ffff;

/** Bytes of one JSON message from a client other than a blob. A frame from the relay is bounded by the
 *  members' budgets instead: `MAX_MEMBERS * MAX_COMMANDS_PER_TICK` envelopes, each under this cap. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
/** Bytes of one relayed blob once decoded; a gzip snapshot is about 1.3 MB, a decoded map a few. */
export const MAX_BLOB_BYTES = 16 * 1024 * 1024;
/** Upper bound on a serialized manual-save order capture. */
export const MAX_SAVE_ORDERS_BYTES = MAX_BLOB_BYTES;
/** Bytes of the JSON message carrying a blob: its base64 text plus the fields around it. */
export const MAX_BLOB_MESSAGE_BYTES = Math.ceil(MAX_BLOB_BYTES / 3) * 4 + 1024;
/** RFC 6455 close codes a connection ends with for good: the relay's private code for a connection a
 *  newer one replaced, a protocol violation, and a relay shutting down, whose rooms end with it. A
 *  client reopens after any other close. */
export const CLOSE_REPLACED = 4000;
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_SERVICE_RESTART = 1012;
export const MIN_TOKEN_LENGTH = 16;
export const MAX_TOKEN_LENGTH = 128;
export const MAX_NICK_LENGTH = 24;
export const MAX_ROOM_NAME_LENGTH = 48;
export const MAX_CHAT_LENGTH = 500;
/** Chat lines a room keeps for members who join or return; the oldest go first. */
export const MAX_CHAT_HISTORY_LINES = 500;
export const MAX_ROOM_ID_LENGTH = 32;
export const MAX_WORLD_ID_LENGTH = 128;
export const MAX_COMMAND_KIND_LENGTH = 64;
export const MAX_REASON_LENGTH = 200;

export const MAX_CLIENT_VERSION_LENGTH = 128;
