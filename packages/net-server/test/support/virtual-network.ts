import type { ClientMessage, ServerMessage } from '@open-northland/net-protocol';
import type { Connection, Relay } from '@open-northland/net-server';

/** A relay client as the network reaches it: what arrives, and where it sends. */
export interface LinkedClient {
  receive(raw: unknown): void;
  attach(send: (message: ClientMessage) => void): void;
}

/** mulberry32: a small seeded generator, so an injected jitter schedule is the same on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VirtualClock {
  private ms = 0;

  readonly now = (): number => this.ms;

  tick(elapsedMs: number): void {
    this.ms += elapsedMs;
  }
}

export interface LinkOptions {
  /** Round trip in milliseconds, split evenly between the two directions. */
  readonly latencyMs?: number;
  /** Peak-to-peak variation of each one-way trip. */
  readonly jitterMs?: number;
  readonly uploadBytesPerSecond?: number;
  readonly downloadBytesPerSecond?: number;
}

/** One client's connection to the relay, and the two ways it can end. */
export interface Link {
  /** Close the socket: the relay learns at once, as it does from a TCP close. */
  close(): void;
  /** Blackhole one direction, or both by default, without notifying the relay. */
  cut(direction?: 'up' | 'down'): void;
}

interface Direction {
  lastAt: number;
  availableAt: number;
}

interface Delivery {
  readonly at: number;
  readonly seq: number;
  readonly run: () => void;
}

/**
 * In-memory links between headless clients and one relay on a virtual clock. Messages cross a link
 * after serialization, bandwidth delay and seeded jitter, in order per direction. A large message
 * blocks later messages on that direction, as it does on a TCP connection.
 */
export class VirtualNetwork {
  private readonly queue: Delivery[] = [];
  private seq = 0;

  constructor(
    private readonly clock: VirtualClock,
    private readonly relay: Relay,
    private readonly random: () => number = seededRandom(1),
  ) {}

  /** Connect `client` over a fresh link; a client linked again speaks through the new one. */
  link(client: LinkedClient, options: LinkOptions = {}): Link {
    const latency = options.latencyMs ?? 0;
    const jitter = options.jitterMs ?? 0;
    const up: Direction = { lastAt: 0, availableAt: 0 };
    const down: Direction = { lastAt: 0, availableAt: 0 };
    let alive = true;
    let upAlive = true;
    let downAlive = true;
    const oneWay = (): number => Math.max(0, latency / 2 + (this.random() - 0.5) * jitter);
    const connection: Connection = {
      send: (message: ServerMessage) => {
        if (!alive || !downAlive) return;
        const text = JSON.stringify(message);
        this.schedule(down, oneWay(), Buffer.byteLength(text), options.downloadBytesPerSecond, () => {
          if (alive && downAlive) client.receive(JSON.parse(text));
        });
      },
      close: () => {
        alive = false;
      },
    };
    const handle = this.relay.connect(connection);
    client.attach((message: ClientMessage) => {
      if (!alive || !upAlive) return;
      const text = JSON.stringify(message);
      const bytes = Buffer.byteLength(text);
      this.schedule(up, oneWay(), bytes, options.uploadBytesPerSecond, () => {
        if (alive && upAlive) this.relay.receive(handle, JSON.parse(text), bytes);
      });
    });
    return {
      close: () => {
        if (!alive) return;
        alive = false;
        this.relay.disconnect(handle);
      },
      cut: (direction) => {
        if (direction !== 'down') upAlive = false;
        if (direction !== 'up') downAlive = false;
      },
    };
  }

  /** Deliver everything due by now, in order. */
  flush(): void {
    const now = this.clock.now();
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next === undefined || next.at > now) return;
      this.queue.shift();
      next.run();
    }
  }

  private schedule(
    direction: Direction,
    delayMs: number,
    bytes: number,
    bytesPerSecond: number | undefined,
    run: () => void,
  ): void {
    const duration = bytesPerSecond === undefined ? 0 : (bytes / bytesPerSecond) * 1000;
    direction.availableAt = Math.max(this.clock.now(), direction.availableAt) + duration;
    const at = Math.max(direction.availableAt + delayMs, direction.lastAt);
    direction.lastAt = at;
    const delivery = { at, seq: this.seq++, run };
    // Insert behind everything due at or before it: the queue stays ordered by (at, seq).
    let index = this.queue.length;
    while (index > 0) {
      const before = this.queue[index - 1];
      if (before === undefined || before.at <= at) break;
      index--;
    }
    this.queue.splice(index, 0, delivery);
  }
}
