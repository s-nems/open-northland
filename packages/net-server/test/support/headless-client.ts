import { type GameSession, LockstepDriver, parseGameSession } from '@open-northland/lockstep';
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  parseServerMessage,
  RelayTransport,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomView,
  type ServerMessage,
  type WireFrame,
} from '@open-northland/net-protocol';
import { type CommandEnvelope, parseCommandEnvelope, type Simulation } from '@open-northland/sim';

export interface HeadlessClientOptions {
  readonly token: string;
  readonly nick: string;
  /** Assemble the world the descriptor names; the real entry's twin for whichever content the test has. */
  readonly buildWorld: (session: GameSession) => Promise<Simulation>;
}

export type ClockNotice = Extract<ServerMessage, { kind: 'clock' }>;

type Send = (message: ClientMessage) => void;

/**
 * A client of the relay with no display: it runs the real sim through the lockstep driver over the
 * relay transport, answers pings, follows the clock, and records what the relay told it.
 */
export class HeadlessClient {
  readonly token: string;
  nick: string;
  welcomed = false;
  room: RoomView | null = null;
  session: GameSession | null = null;
  sim: Simulation | null = null;
  driver: LockstepDriver | null = null;
  delayTicks: number | null = null;
  readonly clockNotices: ClockNotice[] = [];
  readonly rejections: { readonly of: string; readonly reason: string }[] = [];
  readonly errors: string[] = [];
  readonly dropped: string[] = [];
  private transport: RelayTransport | null = null;
  /** Frames that arrived before the world was built, kept for the transport. */
  private readonly earlyFrames: WireFrame[] = [];
  private loading: Promise<void> | null = null;
  private send: Send = () => {
    throw new Error(`${this.nick} is not attached to a network`);
  };
  private readonly buildWorld: HeadlessClientOptions['buildWorld'];

  constructor(options: HeadlessClientOptions) {
    this.token = options.token;
    this.nick = options.nick;
    this.buildWorld = options.buildWorld;
  }

  attach(send: Send): void {
    this.send = send;
  }

  get tick(): number | null {
    return this.sim?.tick ?? null;
  }

  hello(): void {
    this.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token: this.token, nick: this.nick });
  }

  createRoom(settings: RoomSettings, seats: readonly RoomSeatSetup[]): void {
    this.send({ kind: 'createRoom', settings, seats });
  }

  joinRoom(roomId: string): void {
    this.send({ kind: 'joinRoom', roomId });
  }

  claimSeat(player: number | null): void {
    this.send({ kind: 'claimSeat', player });
  }

  setReady(ready: boolean): void {
    this.send({ kind: 'setReady', ready });
  }

  start(): void {
    this.send({ kind: 'start' });
  }

  setClock(change: { readonly speed?: number; readonly paused?: boolean }): void {
    this.send({ kind: 'clock', ...change });
  }

  say(text: string): void {
    this.send({ kind: 'chat', text });
  }

  submit(envelope: CommandEnvelope): void {
    if (this.driver === null) throw new Error(`${this.nick} has no session to submit to`);
    this.driver.submit(envelope);
  }

  receive(raw: unknown): void {
    const message = parseServerMessage(raw, parseGameSession);
    switch (message.kind) {
      case 'welcome':
        this.nick = message.nick;
        this.welcomed = true;
        return;
      case 'rooms':
        return;
      case 'room':
        this.room = message.room;
        return;
      case 'left':
        this.room = null;
        return;
      case 'start':
        this.startSession(message.session);
        return;
      case 'clock':
        this.clockNotices.push(message);
        this.driver?.setSpeed(message.speed);
        this.driver?.setPaused(message.paused);
        return;
      case 'frame':
        if (this.transport === null) this.earlyFrames.push(message);
        else this.transport.receiveFrame(message);
        return;
      case 'delay':
        this.delayTicks = message.ticks;
        return;
      case 'chat':
        return;
      case 'ping':
        this.send({ kind: 'pong', t: message.t });
        return;
      case 'rejected':
        this.rejections.push({ of: message.of, reason: message.reason });
        return;
      case 'error':
        this.errors.push(message.reason);
        return;
      default:
        assertNever(message);
    }
  }

  /** Resolves once a `start` in flight has built its world. */
  settled(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  advance(elapsedMs: number, onTick?: () => void): void {
    this.driver?.advance(elapsedMs, onTick);
  }

  private startSession(session: GameSession): void {
    this.session = session;
    this.loading = this.buildWorld(session).then((sim) => {
      this.sim = sim;
      this.transport = new RelayTransport({
        send: (message) => this.send(message),
        parseEnvelope: parseCommandEnvelope,
        onDropped: (tick, reason) => this.dropped.push(`${tick}: ${reason}`),
      });
      for (const frame of this.earlyFrames) this.transport.receiveFrame(frame);
      this.earlyFrames.length = 0;
      this.driver = new LockstepDriver({ sim, transport: this.transport, speed: session.speed });
      this.send({ kind: 'loaded' });
    });
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
