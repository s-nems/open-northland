import { randomBytes } from 'node:crypto';
import {
  type ClientMessage,
  type ClosingCode,
  type ClosingReason,
  clientMessageKind,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_REASON_LENGTH,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseRelayBuild,
  type RelayReason,
  type ServerMessage,
} from '@open-northland/net-protocol';
import { LatencyProbe } from './input-delay.js';
import { createMember, type Member, type Refusal } from './member.js';
import { Room } from './room.js';
import { dispatchRoomMessage } from './room-dispatch.js';
import { retireRoomMembers } from './room-retirement.js';
import { saveOrdersRequestId } from './save-orders.js';

export interface Connection {
  send(message: ServerMessage): void;
  /** Close the transport after `error` has been sent. */
  close(reason: ClosingCode): void;
}

export type RelayLog = (event: string, fields?: Record<string, unknown>) => void;

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
}

/** A room with nobody connected is kept this long for reconnects, then dropped. */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_ROOMS = 64;
/** A connection that has not introduced itself by then is closed, so an idle socket holds nothing. */
export const HELLO_TIMEOUT_MS = 10_000;
const ROOM_ID_BYTES = 4;

/** One connection as the relay sees it. Identity arrives with `hello`; before it, nothing else may. */
class Client {
  token: string | null = null;
  nick = '';
  room: Room | null = null;
  member: Member | null = null;
  readonly probe: LatencyProbe;

  constructor(
    readonly connection: Connection,
    readonly connectedAt: number,
  ) {
    this.probe = new LatencyProbe(connectedAt);
  }
}

export type ClientHandle = Client;

/** Transport-free and clock-free: the host feeds it connections, one `receive` per message, and one
 *  `advance` per poll of its clock. */
export class Relay {
  private readonly clients = new Set<Client>();
  private readonly byToken = new Map<string, Client>();
  private readonly rooms = new Map<string, Room>();
  /** Every member's room, connected or not, so a returning token finds its seat. */
  private readonly roomOfToken = new Map<string, Room>();
  private readonly emptySince = new Map<Room, number>();
  private readonly now: () => number;
  private readonly wallClock: () => number;
  private readonly log: RelayLog;
  private readonly maxRooms: number;
  private readonly build: { readonly build?: string };
  private lastAdvanceAt: number;

  constructor(options: RelayOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.log = options.log ?? (() => undefined);
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    const build = options.build ?? null;
    this.build = build === null ? {} : { build: parseRelayBuild(build, 'build') };
    this.lastAdvanceAt = this.now();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  connect(connection: Connection): ClientHandle {
    const client = new Client(connection, this.now());
    this.clients.add(client);
    this.log('connect', { clients: this.clients.size });
    return client;
  }

  disconnect(client: ClientHandle): void {
    if (!this.clients.delete(client)) return;
    if (client.token !== null && this.byToken.get(client.token) === client) this.byToken.delete(client.token);
    if (client.room !== null && client.member !== null) {
      const room = client.room;
      room.disconnect(client.member, this.now());
      this.dropIfEmpty(room);
    }
    this.log('disconnect', { nick: client.nick, clients: this.clients.size });
  }

  /** `bytes` is the message's size on the wire, when the transport knows it. */
  receive(client: ClientHandle, raw: unknown, bytes?: number): void {
    // A closed or replaced connection may still deliver what its socket had queued; none of it counts.
    if (!this.clients.has(client)) return;
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

  advance(): void {
    const now = this.now();
    const elapsed = now - this.lastAdvanceAt;
    this.lastAdvanceAt = now;
    for (const room of this.rooms.values()) {
      const refusal = this.advanceRoom(room, elapsed, now);
      if (refusal !== null) this.dropRoom(room, refusal);
    }
    this.pollClients(now);
    this.expireEmptyRooms(now);
  }

  /** A fault in one room's clock ends that room; it would otherwise recur on every poll and stall
   *  the rooms after it. */
  private advanceRoom(room: Room, elapsed: number, now: number): Refusal {
    try {
      return room.advance(elapsed, now);
    } catch (err) {
      this.log('room fault', { room: room.id, error: String(err) });
      return { code: 'relayFault' };
    }
  }

  /** An introduced client is pinged on its cadence; one that never introduced itself is closed. */
  private pollClients(now: number): void {
    for (const client of this.clients) {
      if (client.token === null) {
        if (now - client.connectedAt >= HELLO_TIMEOUT_MS) this.fail(client, { code: 'helloOverdue' });
        continue;
      }
      const stamp = client.probe.pingDue(now);
      if (stamp !== null) {
        client.connection.send({ kind: 'ping', t: stamp, roundTripMs: client.probe.delay.roundTripMs });
      }
    }
  }

  private expireEmptyRooms(now: number): void {
    for (const room of this.rooms.values()) {
      if (room.connectedCount > 0) {
        this.emptySince.delete(room);
        continue;
      }
      const since = this.emptySince.get(room) ?? now;
      this.emptySince.set(room, since);
      if (now - since >= EMPTY_ROOM_TTL_MS) this.dropRoom(room);
    }
  }

  private hello(client: Client, message: Extract<ClientMessage, { kind: 'hello' }>): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      this.fail(client, { code: 'protocolUnsupported', client: message.protocol, relay: PROTOCOL_VERSION });
      return;
    }
    const previous = this.byToken.get(message.token);
    if (previous !== undefined) {
      // The same identity on a newer connection: the old one loses its identity and its room, so a
      // message still in flight from it can act for nobody; the membership itself stays.
      this.clients.delete(previous);
      this.byToken.delete(message.token);
      previous.token = null;
      previous.room = null;
      previous.member = null;
      previous.connection.send({ kind: 'error', reason: { code: 'replaced' } });
      previous.connection.close('replaced');
    }
    client.token = message.token;
    client.nick = message.nick;
    this.byToken.set(message.token, client);
    const room = this.roomOfToken.get(message.token);
    const member = room?.memberOf(message.token) ?? null;
    client.nick = member?.nick ?? message.nick;
    this.welcome(client);
    if (room !== undefined && member !== null) {
      client.room = room;
      client.member = member;
      member.linkMeasured = false;
      member.jitterMs = 0;
      room.reconnect(member, this.now());
      this.emptySince.delete(room);
    }
    this.log('hello', { nick: message.nick, rejoined: member !== null });
  }

  private welcome(client: Client): void {
    client.connection.send({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: client.nick, ...this.build });
  }

  private dispatch(client: Client, message: ClientMessage): Refusal {
    switch (message.kind) {
      case 'hello':
        return { code: 'alreadyIntroduced' };
      case 'listRooms':
        client.connection.send({
          kind: 'rooms',
          rooms: [...this.rooms.values()].map((room) => room.summary()),
        });
        return null;
      case 'createRoom': {
        if (client.room !== null) return { code: 'alreadyInRoom' };
        if (this.rooms.size >= this.maxRooms) return { code: 'relayFull', rooms: this.maxRooms };
        const member = this.newMember(client, client.nick);
        const room = new Room(this.newRoomId(), member, message.settings, message.seats, this.hooks);
        this.rooms.set(room.id, room);
        this.enter(client, room, member);
        room.welcome(member);
        this.log('room created', { room: room.id, by: client.nick });
        return null;
      }
      case 'joinRoom': {
        if (client.room !== null) return { code: 'alreadyInRoom' };
        const room = this.rooms.get(message.roomId);
        if (room === undefined) return { code: 'noRoom' };
        const member = this.newMember(client, room.uniqueNick(client.nick));
        const refusal = room.join(member);
        if (refusal !== null) return refusal;
        this.enter(client, room, member);
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
        const changed = client.probe.pong(message.t, now);
        if (client.room !== null && client.member !== null) {
          client.member.lastHeardAt = now;
          if (client.probe.delay.samples !== samples) {
            client.room.linkMeasured(
              client.member,
              client.probe.delay.ticks,
              client.probe.delay.roundTripMs,
              client.probe.delay.jitterMs,
            );
          }
        }
        if (changed) client.connection.send({ kind: 'delay', ticks: client.probe.delay.ticks });
        return null;
      }
      default: {
        const { room, member } = client;
        if (room === null || member === null) return { code: 'notInRoom' };
        const refusal = dispatchRoomMessage(room, member, message, this.now());
        if (message.kind === 'start' && refusal === null) this.log('room started', { room: room.id });
        return refusal;
      }
    }
  }

  private readonly hooks = {
    deliver: (member: Member, message: ServerMessage): void => {
      this.byToken.get(member.token)?.connection.send(message);
    },
    removed: (member: Member): void => {
      const room = this.roomOfToken.get(member.token);
      if (room !== undefined) {
        this.detach(member.token, room);
        this.dropIfEmpty(room);
      }
    },
    wallClock: (): number => this.wallClock(),
  };

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
    return createMember(client.token, nick, this.now(), {
      delayTicks,
      roundTripMs,
      jitterMs,
      measured: samples > 0,
    });
  }

  private enter(client: Client, room: Room, member: Member): void {
    client.room = room;
    client.member = member;
    this.roomOfToken.set(member.token, room);
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

  private dropRoom(room: Room, reason?: RelayReason): void {
    this.rooms.delete(room.id);
    this.emptySince.delete(room);
    retireRoomMembers(room, (token) => this.detach(token, room), this.hooks.deliver, reason);
    this.log('room dropped', { room: room.id, ...(reason === undefined ? {} : { reason }) });
  }

  private reject(client: Client, of: ClientMessage['kind'], reason: RelayReason, raw?: unknown): void {
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
    this.disconnect(client);
  }
}
