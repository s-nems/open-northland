import type { GameSession } from '@open-northland/lockstep';
import type { DisputeRecord, TickDigest } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import { errorText } from '../diag/error-text.js';
import { diag } from '../diag/index.js';
import { workerStallReports } from '../entries/map/stall-reports.js';
import type { MapWorkerBoot, MapWorldPlacements } from '../entries/map/world-inputs.js';
import {
  type FromNetWorker,
  failureFromWire,
  type LinkState,
  type RelayAnswer,
  type RelayAnswerFor,
  type RelayRequest,
  type RestoredHeader,
  type ToNetWorker,
} from '../session/worker/net-protocol.js';
import { endpointPort, type SessionPort } from '../session/worker/port.js';
import { type WorkerSessionOptions, wireError } from '../session/worker/protocol.js';
import type { WorkerSession } from '../session/worker/worker-session.js';
import { RelayClientMirror } from './net-worker-client.js';
import { RelayedWorlds, WorldNotAdoptedError } from './relayed-worlds.js';

/** The client failures that end a game; a command or snapshot dropped while the link is down is the
 *  link's notice to carry. */
const GAME_FAILURES = ['open', 'restore', 'result', 'message'] as const;

/** What ended the game: one of the worker client's steps, or the worker itself. */
export type FailureSource = (typeof GAME_FAILURES)[number] | 'worker';

export type ConnectionEvent =
  | { readonly kind: 'message'; readonly message: ServerMessage }
  | { readonly kind: 'link'; readonly state: LinkState; readonly reason?: string }
  | { readonly kind: 'failure'; readonly what: FailureSource; readonly error: unknown };

export type RelayedMapSession = WorkerSession<MapWorldPlacements>;

/** Hands the worker the inputs of a requested world; resolves once the worker serves it. */
export type RelayedWorldHosting = (
  boot: MapWorkerBoot,
  options: WorkerSessionOptions,
  initialSaveFingerprint?: string,
) => Promise<RelayedMapSession>;

/**
 * How the game entry answers the client's world requests: `open` answers `start`, `restore` a snapshot
 * the worker decoded. Each hosts a world through `host`, or returns without hosting to refuse.
 */
export interface NetWorldPort {
  open(session: GameSession, snapshotTick: number | null, host: RelayedWorldHosting): Promise<void>;
  restore(session: GameSession, header: RestoredHeader, host: RelayedWorldHosting): Promise<void>;
}

/** A world the worker's client adopted and serves. */
export interface HostedRelayedWorld {
  readonly worldId: number;
  readonly session: RelayedMapSession;
}

type WorldRequest = Extract<FromNetWorker<unknown>, { readonly kind: 'openWorld' | 'restoreWorld' }>;

/** What a request the worker will never answer rejects with. */
const CLOSED_MESSAGE = 'the relay connection closed before the network worker answered';

/** How long a leaving worker has to send its goodbye before it is terminated. */
const LEAVE_GRACE_MS = 2000;

const REFUSING_PORT: NetWorldPort = { open: async () => undefined, restore: async () => undefined };

function networkWorkerPort(): SessionPort {
  const worker = new Worker(new URL('../entries/relay/net-worker.ts', import.meta.url), { type: 'module' });
  return endpointPort(worker, () => worker.terminate());
}

/** One relay connection, run by a network worker from construction until `dispose`. */
export class NetworkConnection {
  readonly client: RelayClientMirror;
  private readonly port: SessionPort;
  private readonly listeners = new Set<(event: ConnectionEvent) => void>();
  private readonly worlds: RelayedWorlds<MapWorldPlacements>;
  /** The requests the worker has not answered yet; they reject once it never will. */
  private readonly answers = new Map<
    number,
    { resolve(value: RelayAnswer): void; reject(error: Error): void }
  >();
  private nextRequestId = 0;
  private readonly worldPort: Promise<NetWorldPort>;
  private resolveWorldPort: (port: NetWorldPort) => void = () => undefined;
  private onWorld: (world: HostedRelayedWorld) => void = () => undefined;
  private link: LinkState | null = null;
  private lastLink: { readonly state: LinkState; readonly reason?: string } | null = null;
  private disposed = false;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly url: string,
    identity: { token: string; nick: string },
    openPort: () => SessionPort = networkWorkerPort,
  ) {
    this.worldPort = new Promise((resolve) => {
      this.resolveWorldPort = resolve;
    });
    this.port = openPort();
    this.worlds = new RelayedWorlds((message) => this.port.post(message), workerStallReports);
    this.client = new RelayClientMirror(
      identity.nick,
      (message) => this.post(message),
      (request) => this.request(request),
    );
    this.port.listen((data, receiveMs) => this.receive(data as FromNetWorker<MapWorldPlacements>, receiveMs));
    this.port.listenFailure((error) => {
      this.worlds.fail(error);
      this.rejectAnswers(error);
      this.emit({ kind: 'failure', what: 'worker', error });
    });
    this.post({ kind: 'connect', url, ...identity });
  }

  /** Whether the relay link is up. */
  get connected(): boolean {
    return this.link === 'ok';
  }

  /** The link's last state and the reason it closed with, for a screen that subscribes after the fact. */
  get linkState(): { readonly state: LinkState; readonly reason?: string } | null {
    return this.lastLink;
  }

  subscribe(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  bindWorld(port: NetWorldPort, onWorld: (world: HostedRelayedWorld) => void): void {
    if (this.disposed) return;
    this.onWorld = onWorld;
    this.resolveWorldPort(port);
  }

  /** The digests the client acknowledged last, oldest first. */
  async digests(): Promise<readonly TickDigest[]> {
    return this.request({ method: 'digests' });
  }

  /** The relay's last desync verdict the client took part in, with the fold inputs of that tick. */
  async dispute(): Promise<DisputeRecord | null> {
    return this.request({ method: 'dispute' });
  }

  /** `leave` sends the explicit leave that gives a seat in a started game up; without it the link
   *  just closes and the relay keeps the seat for a reconnect. */
  dispose(leave = true): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.client.apply({ kind: 'left' });
    this.onWorld = () => undefined;
    this.resolveWorldPort(REFUSING_PORT);
    this.worlds.close();
    this.rejectAnswers(new Error(CLOSED_MESSAGE));
    this.post({ kind: 'leave', leave });
    this.leaveTimer = setTimeout(() => this.port.close(), LEAVE_GRACE_MS);
  }

  /** The link dropped: the relay welcomes this client anew once it is back, and a lobby room is left,
   *  as its `left` would have; the worker's client did the same on its retry. True when a room was left. */
  private dropped(): boolean {
    const left = this.client.room?.state === 'lobby';
    this.client.reset(left);
    return left;
  }

  private post(message: ToNetWorker<MapWorkerBoot>): void {
    this.port.post(message);
  }

  private receive(message: FromNetWorker<MapWorldPlacements>, receiveMs: number): void {
    if (message.kind === 'closed') {
      if (this.leaveTimer !== null) clearTimeout(this.leaveTimer);
      this.rejectAnswers(new Error(CLOSED_MESSAGE));
      this.port.close();
      return;
    }
    if (this.disposed) return;
    switch (message.kind) {
      case 'message':
        this.client.apply(message.message);
        this.emit({ kind: 'message', message: message.message });
        return;
      case 'facts':
        this.client.follow(message.facts);
        return;
      case 'link': {
        this.link = message.state;
        this.lastLink =
          message.reason === undefined
            ? { state: message.state }
            : { state: message.state, reason: message.reason };
        // The mirror forgets the room before anyone hears of the drop; the synthetic `left` follows the
        // link event so a screen that ends on the drop never sees the room end for another reason.
        const left = message.state === 'reconnecting' && this.dropped();
        this.emit({ kind: 'link', ...this.lastLink });
        if (left) this.emit({ kind: 'message', message: { kind: 'left' } });
        return;
      }
      case 'openWorld':
      case 'restoreWorld':
        void this.answerWorld(message);
        return;
      case 'unadopted':
        this.worlds.unadopted(message.requestId);
        return;
      case 'failure': {
        const error = failureFromWire(message.error);
        diag.warn('net', `${message.what} failed`, { error: errorText(error) });
        const what = GAME_FAILURES.find((failure) => failure === message.what);
        if (what !== undefined) this.emit({ kind: 'failure', what, error });
        return;
      }
      case 'warning':
        diag.warn('net', message.message);
        return;
      case 'answer': {
        const pending = this.answers.get(message.id);
        this.answers.delete(message.id);
        if (message.ok) pending?.resolve(message.value);
        else pending?.reject(failureFromWire(message.error));
        return;
      }
      default:
        this.worlds.route(message, receiveMs);
    }
  }

  private async answerWorld(request: WorldRequest): Promise<void> {
    const port = await this.worldPort;
    if (this.disposed) return;
    const { requestId } = request;
    const hosted: { world: Promise<HostedRelayedWorld> | null } = { world: null };
    const host: RelayedWorldHosting = (boot, options, initialSaveFingerprint) => {
      if (hosted.world !== null) throw new Error('a world request is hosted once');
      const answer = {
        boot,
        options,
        ...(initialSaveFingerprint === undefined ? {} : { initialSaveFingerprint }),
      };
      const message: ToNetWorker<MapWorkerBoot> = { kind: 'worldInputs', requestId, world: answer };
      const world = this.worlds.host(requestId, message, options).then((session) => {
        // The worker posts the adopted world's facts before its session's `ready`.
        const worldId = this.client.worldId;
        if (worldId === null) throw new WorldNotAdoptedError();
        return { worldId, session };
      });
      hosted.world = world;
      return world.then(({ session }) => session);
    };
    try {
      if (request.kind === 'openWorld') await port.open(request.session, request.snapshotTick, host);
      else await port.restore(request.session, request.header, host);
      if (hosted.world === null) {
        this.post({ kind: 'worldInputs', requestId, world: null });
        return;
      }
      const world = await hosted.world;
      if (!this.disposed) this.onWorld(world);
    } catch (error) {
      // Before its inputs cross, the worker's client reports the failure as its own; after, the
      // worker built the world and only this side knows it cannot be shown.
      if (hosted.world === null) this.post({ kind: 'worldFailed', requestId, error: wireError(error) });
      else if (!(error instanceof WorldNotAdoptedError)) {
        diag.warn('net', 'world failed', { error: errorText(error) });
        this.emit({ kind: 'failure', what: request.kind === 'openWorld' ? 'open' : 'restore', error });
      }
    }
  }

  /** The worker answers each method with its own shape; the wire union is narrowed here, once. */
  private request<R extends RelayRequest>(request: R): Promise<RelayAnswerFor<R>> {
    if (this.disposed) return Promise.reject(new Error(CLOSED_MESSAGE));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.answers.set(id, { resolve: (value) => resolve(value as RelayAnswerFor<R>), reject });
      this.post({ kind: 'request', id, request });
    });
  }

  private rejectAnswers(error: Error): void {
    for (const pending of this.answers.values()) pending.reject(error);
    this.answers.clear();
  }

  private emit(event: ConnectionEvent): void {
    if (!this.disposed) for (const listener of this.listeners) listener(event);
  }
}
