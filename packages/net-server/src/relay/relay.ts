import { randomBytes } from 'node:crypto';
import {
  type ClientMessage,
  clientMessageKind,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_REASON_LENGTH,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
} from '@open-northland/net-protocol';
import { LatencyProbe } from './input-delay.js';
import { createMember, type Member } from './member.js';
import { Room } from './room.js';
import { dispatchRoomMessage } from './room-dispatch.js';

export interface Connection {
  send(message: ServerMessage): void;
  /** Close the transport after `error` has been sent. */
  close(reason: string): void;
}

export type RelayLog = (event: string, fields?: Record<string, unknown>) => void;

export interface RelayOptions {
  /** Monotonic milliseconds; the host's clock, or a test's. */
  readonly now?: () => number;
  readonly log?: RelayLog;
}

/** A room with nobody connected is kept this long for reconnects, then dropped. */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_ROOMS = 64;
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
    now: number,
  ) {
    this.probe = new LatencyProbe(now);
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
  private readonly log: RelayLog;
  private lastAdvanceAt: number;

  constructor(options: RelayOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? (() => undefined);
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
      this.fail(client, `message of ${bytes} bytes over ${MAX_CLIENT_MESSAGE_BYTES}`);
      return;
    }
    let message: ClientMessage;
    try {
      message = parseClientMessage(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const of = clientMessageKind(raw);
      if (of === null || client.token === null) this.fail(client, `malformed message: ${reason}`);
      else this.reject(client, of, reason);
      return;
    }
    if (client.token === null) {
      if (message.kind === 'hello') this.hello(client, message);
      else this.fail(client, 'hello first');
      return;
    }
    const refusal = this.dispatch(client, message);
    if (refusal !== null) this.reject(client, message.kind, refusal);
  }

  advance(): void {
    const now = this.now();
    const elapsed = now - this.lastAdvanceAt;
    this.lastAdvanceAt = now;
    for (const room of this.rooms.values()) room.advance(elapsed, now);
    this.pingDue(now);
    this.expireEmptyRooms(now);
  }

  private pingDue(now: number): void {
    for (const client of this.clients) {
      if (client.token === null) continue;
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
      this.fail(client, `protocol ${message.protocol} unsupported, this relay speaks ${PROTOCOL_VERSION}`);
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
      previous.connection.send({ kind: 'error', reason: 'replaced by a newer connection' });
      previous.connection.close('replaced');
    }
    client.token = message.token;
    client.nick = message.nick;
    this.byToken.set(message.token, client);
    client.connection.send({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: message.nick });
    const room = this.roomOfToken.get(message.token);
    const member = room?.memberOf(message.token) ?? null;
    if (room !== undefined && member !== null) {
      client.room = room;
      client.member = member;
      room.reconnect(member, this.now());
      this.emptySince.delete(room);
    }
    this.log('hello', { nick: message.nick, rejoined: member !== null });
  }

  private dispatch(client: Client, message: ClientMessage): string | null {
    switch (message.kind) {
      case 'hello':
        return 'already introduced';
      case 'listRooms':
        client.connection.send({
          kind: 'rooms',
          rooms: [...this.rooms.values()].map((room) => room.summary()),
        });
        return null;
      case 'createRoom': {
        if (client.room !== null) return 'already in a room';
        if (this.rooms.size >= MAX_ROOMS) return `the relay is full at ${MAX_ROOMS} rooms`;
        const member = this.newMember(client, client.nick);
        const room = new Room(this.newRoomId(), member, message.settings, message.seats, this.hooks);
        this.rooms.set(room.id, room);
        this.enter(client, room, member);
        client.connection.send({ kind: 'room', room: room.view() });
        this.log('room created', { room: room.id, by: client.nick });
        return null;
      }
      case 'joinRoom': {
        if (client.room !== null) return 'already in a room';
        const room = this.rooms.get(message.roomId);
        if (room === undefined) return `no room ${message.roomId}`;
        const member = this.newMember(client, room.uniqueNick(client.nick));
        const refusal = room.join(member);
        if (refusal !== null) return refusal;
        this.enter(client, room, member);
        return null;
      }
      case 'leaveRoom': {
        const { room, member } = client;
        if (room === null || member === null) return 'not in a room';
        const refusal = room.leave(member);
        if (refusal !== null) return refusal;
        this.dropIfEmpty(room);
        return null;
      }
      case 'pong': {
        const now = this.now();
        const changed = client.probe.pong(message.t, now);
        if (client.member !== null) {
          client.member.lastHeardAt = now;
          client.member.delayTicks = client.probe.delay.ticks;
          client.member.roundTripMs = client.probe.delay.roundTripMs;
        }
        if (changed) client.connection.send({ kind: 'delay', ticks: client.probe.delay.ticks });
        return null;
      }
      default: {
        const { room, member } = client;
        if (room === null || member === null) return 'not in a room';
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
      if (room !== undefined) this.detach(member.token, room);
    },
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
    const { ticks: delayTicks, roundTripMs } = client.probe.delay;
    return createMember(client.token, nick, this.now(), { delayTicks, roundTripMs });
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
    if (room.memberTokens().length === 0) this.dropRoom(room);
  }

  private dropRoom(room: Room): void {
    this.rooms.delete(room.id);
    this.emptySince.delete(room);
    for (const token of room.memberTokens()) this.detach(token, room);
    this.log('room dropped', { room: room.id });
  }

  private reject(client: Client, of: ClientMessage['kind'], reason: string): void {
    client.connection.send({ kind: 'rejected', of, reason: reason.slice(0, MAX_REASON_LENGTH) });
  }

  private fail(client: Client, reason: string): void {
    const clipped = reason.slice(0, MAX_REASON_LENGTH);
    client.connection.send({ kind: 'error', reason: clipped });
    client.connection.close(clipped);
    this.disconnect(client);
  }
}
