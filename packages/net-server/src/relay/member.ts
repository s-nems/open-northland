import { DESCRIPTOR_WORLD, type LobbyCompatibility, type ServerMessage } from '@open-northland/net-protocol';

export interface Member {
  readonly token: string;
  /** Unique within the room; a duplicate gets a numeric suffix. */
  readonly nick: string;
  connected: boolean;
  /** When the current connection was made, then the order of joining; the earliest wins a digest tie. */
  connectedSince: number;
  joinOrder: number;
  /** When the last pong arrived; what makes a half-open socket silent. */
  lastHeardAt: number;
  /** The connection's input delay and round trip, as the relay last measured them. */
  delayTicks: number;
  roundTripMs: number;
  seat: number | null;
  ready: boolean;
  compatibility: LobbyCompatibility | null;
  loaded: boolean;
  /** The last tick the client reported applied, and the generation of the world it reports from. */
  ackedTick: number;
  world: number;
  /** The notice that put the client out of sync, until a snapshot brings it back. */
  outOfSync: DesyncNotice | null;
  pausesUsed: number;
}

export type DesyncNotice = Extract<ServerMessage, { kind: 'desync' }>;

export interface MeasuredLink {
  readonly delayTicks: number;
  readonly roundTripMs: number;
}

export function createMember(token: string, nick: string, now: number, link: MeasuredLink): Member {
  return {
    token,
    nick,
    connected: true,
    connectedSince: now,
    joinOrder: 0,
    lastHeardAt: now,
    delayTicks: link.delayTicks,
    roundTripMs: link.roundTripMs,
    seat: null,
    ready: false,
    compatibility: null,
    loaded: false,
    ackedTick: 0,
    world: DESCRIPTOR_WORLD,
    outOfSync: null,
    pausesUsed: 0,
  };
}

/** A member whose world is believed to match the room's: the ones a digest is expected from and a
 *  snapshot may come from. */
export function isSynced(member: Member): boolean {
  return member.connected && member.loaded && member.outOfSync === null;
}

export function broadcast(members: Iterable<Member>, deliver: Deliver, message: ServerMessage): void {
  for (const member of members) {
    if (member.connected) deliver(member, message);
  }
}

/** Null when the action went through, otherwise why it was refused. */
export type Refusal = string | null;

export type Deliver = (member: Member, message: ServerMessage) => void;
