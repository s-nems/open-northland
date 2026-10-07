import type { SessionDriver } from '@open-northland/lockstep';
import {
  type AdoptedWorld,
  isLobbyAction,
  RelayClient,
  type RelayLink,
  type RelayLinkEvents,
  RelaySocket,
} from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import {
  type FromNetWorker,
  type RelayAnswer,
  type RelayFacts,
  type RelayRequest,
  type ToNetWorker,
  wireFailure,
} from './net-protocol.js';
import { type RelayedWorldBuilder, RelayedWorldPort } from './net-world-port.js';
import type { SessionPort } from './port.js';
import { errorFromWire, type FromWorker, wireError } from './protocol.js';
import { ServedSession } from './serve.js';

/** Opens the relay link; a test replaces the socket with a link of its own. */
export type RelayLinkFactory = (url: string, events: RelayLinkEvents) => RelayLink;

const socketLink: RelayLinkFactory = (url, events) => new RelaySocket({ url, ...events });

type Connect = Extract<ToNetWorker<unknown>, { readonly kind: 'connect' }>;
type Post<E> = (message: FromNetWorker<E>, transfer?: readonly ArrayBuffer[]) => void;

/** Serve one relay connection on `port`, from its `connect` message until its `leave`. */
export function serveRelay<B, E>(
  port: SessionPort,
  build: RelayedWorldBuilder<B, E>,
  openLink: RelayLinkFactory = socketLink,
): void {
  let connection: RelayConnection<B, E> | null = null;
  const post: Post<E> = (message, transfer) => port.post(message, transfer);
  port.listen((data) => {
    const message = data as ToNetWorker<B>;
    if (message.kind === 'ping') post({ kind: 'pong' });
    else if (message.kind === 'connect')
      connection ??= new RelayConnection(post, build, openLink, message, () => port.close());
    else connection?.receive(message);
  });
}

/** A relay message the runtime has no use for: the transport's frames, and snapshots decoded here. */
function staysInWorker(message: ServerMessage): boolean {
  return message.kind === 'frame' || (message.kind === 'blob' && message.type === 'snapshot');
}

/** The worker's side of a relay connection: the link, the client, and the world it adopted. */
class RelayConnection<B, E> {
  private readonly client: RelayClient;
  private readonly link: RelayLink;
  private readonly worlds: RelayedWorldPort<B, E>;
  private readonly driver: SessionDriver;
  private served: ServedSession<E> | null = null;
  private servedWorldId: number | null = null;
  private lastFacts: RelayFacts | null = null;
  /** Off while the client applies a notice the runtime applied on its own side. */
  private forwarding = true;

  constructor(
    private readonly post: Post<E>,
    build: RelayedWorldBuilder<B, E>,
    openLink: RelayLinkFactory,
    { url, token, nick }: Connect,
    private readonly close: () => void,
  ) {
    this.worlds = new RelayedWorldPort(post, build);
    const client = new RelayClient({
      token,
      nick,
      world: this.worlds,
      connected: () => this.link.connected,
      onMessage: (message) => this.forward(message),
      onWorld: (world) => this.serve(world),
      onDropped: (tick, reason) =>
        post({ kind: 'warning', message: `dropped an envelope for tick ${tick}: ${reason}` }),
      onError: (what, error) => post({ kind: 'failure', what, error: wireFailure(error) }),
      awaitsDisplay: true,
    });
    this.client = client;
    this.driver = relayedDriver(client, () => this.postFacts());
    this.link = openLink(url, {
      onOpen: () => {
        client.hello();
        post({ kind: 'link', state: 'ok' });
      },
      onMessage: (raw) => {
        try {
          client.receive(raw);
        } catch (error) {
          post({ kind: 'failure', what: 'message', error: wireFailure(error) });
        }
      },
      onRetry: () => {
        this.dropped();
        post({ kind: 'link', state: 'reconnecting' });
      },
      onClosed: (reason) => post({ kind: 'link', state: 'closed', reason }),
    });
    client.attach((message) => {
      this.link.send(message);
    });
  }

  receive(message: Exclude<ToNetWorker<B>, { readonly kind: 'ping' | 'connect' }>): void {
    const { client } = this;
    switch (message.kind) {
      case 'lobby': {
        if (!isLobbyAction(message.name)) {
          this.post({ kind: 'warning', message: `no lobby action named ${String(message.name)}` });
          return;
        }
        // The name is checked above; the arguments are what the runtime typed against the same member.
        const action = client[message.name] as (this: RelayClient, ...args: readonly unknown[]) => void;
        action.call(client, ...message.args);
        return;
      }
      case 'responsiveness':
        client.setResponsiveness(message.mode);
        return;
      case 'clock':
        if (message.paused !== undefined) client.setPaused(message.paused);
        if (message.speed !== undefined) client.setSpeed(message.speed);
        return;
      case 'submit':
        client.submit(message.envelope);
        return;
      case 'leave':
        this.end(message.leave);
        return;
      case 'worldInputs':
        this.worlds.answer(message.requestId, message.world);
        return;
      case 'worldFailed':
        this.worlds.fail(message.requestId, errorFromWire(message.error));
        return;
      case 'request':
        void this.answer(message.id, message.request);
        return;
      // The relay runs the clock: tempo and pause are `clock` requests, so a world's own are dropped.
      case 'pause':
      case 'speed':
        return;
      case 'call':
        if (this.served !== null) this.served.receive(message);
        else {
          const error = wireError(new Error('no relayed world is served'));
          this.post({ kind: 'reply', id: message.id, tick: client.tick ?? 0, ok: false, error });
        }
        return;
      case 'start':
        this.served?.receive(message);
        return;
      case 'shown':
        client.worldShown(message.worldId);
        return;
      case 'delivered':
      case 'fogSeat':
      case 'instruments':
      case 'profileReset':
        this.served?.receive(message);
        return;
    }
  }

  private forward(message: ServerMessage): void {
    // A world the client dropped is served no more.
    if (this.served !== null && this.client.worldId !== this.servedWorldId) this.endServed();
    // A frame, or the clock, the client waited on may have come.
    this.served?.wake();
    this.postFacts();
    if (this.forwarding && !staysInWorker(message)) this.post({ kind: 'message', message });
  }

  private serve(world: AdoptedWorld): void {
    const candidate = this.worlds.adopt(world.sim);
    this.endServed();
    this.postFacts();
    if (candidate === undefined) {
      this.post({ kind: 'warning', message: `world ${world.worldId} was adopted without a request` });
      return;
    }
    const post = (message: FromWorker<E>, transfer?: readonly ArrayBuffer[]): void => {
      this.post(message, transfer);
      if (message.kind === 'ticks') this.postFacts();
    };
    try {
      this.served = new ServedSession(
        post,
        {
          sim: world.sim,
          driver: this.driver,
          extras: candidate.extras,
          awaitsFrames: true,
          costs: {
            charge: (ms) => this.client.chargeTickWork(ms),
            drawn: (ms, ticks) => this.client.drawnTickCost(ms, ticks),
          },
        },
        candidate.options,
        candidate.buildMs,
      );
      this.servedWorldId = world.worldId;
    } catch (err) {
      this.post({ kind: 'bootFailed', error: wireError(err), log: [] });
    }
  }

  private endServed(): void {
    this.served?.replace();
    this.served = null;
    this.servedWorldId = null;
  }

  private async answer(id: number, request: RelayRequest): Promise<void> {
    try {
      const value = await this.perform(request);
      this.post({ kind: 'answer', id, ok: true, value });
    } catch (err) {
      this.post({ kind: 'answer', id, ok: false, error: wireFailure(err) });
    }
  }

  private async perform(request: RelayRequest): Promise<RelayAnswer> {
    switch (request.method) {
      case 'digests':
        return this.client.digests.list();
      case 'dispute':
        return this.client.dispute;
      case 'shareSave':
        await this.client.shareSave(request.to, request.save);
        return null;
    }
  }

  private postFacts(): void {
    const facts = relayFacts(this.client);
    if (this.lastFacts !== null && sameFacts(this.lastFacts, facts)) return;
    this.lastFacts = facts;
    this.post({ kind: 'facts', facts });
  }

  /** The link dropped: the relay welcomes the client anew once it is back, and a lobby room is left,
   *  as its `left` would have. The runtime's mirror does the same on the `reconnecting` that follows. */
  private dropped(): void {
    const { client } = this;
    client.welcomed = false;
    if (client.room?.state === 'lobby') this.quietly(() => client.receive({ kind: 'left' }));
    this.postFacts();
  }

  private quietly(apply: () => void): void {
    this.forwarding = false;
    try {
      apply();
    } finally {
      this.forwarding = true;
    }
  }

  private end(leave: boolean): void {
    const { client } = this;
    if (leave && client.room !== null && this.link.connected) client.leaveRoom();
    this.quietly(() => client.receive({ kind: 'left' }));
    this.endServed();
    this.worlds.dispose();
    this.link.close();
    this.post({ kind: 'closed' });
    this.close();
  }
}

/**
 * The client as the served session's driver. It never reads as paused: the relay's pause is the
 * client's to apply, which still runs the frames it holds, so the worker's timer keeps feeding it.
 * `advanced` runs after each advance, which may settle the match end without stepping a tick.
 */
function relayedDriver(client: RelayClient, advanced: () => void): SessionDriver {
  return {
    get paused() {
      return false;
    },
    get speed() {
      return client.speed;
    },
    get droppedTicks() {
      return client.droppedTicks;
    },
    get maxStepsPerFrame() {
      return client.maxStepsPerFrame;
    },
    setPaused: (paused) => client.setPaused(paused),
    setSpeed: (speed) => client.setSpeed(speed),
    advance: (elapsedMs, onTick) => {
      const alpha = client.advance(elapsedMs, onTick);
      advanced();
      return alpha;
    },
    submit: (envelope) => client.submit(envelope),
    captureSave: (options) => client.captureSave(options),
  };
}

function relayFacts(client: RelayClient): RelayFacts {
  return {
    tick: client.tick,
    paused: client.paused,
    speed: client.speed,
    bufferedTicks: client.bufferedTicks,
    droppedTicks: client.droppedTicks,
    clickToApplyMs: client.latency.clickToApplyMs,
    resultTick: client.resultTick,
    endedTick: client.endedTick,
    isOutOfSync: client.isOutOfSync,
    worldId: client.worldId,
  };
}

function sameFacts(a: RelayFacts, b: RelayFacts): boolean {
  return (Object.keys(a) as (keyof RelayFacts)[]).every((key) => a[key] === b[key]);
}
