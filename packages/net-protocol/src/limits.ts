import type { PeaceMinutes } from '@open-northland/lockstep';

/** One frame per sim tick; equal to the sim's `TICKS_PER_SECOND`, which a test pins. */
export const TICKS_PER_SECOND = 12;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Seat indices a room may carry; equal to the sim's `MAX_PLAYERS`, which a test pins. */
export const MAX_SEATS = 16;

/** The envelope version the wire carries; equal to the sim's `COMMAND_ENVELOPE_VERSION`, which a test
 *  pins. */
export const ENVELOPE_VERSION = 2;
/** Atomic player gestures one member may land on one tick, independent of the number of units. */
export const MAX_COMMANDS_PER_TICK = 20;
/** Bytes of one envelope as JSON, including a bounded army's individual formation destinations. */
export const MAX_ENVELOPE_BYTES = 512 * 1024;
/** Bytes of envelopes as JSON one member may land on one tick, beside the gesture count. */
export const MAX_COMMAND_BYTES_PER_TICK = 1024 * 1024;
/** Maximum shared playout reserve selected by the room's Auto mode. */
export const MAX_RESPONSIVENESS_BUFFER_TICKS = 6;
/** The room's Auto reserve before it has measured its links; clients start from it too. */
export const AUTO_INITIAL_BUFFER_TICKS = 2;
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
/** The session descriptor's `PEACE_MINUTES`, the lengths a room's peace may take, which a test pins. */
export const PEACE_MINUTES: readonly PeaceMinutes[] = [30, 45, 60, 75, 90, 120, 180];
/** The widest tribe id a seat may carry, a sanity bound: which ids name a civilization is the
 *  content's to say, and the relay holds no content. */
export const MAX_TRIBE_ID = 0xff;
/** The sim seeds its generator with 32 bits; a wider seed would collapse onto another. */
export const MAX_SEED = 0xffff_ffff;

/** The relay answers one member's `requestMap` or `requestInitialSave` at most this often, bounding a
 *  small request's large response; a client retries a request refused as too soon once after it. */
export const TRANSFER_REQUEST_COOLDOWN_MS = 2000;

/** One complete group order plus its message fields; blobs have their own budget. */
export const MAX_CLIENT_MESSAGE_BYTES = MAX_ENVELOPE_BYTES + 1024;
/** Bytes of one relayed blob once base64-decoded, including uncompressed map documents. */
export const MAX_BLOB_BYTES = 32 * 1024 * 1024;
/** Upper bound on a serialized manual-save order capture. */
export const MAX_SAVE_ORDERS_BYTES = 16 * 1024 * 1024;
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
/** A room password is one printable line; it is only ever compared, never shown to anyone. */
export const MAX_ROOM_PASSWORD_LENGTH = 32;
export const MAX_CHAT_LENGTH = 500;
/** A map signal names a half-cell node; the widest map the sim builds is well inside this bound. */
export const MAX_SIGNAL_NODE = 0xffff;
/** Map signals one member may send at once; after that one more each `SIGNAL_REFILL_MS`. The relay
 *  drops the rest, and the client counts the same way so it never shows a signal nobody else gets. */
export const SIGNAL_BURST = 3;
export const SIGNAL_REFILL_MS = 1500;
/** Chat lines a room keeps for members who join or return; the oldest go first. */
export const MAX_CHAT_HISTORY_LINES = 500;
/** Lines of the relay's own chat a client receives on arriving outside a room; the oldest go first. */
export const MAX_HALL_CHAT_LINES = 200;
/** Entries each list of a `presence` message carries at most; the relay leaves out the rest. */
export const MAX_PRESENCE_ENTRIES = 500;
export const MAX_ROOM_ID_LENGTH = 32;
export const MAX_WORLD_ID_LENGTH = 128;
export const MAX_COMMAND_KIND_LENGTH = 64;
export const MAX_REASON_LENGTH = 200;

export const MAX_CLIENT_VERSION_LENGTH = 128;
/** The relay's build identifier in `welcome`. */
export const MAX_RELAY_BUILD_LENGTH = 128;
