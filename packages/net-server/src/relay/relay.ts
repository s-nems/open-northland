import { randomBytes } from 'node:crypto';
import {
  Allowance,
  type ClientMessage,
  type ClosingCode,
  type ClosingReason,
  clientMessageKind,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_REASON_LENGTH,
  type OnlinePlayer,
  type PlayerFlag,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseRelayBuild,
  type RelayReason,
  type RoomSummary,
  type ServerMessage,
  TICK_MS,
  withFlag,
} from '@open-northland/net-protocol';
import { saveOrdersRequestId } from './game/save-orders.js';
import { HALL_CHAT_BURST, HALL_CHAT_REFILL_MS, Hall } from './hall/hall.js';
import type { HallRecord } from './hall/record.js';
import { createMember, type Member, type Refusal } from './member.js';
import { uniqueNick } from './nick.js';
import { faultFields, type RelayLog, wholeSeconds } from './relay-log.js';
import { dispatchRoomMessage } from './room/dispatch.js';
import { retireRoomMembers } from './room/retirement.js';
import { type Farewell, Room } from './room/room.js';
import { LatencyProbe } from './timing/input-delay.js';

export interface Connection {
  /** The peer's network address, which shares one hall chat allowance and one room password allowance
   *  among its connections, and which a room's ban bars; absent gives the connection its own
   *  allowances. */
  readonly address?: string;
  send(message: ServerMessage): void;
  /** Close the transport after `error` has been sent. */
  close(reason: ClosingCode): void;
}

export interface RelayOptions {
  /** Monotonic milliseconds; the host's clock, or a test's. */
  readonly now?: () => number;
  /** Unix epoch milliseconds; stamps chat lines. */
  readonly wallClock?: () => number;
  readonly log?: RelayLog;
  /** Rooms held at once; `createRoom` is refused past it. */
  readonly maxRooms?: number;
  /** The build `welcome` names, a printable line of at most `MAX_RELAY_BUILD_LENGTH`; null names none. */
  readonly build?: string | null;
  /** What the host adds to each `status` line about its process, such as its memory. */
  readonly hostStatus?: () => Readonly<Record<string, unknown>>;
  /** The hall's chat and recent players as the host kept them before a restart. */
  readonly hall?: HallRecord | null;
  /** The hall has something new for the host to keep; `hallRecord` reads it. */
  readonly hallChanged?: () => void;
}

/** A room with nobody connected is kept this long for reconnects, then dropped. */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_ROOMS = 64;
/** A connection that has not introduced itself by then is closed, so an idle socket holds nothing. */
export const HELLO_TIMEOUT_MS = 10_000;
/** How often the relay logs a census of its clients and rooms while it holds any. */
export const STATUS_LOG_INTERVAL_MS = 5 * 60 * 1000;
/** How often clients outside a room hear what changed in the room list and among who is online. */
export const HALL_REFRESH_MS = 1000;
/** Players arriving in the hall are served together at most this often, whatever brings them there. */
export const HALL_ARRIVAL_MS = 100;
/** A connection shorter than this leaves no trace in the hall's recent players. */
export const SEEN_AFTER_MS = 15_000;
/** A poll this much later than the last leaves a frame due at speed 1 unsent past its time: the
 *  process was busy or starved. */
const LATE_POLL_MS = TICK_MS;
const ROOM_ID_BYTES = 4;
/** Wrong or missing room passwords one peer address may send at once; after that one more each
 *  `JOIN_PASSWORD_REFILL_MS`. */
export const JOIN_PASSWORD_BURST = 5;
export const JOIN_PASSWORD_REFILL_MS = 5000;

/** One connection as the relay sees it. Identity arrives with `hello`; before it, nothing else may. */
class Client {
  token: string | null = null;
  /** The nick `welcome` last named: unique among the connected on `hello`, then the room's. */
  nick = '';
  flag: PlayerFlag | undefined;
  /** The client heard the whole hall since it last arrived outside a room. */
  hallSynced = false;
  /** What it last heard of the room list and of presence, and how many hall lines (`Hall.said`);
   *  a client keeps all three across its visits to rooms, so a return replays only what changed. */
  hallRoomsKey = '';
  hallPresenceKey = '';
  hallHeard: number | null = null;
  room: Room | null = null;
  member: Member | null = null;
  /** A message from this connection is still arriving. */
  uploading = false;
  /** When the connection last delivered a message, or progress on one. */
  heardAt: number;
  readonly probe: LatencyProbe;
  /** Since when this identity has been online, carried over when a newer connection replaces it. */
  onlineSince: number;
  chatAllowance: Allowance;
  passwordAllowance: Allowance;

  constructor(
    readonly connection: Connection,
    readonly connectedAt: number,
  ) {
    this.heardAt = connectedAt;
    this.probe = new LatencyProbe(connectedAt);
    this.onlineSince = connectedAt;
    this.chatAllowance = new Allowance(HALL_CHAT_BURST, HALL_CHAT_REFILL_MS, connectedAt);
    this.passwordAllowance = new Allowance(JOIN_PASSWORD_BURST, JOIN_PASSWORD_REFILL_MS, connectedAt);
  }
}

export type ClientHandle = Client;

/** How a connection ended, for the log: the WebSocket close code its socket reported (1005 for a
 *  close without one, 1006 for one with no close frame) and the reason text that came with it, as
 *  the peer sent it and printable; `cause` when the relay closed it, and the transport error that
 *  ended it. */
export interface ConnectionEnd {
  readonly code?: number;
  readonly reason?: string;
  readonly cause?: string;
  readonly error?: string;
}

/** Transport-free and clock-free: the host feeds it connections, one `receive` per message, and one
 *  `advance` per poll of its clock. */
export class Relay {
  private readonly clients = new Set<Client>();
  private readonly byToken = new Map<string, Client>();
  private readonly rooms = new Map<string, Room>();
  /** Every member's room, connected or not, so a returning token finds its seat. */
  private readonly roomOfToken = new Map<string, Room>();
  /** What a token kicked while its socket was down hears on its return, while its room lasts. */
  private readonly farewells = new Map<string, { readonly room: Room; readonly notice: Farewell }>();
  private readonly emptySince = new Map<Room, number>();
  private readonly now: () => number;
  private readonly wallClock: () => number;
  private readonly log: RelayLog;
  private readonly maxRooms: number;
  private readonly build: { readonly build?: string };
  private readonly hostStatus: () => Readonly<Record<string, unknown>>;
  private readonly hall: Hall;
  /** Hall chat and room password allowances by peer address; an address with no connection left is
   *  forgotten once its allowance is full again. */
  private readonly chatAllowances = new Map<string, Allowance>();
  private readonly passwordAllowances = new Map<string, Allowance>();
  private nextHallAt: number;
  private nextHallArrivalAt: number;
  private lastAdvanceAt: number;
  private nextStatusAt: number;
  /** Since the last `status` line: connections that closed without introducing themselves, those the
   *  host turned away at its connection limit, the longest gap between two polls and the polls later
   *  than `LATE_POLL_MS`. */
  private anonymous = 0;
  private refusedConnections = 0;
  private pollMaxMs = 0;
  private latePolls = 0;
  /** Poll faults logged since the last `status`, by event and message, and the repeats left unlogged:
   *  a fault that recurs on every poll is one line per interval. */
  private readonly faultsLogged = new Set<string>();
  private repeatedFaults = 0;

  constructor(options: RelayOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.log = options.log ?? (() => undefined);
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    const build = options.build ?? null;
    this.build = build === null ? {} : { build: parseRelayBuild(build, 'build') };
    this.hostStatus = options.hostStatus ?? (() => ({}));
    this.hall = new Hall(options.hall ?? null, options.hallChanged ?? (() => undefined));
    this.lastAdvanceAt = this.now();
    this.nextHallAt = this.lastAdvanceAt;
    this.nextHallArrivalAt = this.lastAdvanceAt;
    this.nextStatusAt = this.lastAdvanceAt + STATUS_LOG_INTERVAL_MS;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** The hall as the host should keep it across a restart. */
  hallRecord(): HallRecord {
    const now = this.now();
    const stayed: string[] = [];
    for (const client of this.clients) {
      if (client.token !== null && now - client.onlineSince >= SEEN_AFTER_MS) stayed.push(client.nick);
    }
    return this.hall.record(stayed, this.wallClock());
  }

  connect(connection: Connection): ClientHandle {
    const now = this.now();
    const client = new Client(connection, now);
    const { address } = connection;
    if (address !== undefined) {
      client.chatAllowance = sharedAllowance(this.chatAllowances, address, client.chatAllowance);
      client.passwordAllowance = sharedAllowance(this.passwordAllowances, address, client.passwordAllowance);
    }
    this.clients.add(client);
    return client;
  }

  /** The host turned a connection away at its limit; the next `status` counts it. */
  connectionRefused(): void {
    this.refusedConnections++;
  }

  /** A connection that never introduced itself is only counted in the next `status`. */
  disconnect(client: ClientHandle, end: ConnectionEnd = {}): void {
    if (!this.clients.delete(client)) return;
    if (client.token === null) {
      this.anonymous++;
      return;
    }
    if (this.byToken.get(client.token) === client) this.byToken.delete(client.token);
    const now = this.now();
    if (now - client.onlineSince >= SEEN_AFTER_MS) this.hall.saw(client.nick, this.wallClock());
    const { room, member } = client;
    if (room !== null && member !== null) {
      member.receivingBytes = 0;
      room.disconnect(member, now);
      this.dropIfEmpty(room);
    }
    const { delay } = client.probe;
    this.log('disconnect', {
      nick: client.nick,
      ...(room === null ? {} : { room: room.id }),
      connectedSeconds: wholeSeconds(now - client.connectedAt),
      clients: this.clients.size,
      ...(end.code === undefined ? {} : { closeCode: end.code }),
      ...(end.reason === undefined || end.reason === '' ? {} : { closeReason: end.reason }),
      ...(end.cause === undefined ? {} : { cause: end.cause }),
      ...(end.error === undefined ? {} : { error: end.error }),
      // How long the link had been quiet, and its smoothed round trip before: a dying link or an
      // abrupt close.
      quietMs: Math.round(now - client.heardAt),
      ...(delay.samples === 0 ? {} : { roundTripMs: Math.round(delay.roundTripMs) }),
    });
  }

  /** `bytes` is the message's size on the wire, when the transport knows it. */
  receive(client: ClientHandle, raw: unknown, bytes?: number): void {
    // A closed or replaced connection may still deliver what its socket had queued; none of it counts.
    if (!this.clients.has(client)) return;
    this.heard(client);
    if (bytes !== undefined && bytes > MAX_CLIENT_MESSAGE_BYTES && clientMessageKind(raw) !== 'blob') {
      this.fail(client, { code: 'messageTooLarge' });
      return;
    }
    let message: ClientMessage;
    try {
      message = parseClientMessage(raw);
    } catch (err) {
      const malformed: ClosingReason = {
        code: 'malformed',
        detail: (err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_LENGTH),
      };
      const of = clientMessageKind(raw);
      if (of === null || client.token === null) this.fail(client, malformed);
      else this.reject(client, of, malformed, raw);
      return;
    }
    if (client.token === null) {
      if (message.kind === 'hello') this.hello(client, message);
      else this.fail(client, { code: 'helloFirst' });
      return;
    }
    const refusal = this.dispatch(client, message);
    if (refusal !== null) this.reject(client, message.kind, refusal, message);
  }

  /** The transport holds `bytes` of a message still arriving from `client`, 0 when it holds none. A
   *  browser sends a snapshot as one message, so its pongs wait behind the upload: progress on it is
   *  what keeps the client heard meanwhile, and a pong it delayed is no round-trip sample. */
  receiving(client: ClientHandle, bytes: number): void {
    if (!this.clients.has(client)) return;
    client.uploading = bytes > 0;
    if (client.member !== null) client.member.receivingBytes = bytes;
    if (!client.uploading) return;
    client.probe.held();
    client.heardAt = this.now();
    if (client.member !== null) client.member.lastHeardAt = client.heardAt;
  }

  /** `client` took another part of a large message the transport is still sending it. Its frames and
   *  pings wait behind that message, so this progress is what keeps it heard meanwhile; a download that
   *  stops leaves it silent as before. */
  downloading(client: ClientHandle): void {
    if (!this.clients.has(client)) return;
    client.heardAt = this.now();
    if (client.member !== null) client.member.lastHeardAt = client.heardAt;
  }

  /** The transport has queued `client` a message it sends in parts and the client has not read to
   *  the end (true), or has read it all (false). */
  sending(client: ClientHandle, inFlight: boolean): void {
    if (!this.clients.has(client)) return;
    client.probe.downloading(inFlight);
  }

  /** Answer a message the host will not hand over, without parsing it, as the relay refuses one. */
  refuse(client: ClientHandle, raw: unknown, reason: RelayReason): void {
    if (!this.clients.has(client)) return;
    this.heard(client);
    const of = clientMessageKind(raw);
    if (of === null || client.token === null) this.fail(client, { code: 'helloFirst' });
    else this.reject(client, of, reason, raw);
  }

  /** A whole message arrived: the client is heard, and nothing of it is still arriving. */
  private heard(client: Client): void {
    // The message that ends an upload holds the answer to a ping sent since the upload's last progress.
    if (client.uploading) client.probe.held();
    client.uploading = false;
    client.heardAt = this.now();
    if (client.member === null) return;
    client.member.lastHeardAt = client.heardAt;
    client.member.receivingBytes = 0;
  }

  advance(): void {
    const now = this.now();
    const elapsed = now - this.lastAdvanceAt;
    this.lastAdvanceAt = now;
    this.pollMaxMs = Math.max(this.pollMaxMs, elapsed);
    if (elapsed > LATE_POLL_MS) this.latePolls++;
    for (const room of this.rooms.values()) {
      const refusal = this.advanceRoom(room, elapsed, now);
      if (refusal !== null) this.dropRoom(room, refusal);
    }
    this.pollClients(now);
    this.expireEmptyRooms(now);
    this.guarded('hall fault', {}, () => this.pollHall(now));
    if (now >= this.nextStatusAt) {
      this.nextStatusAt = now + STATUS_LOG_INTERVAL_MS;
      this.logStatus(now);
    }
  }

  /** Who is connected, what the rooms are doing and how the relay's own polls kept time, then each
   *  running room's figures; nothing for an interval in which the relay held nothing. */
  private logStatus(now: number): void {
    const { anonymous, refusedConnections, pollMaxMs, latePolls, repeatedFaults } = this;
    this.anonymous = 0;
    this.refusedConnections = 0;
    this.pollMaxMs = 0;
    this.latePolls = 0;
    this.repeatedFaults = 0;
    this.faultsLogged.clear();
    if (
      this.clients.size === 0 &&
      this.rooms.size === 0 &&
      anonymous === 0 &&
      refusedConnections === 0 &&
      repeatedFaults === 0
    )
      return;
    const rooms = { lobby: 0, running: 0, ended: 0 };
    let playing = 0;
    for (const room of this.rooms.values()) {
      rooms[room.state]++;
      if (room.state === 'running') playing += room.connectedCount;
    }
    this.log('status', {
      clients: this.clients.size,
      rooms,
      playing,
      ...(anonymous === 0 ? {} : { anonymous }),
      ...(refusedConnections === 0 ? {} : { refusedConnections }),
      pollMaxMs: Math.round(pollMaxMs),
      ...(latePolls === 0 ? {} : { latePolls }),
      ...(repeatedFaults === 0 ? {} : { repeatedFaults }),
      ...this.hostStatus(),
    });
    for (const room of this.rooms.values()) if (room.state === 'running') room.logStatus(now);
  }

  /** A fault in one room's clock ends that room; it would otherwise recur on every poll and stall
   *  the rooms after it. */
  private advanceRoom(room: Room, elapsed: number, now: number): Refusal {
    try {
      const refusal = room.advance(elapsed, now);
      if (refusal === null) this.retimeRoom(room);
      return refusal;
    } catch (err) {
      this.log('room fault', { room: room.id, ...faultFields(err) });
      return { code: 'relayFault' };
    }
  }

  /** A fault in one client's or room's share of a poll is logged; it would otherwise recur on every
   *  poll and stop the clients or rooms after it. */
  private guarded(event: string, fields: Record<string, unknown>, step: () => void): void {
    try {
      step();
    } catch (err) {
      const fault = `${event}: ${String(err)}`;
      if (this.faultsLogged.has(fault)) {
        this.repeatedFaults++;
        return;
      }
      this.faultsLogged.add(fault);
      this.log(event, { ...fields, ...faultFields(err) });
    }
  }

  /** An introduced client is pinged on its cadence; one that never introduced itself is closed. */
  private pollClients(now: number): void {
    for (const client of this.clients) {
      this.guarded('poll fault', { nick: client.nick }, () => {
        if (client.token === null) {
          if (now - client.connectedAt >= HELLO_TIMEOUT_MS) this.fail(client, { code: 'helloOverdue' });
          return;
        }
        const stamp = client.probe.pingDue(now);
        if (stamp !== null) {
          client.connection.send({ kind: 'ping', t: stamp, roundTripMs: client.probe.delay.roundTripMs });
        }
      });
    }
  }

  /** Clients outside a room hear the hall: what changed since they last heard it on arriving there,
   *  then each change to the room list or to who is online at most once per `HALL_REFRESH_MS`, and
   *  each chat line at once. */
  private pollHall(now: number): void {
    const listeners: Client[] = [];
    let arriving = false;
    for (const client of this.clients) {
      if (client.token === null || client.room !== null) continue;
      listeners.push(client);
      if (!client.hallSynced) arriving = true;
    }
    const refresh = now >= this.nextHallAt && listeners.length > 0;
    const arrive = arriving && now >= this.nextHallArrivalAt;
    if (!refresh && !arrive) return;
    if (refresh) {
      this.nextHallAt = now + HALL_REFRESH_MS;
      this.forgetAllowances(now);
    }
    if (arrive) this.nextHallArrivalAt = now + HALL_ARRIVAL_MS;
    const rooms = this.roomsMessage(now);
    const presence = this.hall.presence(this.onlinePlayers(), this.wallClock());
    const roomsKey = JSON.stringify(rooms.rooms.map(roomListing));
    const presenceKey = JSON.stringify(presence);
    for (const client of listeners) {
      if (client.hallSynced ? !refresh : !arrive) continue;
      // An arrival also hears running clocks afresh: a pause or a speed change shows only in `playedMs`.
      const clocks = !client.hallSynced && rooms.rooms.some((room) => room.playedMs !== null);
      if (client.hallRoomsKey !== roomsKey || clocks) client.connection.send(rooms);
      if (client.hallPresenceKey !== presenceKey) client.connection.send(presence);
      client.hallRoomsKey = roomsKey;
      client.hallPresenceKey = presenceKey;
      if (client.hallSynced) continue;
      const history = this.hall.history(this.wallClock(), client.hallHeard);
      if (history.replaces || history.lines.length > 0) client.connection.send(history);
      client.hallHeard = this.hall.said;
      client.hallSynced = true;
    }
  }

  /** Drop the allowances of each address with no connection left once they are whole again: a new
   *  connection from there could not have done more anyway. */
  private forgetAllowances(now: number): void {
    const live = new Set<string>();
    for (const client of this.clients)
      if (client.connection.address !== undefined) live.add(client.connection.address);
    for (const allowances of [this.chatAllowances, this.passwordAllowances]) {
      for (const [address, allowance] of allowances) {
        if (!live.has(address) && allowance.full(now)) allowances.delete(address);
      }
    }
  }

  private roomsMessage(now: number): Extract<ServerMessage, { kind: 'rooms' }> {
    return { kind: 'rooms', rooms: [...this.rooms.values()].map((room) => room.summary(now)) };
  }

  /** The nicks `except` may not take: other introduced connections' and every room member's, a
   *  disconnected member's held for its return. */
  private takenNicks(except: Client): string[] {
    const nicks: string[] = [];
    for (const client of this.clients)
      if (client !== except && client.token !== null) nicks.push(client.nick);
    for (const room of this.rooms.values()) nicks.push(...room.nicks());
    return nicks;
  }

  /** Every introduced connection by its nick, and the room it is in. */
  private onlinePlayers(): OnlinePlayer[] {
    const online: OnlinePlayer[] = [];
    for (const client of this.clients) {
      if (client.token !== null)
        online.push({ nick: client.nick, ...withFlag(client.flag), room: client.room?.id ?? null });
    }
    return online;
  }

  private expireEmptyRooms(now: number): void {
    for (const room of this.rooms.values()) {
      this.guarded('expiry fault', { room: room.id }, () => {
        if (room.connectedCount > 0) {
          this.emptySince.delete(room);
          return;
        }
        const since = this.emptySince.get(room) ?? now;
        this.emptySince.set(room, since);
        if (now - since >= EMPTY_ROOM_TTL_MS) this.dropRoom(room, undefined, { expired: true });
      });
    }
  }

  private hello(client: Client, message: Extract<ClientMessage, { kind: 'hello' }>): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      // The one refusal of a connection that names a player: a client of another build.
      this.log('hello refused', { nick: message.nick, protocol: message.protocol });
      this.fail(client, { code: 'protocolUnsupported', client: message.protocol, relay: PROTOCOL_VERSION });
      return;
    }
    const previous = this.byToken.get(message.token);
    if (previous !== undefined) {
      // The same identity on a newer connection: the old one loses its identity and its room, so a
      // message still in flight from it can act for nobody; the membership itself stays.
      if (previous.member !== null) previous.member.figures.drops++;
      this.clients.delete(previous);
      this.byToken.delete(message.token);
      previous.token = null;
      previous.room = null;
      previous.member = null;
      previous.connection.send({ kind: 'error', reason: { code: 'replaced' } });
      client.onlineSince = previous.onlineSince;
      previous.connection.close('replaced');
    }
    client.token = message.token;
    this.byToken.set(message.token, client);
    const room = this.roomOfToken.get(message.token);
    const member = room?.memberOf(message.token) ?? null;
    // Outside a room the hall tells players apart by nick alone, so two connections never share one.
    client.nick = member?.nick ?? uniqueNick(message.nick, this.takenNicks(client));
    // A member keeps the flag it joined with, none included.
    client.flag = member === null ? message.flag : member.flag;
    this.welcome(client);
    if (room !== undefined && member !== null) {
      client.room = room;
      client.member = member;
      member.linkMeasured = false;
      member.jitterMs = 0;
      room.reconnect(member, this.now());
      this.retimeRoom(room);
      this.emptySince.delete(room);
    } else {
      this.sayFarewell(client, message.token);
    }
    this.log('hello', {
      nick: message.nick,
      rejoined: member !== null,
      ...(room === undefined || member === null ? {} : { room: room.id }),
      // The token's older connection was still open: the client gave up on a link the relay still held,
      // after hearing nothing on it for a while, or a second tab took the identity at once.
      ...(previous === undefined
        ? {}
        : { replaced: true, quietMs: Math.round(this.now() - previous.heardAt) }),
    });
  }

  private welcome(client: Client): void {
    client.connection.send({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: client.nick, ...this.build });
  }

  private dispatch(client: Client, message: ClientMessage): Refusal {
    switch (message.kind) {
      case 'hello':
        return { code: 'alreadyIntroduced' };
      case 'listRooms':
        client.connection.send(this.roomsMessage(this.now()));
        return null;
      case 'hallChat': {
        if (client.room !== null) return { code: 'alreadyInRoom' };
        const now = this.now();
        if (!client.chatAllowance.take(now)) return { code: 'retryTooSoon' };
        const line = this.hall.say(client.nick, message.text, this.wallClock(), client.flag);
        for (const other of this.clients) {
          if (other.token === null || other.room !== null || !other.hallSynced) continue;
          other.connection.send(line);
          other.hallHeard = this.hall.said;
        }
        return null;
      }
      case 'createRoom': {
        if (client.room !== null) return { code: 'alreadyInRoom' };
        if (this.rooms.size >= this.maxRooms) return { code: 'relayFull', rooms: this.maxRooms };
        const member = this.newMember(client, client.nick);
        const room = new Room(
          this.newRoomId(),
          member,
          message.settings,
          message.seats,
          message.password,
          this.hooks,
          this.now(),
        );
        this.rooms.set(room.id, room);
        this.enter(client, room, member);
        this.retimeRoom(room);
        room.welcome(member);
        return null;
      }
      case 'joinRoom': {
        if (client.room !== null) return { code: 'alreadyInRoom' };
        const room = this.rooms.get(message.roomId);
        if (room === undefined) return { code: 'noRoom' };
        if (client.token === null) throw new Error('a joining client must have introduced itself');
        const entry = room.entryRefusal(
          client.token,
          client.connection.address,
          message.password,
          client.passwordAllowance,
          this.now(),
        );
        if (entry !== null) return entry;
        const member = this.newMember(client, uniqueNick(client.nick, this.takenNicks(client)));
        const refusal = room.join(member);
        if (refusal !== null) return refusal;
        this.enter(client, room, member);
        this.retimeRoom(room);
        if (client.nick !== member.nick) {
          client.nick = member.nick;
          this.welcome(client);
        }
        room.welcome(member);
        return null;
      }
      case 'leaveRoom': {
        const { room, member } = client;
        if (room === null || member === null) return { code: 'notInRoom' };
        const refusal = room.leave(member, this.now());
        if (refusal !== null) return refusal;
        this.dropIfEmpty(room);
        return null;
      }
      case 'pong': {
        const now = this.now();
        const samples = client.probe.delay.samples;
        const assignedBefore = client.member?.delayTicks;
        const changed = client.probe.pong(message.t, now);
        if (client.room !== null && client.member !== null && client.probe.delay.samples !== samples) {
          client.room.linkMeasured(
            client.member,
            now - message.t,
            client.probe.delay.ticks,
            client.probe.delay.roundTripMs,
            client.probe.delay.jitterMs,
          );
        }
        if (
          changed ||
          (client.probe.delay.samples !== samples && assignedBefore !== client.probe.delay.ticks)
        )
          client.connection.send({ kind: 'delay', ticks: client.probe.delay.ticks });
        return null;
      }
      default: {
        const { room, member } = client;
        if (room === null || member === null) return { code: 'notInRoom' };
        const refusal = dispatchRoomMessage(room, member, message, this.now());
        if (
          refusal === null &&
          (message.kind === 'clock' || message.kind === 'start' || message.kind === 'setSettings')
        )
          this.retimeRoom(room);
        return refusal;
      }
    }
  }

  /** A speed change reexpresses each measured link's wall-time budget in the room's emitted ticks. */
  private retimeRoom(room: Room): void {
    const speed = room.delaySpeed;
    for (const token of room.memberTokens()) {
      const client = this.byToken.get(token);
      if (client?.room !== room || client.member === null) continue;
      if (!client.probe.delay.setSpeed(speed)) continue;
      room.retimeLink(client.member, client.probe.delay.ticks);
      client.connection.send({ kind: 'delay', ticks: client.probe.delay.ticks });
    }
  }

  private readonly hooks = {
    deliver: (member: Member, message: ServerMessage): void => {
      this.byToken.get(member.token)?.connection.send(message);
    },
    removed: (member: Member, farewell: Farewell | null): void => {
      const room = this.roomOfToken.get(member.token);
      if (room !== undefined) {
        this.detach(member.token, room);
        if (farewell !== null) this.farewells.set(member.token, { room, notice: farewell });
        this.dropIfEmpty(room);
      }
    },
    addressOf: (member: Member): string | undefined => this.byToken.get(member.token)?.connection.address,
    wallClock: (): number => this.wallClock(),
    log: (event: string, fields?: Record<string, unknown>): void => this.log(event, fields),
  };

  /** A kicked player's client still holds the game it was kicked from: tell it, and that it left. */
  private sayFarewell(client: Client, token: string): void {
    const farewell = this.farewells.get(token);
    if (farewell === undefined) return;
    this.farewells.delete(token);
    client.connection.send(farewell.notice);
    client.connection.send({ kind: 'left' });
  }

  /** The token no longer belongs to `room`, nor does the connection holding it. */
  private detach(token: string, room: Room): void {
    this.roomOfToken.delete(token);
    const client = this.byToken.get(token);
    if (client !== undefined && client.room === room) {
      client.room = null;
      client.member = null;
    }
  }

  private newMember(client: Client, nick: string): Member {
    if (client.token === null) throw new Error('a member needs an introduced client');
    const { ticks: delayTicks, roundTripMs, jitterMs, samples } = client.probe.delay;
    return createMember(
      client.token,
      nick,
      this.now(),
      { delayTicks, roundTripMs, jitterMs, measured: samples > 0 },
      client.flag,
    );
  }

  private enter(client: Client, room: Room, member: Member): void {
    client.room = room;
    client.member = member;
    client.hallSynced = false;
    this.roomOfToken.set(member.token, room);
    this.farewells.delete(member.token);
  }

  private newRoomId(): string {
    for (;;) {
      const id = randomBytes(ROOM_ID_BYTES).toString('hex');
      if (!this.rooms.has(id)) return id;
    }
  }

  private dropIfEmpty(room: Room): void {
    if (this.rooms.get(room.id) === room && room.memberTokens().length === 0) this.dropRoom(room);
  }

  /** The host is stopping, and every room ends with it: each logs its last figures and its drop. The
   *  members hear of it from their sockets' close; the census of the interval closes the log. */
  stop(): void {
    const reason: RelayReason = { code: 'serverRestart' };
    for (const room of this.rooms.values()) this.dropRoom(room, reason, { quiet: true });
    this.logStatus(this.now());
  }

  /** The members still connected hear `reason`, unless `quiet`; `expired` drops a room nobody came
   *  back to. */
  private dropRoom(
    room: Room,
    reason?: RelayReason,
    how: { readonly quiet?: boolean; readonly expired?: boolean } = {},
  ): void {
    const now = this.now();
    // A fault in the room's last figures must not keep it, or it would fault again on every poll.
    this.guarded('room fault', { room: room.id }, () => room.noteDrop(now));
    this.rooms.delete(room.id);
    this.emptySince.delete(room);
    for (const [token, farewell] of this.farewells) if (farewell.room === room) this.farewells.delete(token);
    retireRoomMembers(
      room,
      (token) => this.detach(token, room),
      this.hooks.deliver,
      how.quiet === true ? undefined : reason,
    );
    this.log('room dropped', {
      room: room.id,
      name: room.name,
      ...room.lifeFields(now),
      ...(reason === undefined ? {} : { reason }),
      ...(how.expired === true ? { expired: true } : {}),
    });
  }

  private reject(client: Client, of: ClientMessage['kind'], reason: RelayReason, raw?: unknown): void {
    const refused = client.member?.figures.refused;
    if (refused !== undefined) {
      const key = `${of}:${reason.code}`;
      refused[key] = (refused[key] ?? 0) + 1;
    }
    const requestId = saveOrdersRequestId(raw);
    client.connection.send({
      kind: 'rejected',
      of,
      reason,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  private fail(client: Client, reason: ClosingReason): void {
    client.connection.send({ kind: 'error', reason });
    client.connection.close(reason.code);
    this.disconnect(client, { cause: reason.code });
  }
}

/** The allowance `address` already shares, or `own` as its first. */
function sharedAllowance(byAddress: Map<string, Allowance>, address: string, own: Allowance): Allowance {
  const shared = byAddress.get(address);
  if (shared !== undefined) return shared;
  byAddress.set(address, own);
  return own;
}

/** A room summary as a change to the list: a running clock's advance is no change. */
function roomListing(summary: RoomSummary): unknown {
  return { ...summary, playedMs: summary.playedMs !== null };
}
