import type { GameSession } from '@open-northland/lockstep';
import { decodeSnapshot, type OpenedWorld, RelayClient, type WorldPort } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, type ServerMessage } from '@open-northland/net-protocol';
import type { SaveGame, Simulation } from '@open-northland/sim';
import { TEST_COMPATIBILITY } from './compatibility.js';

export interface HeadlessClientOptions {
  readonly token: string;
  readonly nick: string;
  /** Assemble the world the descriptor names; the real entry's twin for whichever content the test has. */
  readonly buildWorld: (session: GameSession) => Promise<Simulation>;
  /** Rebuild the world from a snapshot another client took; the real entry's restore twin. */
  readonly restoreWorld: (session: GameSession, save: SaveGame) => Promise<Simulation>;
}

type Notice<K extends ServerMessage['kind']> = Extract<ServerMessage, { kind: K }>;
export type ClockNotice = Notice<'clock'>;

/** What the relay told the client, kept for assertions. */
interface Recorded {
  readonly clockNotices: ClockNotice[];
  readonly waits: Notice<'waiting'>[];
  readonly votes: Notice<'kickVote'>[];
  readonly kicks: Notice<'kicked'>[];
  readonly desyncs: Notice<'desync'>[];
  /** Blobs other than the snapshots this client rebuilt from. */
  readonly blobs: Notice<'blob'>[];
  readonly restoredFrom: number[];
  readonly rejections: { readonly of: string; readonly reason: string }[];
  readonly errors: string[];
  readonly dropped: string[];
  snapshotsSent: number;
}

/** The world port a test supplies: a build for `start`, the room's cache when one is offered, and a
 *  restore in place for a served snapshot. */
function worldPortFor(options: HeadlessClientOptions): WorldPort {
  return {
    open: async (session, snapshotTick): Promise<OpenedWorld | null> => {
      if (snapshotTick !== null) return null;
      return { sim: await options.buildWorld(session), generation: DESCRIPTOR_WORLD };
    },
    restore: async (session, snapshot): Promise<OpenedWorld> => {
      const sim = await options.restoreWorld(session, await decodeSnapshot(snapshot));
      return { sim, generation: sim.tick };
    },
  };
}

/** The relay client with no display and no socket: a test drives it over the virtual network and reads
 *  back what the relay told it. */
export class HeadlessClient extends RelayClient {
  private readonly recorded: Recorded;

  constructor(options: HeadlessClientOptions) {
    const recorded: Recorded = {
      clockNotices: [],
      waits: [],
      votes: [],
      kicks: [],
      desyncs: [],
      blobs: [],
      restoredFrom: [],
      rejections: [],
      errors: [],
      dropped: [],
      snapshotsSent: 0,
    };
    let holdsWorld = false;
    super({
      token: options.token,
      nick: options.nick,
      world: worldPortFor(options),
      onMessage: (message) => {
        switch (message.kind) {
          case 'room':
            if (
              message.room.state === 'lobby' &&
              message.room.members.find((member) => member.nick === this.nick)?.compatibility === null
            ) {
              this.setCompatibility(TEST_COMPATIBILITY);
            }
            return;
          case 'clock':
            recorded.clockNotices.push(message);
            return;
          case 'waiting':
            recorded.waits.push(message);
            return;
          case 'kickVote':
            recorded.votes.push(message);
            return;
          case 'kicked':
            recorded.kicks.push(message);
            return;
          case 'desync':
            holdsWorld = false;
            recorded.desyncs.push(message);
            return;
          case 'blob':
            if (message.type !== 'snapshot') recorded.blobs.push(message);
            return;
          case 'snapshotRequest':
            if (holdsWorld) recorded.snapshotsSent++;
            return;
          case 'rejected':
            recorded.rejections.push({ of: message.of, reason: message.reason });
            return;
          case 'error':
            recorded.errors.push(message.reason);
            return;
          default:
            return;
        }
      },
      onWorld: (opened) => {
        holdsWorld = true;
        if (opened.generation !== DESCRIPTOR_WORLD) recorded.restoredFrom.push(opened.sim.tick);
      },
      onDropped: (tick, reason) => recorded.dropped.push(`${tick}: ${reason}`),
    });
    this.recorded = recorded;
  }

  get clockNotices(): readonly ClockNotice[] {
    return this.recorded.clockNotices;
  }

  get waits(): readonly Notice<'waiting'>[] {
    return this.recorded.waits;
  }

  get votes(): readonly Notice<'kickVote'>[] {
    return this.recorded.votes;
  }

  get kicks(): readonly Notice<'kicked'>[] {
    return this.recorded.kicks;
  }

  get desyncs(): readonly Notice<'desync'>[] {
    return this.recorded.desyncs;
  }

  get blobs(): readonly Notice<'blob'>[] {
    return this.recorded.blobs;
  }

  get restoredFrom(): readonly number[] {
    return this.recorded.restoredFrom;
  }

  get snapshotsSent(): number {
    return this.recorded.snapshotsSent;
  }

  get rejections(): readonly { readonly of: string; readonly reason: string }[] {
    return this.recorded.rejections;
  }

  get errors(): readonly string[] {
    return this.recorded.errors;
  }

  get dropped(): readonly string[] {
    return this.recorded.dropped;
  }
}
