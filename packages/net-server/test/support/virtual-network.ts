import type { ClientMessage, ServerMessage } from '@open-northland/net-protocol';
import type { Connection, Relay } from '@open-northland/net-server';
import type { HeadlessClient } from './headless-client.js';

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
}

interface Direction {
  lastAt: number;
}

interface Delivery {
  readonly at: number;
  readonly seq: number;
  readonly run: () => void;
}

/**
 * In-memory links between headless clients and one relay on a virtual clock. Messages cross a link
 * after its latency plus a seeded jitter, in order per direction, as JSON: the shape the wire has.
 */
export class VirtualNetwork {
  private readonly queue: Delivery[] = [];
  private seq = 0;

  constructor(
    private readonly clock: VirtualClock,
    private readonly relay: Relay,
    private readonly random: () => number = seededRandom(1),
  ) {}

  link(client: HeadlessClient, options: LinkOptions = {}): void {
    const latency = options.latencyMs ?? 0;
    const jitter = options.jitterMs ?? 0;
    const up: Direction = { lastAt: 0 };
    const down: Direction = { lastAt: 0 };
    let alive = true;
    const oneWay = (): number => Math.max(0, latency / 2 + (this.random() - 0.5) * jitter);
    const connection: Connection = {
      send: (message: ServerMessage) => {
        if (!alive) return;
        this.schedule(down, oneWay(), () => {
          if (alive) client.receive(JSON.parse(JSON.stringify(message)));
        });
      },
      close: () => {
        alive = false;
      },
    };
    const handle = this.relay.connect(connection);
    client.attach((message: ClientMessage) => {
      if (!alive) return;
      this.schedule(up, oneWay(), () => {
        if (alive) this.relay.receive(handle, JSON.parse(JSON.stringify(message)));
      });
    });
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

  private schedule(direction: Direction, delayMs: number, run: () => void): void {
    const at = Math.max(this.clock.now() + delayMs, direction.lastAt);
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
