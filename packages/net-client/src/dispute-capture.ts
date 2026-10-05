import { MAX_SPEED, TICK_MS } from '@open-northland/net-protocol';
import {
  digestInputsToJson,
  type SyncDigestInputs,
  type SyncDigestInputsJson,
  type SyncDomain,
} from '@open-northland/sim';

/** How far behind the relay lets a member fall before it paces the room, at worst: the relay's
 *  `LAG_BEHIND_MS` plus its `SLOW_GRACE_MS`, which this package cannot import; a test holds the window
 *  above it. */
const RELAY_SLOW_BEHIND_MS = 5000;
/** Room over the slow threshold for the round trip and the governed catch-up. */
const WINDOW_MARGIN = 2;

/**
 * The verdict for a tick lands once the slowest synced member acknowledged it, so the window covers the
 * relay's slow threshold at the top speed, with a margin. An approximation, not a bound: the governor
 * paces rather than holds, so a member slower than the governed floor can trail further, and a verdict
 * then finds its tick gone and records no inputs.
 */
export const DISPUTE_WINDOW_TICKS = Math.ceil((RELAY_SLOW_BEHIND_MS / TICK_MS) * MAX_SPEED) * WINDOW_MARGIN;

/** The relay's last desync verdict this client took part in, with the fold inputs of that tick. */
export interface DisputeRecord {
  readonly role: 'diverged' | 'reference';
  readonly tick: number;
  readonly domains: readonly SyncDomain[];
  /** The other side: the reference's nick for a diverged member, the diverged nicks for the reference. */
  readonly counterparts: readonly string[];
  /** Null when the tick had already left the window, or the byte cap, when the verdict arrived. */
  readonly inputs: SyncDigestInputsJson | null;
}

/** The most a client keeps for dispute capture, in bytes as {@link retainedBytes} counts them. Measured
 *  heap of a full window on the six-AI `magiczny_las` run: 20 MB at tick 40k, 25 MB at 60k, 23 to 49 MB
 *  at 80k to 100k as the population grows; past the cap the oldest ticks go first. */
export const DISPUTE_RING_BYTES = 24 * 2 ** 20;
/** Heap one fold-input record costs beyond its words: the record and its two typed arrays with their
 *  buffers. The same run measured about 500 bytes per record at four of five sampled ticks (heap
 *  growth of a held window, less its words), with outliers of 210 and 990. */
const RECORD_OVERHEAD_BYTES = 512;

/** What holding `inputs` costs the heap, by the measured overhead per record. */
export function retainedBytes(inputs: SyncDigestInputs): number {
  let bytes = inputs.allocations.byteLength + inputs.fog.byteLength + RECORD_OVERHEAD_BYTES;
  for (const component of inputs.components)
    bytes += component.entities.byteLength + component.words.byteLength + RECORD_OVERHEAD_BYTES;
  return bytes;
}

interface Held {
  readonly inputs: SyncDigestInputs;
  readonly bytes: number;
}

/** The digest inputs of the last acknowledged ticks, kept until a verdict names one of them: at most
 *  `DISPUTE_WINDOW_TICKS` ticks and `DISPUTE_RING_BYTES`, oldest dropped first, the newest always kept. */
export class DisputeCapture {
  /** By tick, oldest first: one entry lands every tick. */
  private readonly held = new Map<number, Held>();
  private heldBytes = 0;
  private latest: DisputeRecord | null = null;

  get record(): DisputeRecord | null {
    return this.latest;
  }

  retain(inputs: SyncDigestInputs): void {
    this.drop(inputs.tick);
    const bytes = retainedBytes(inputs);
    this.held.set(inputs.tick, { inputs, bytes });
    this.heldBytes += bytes;
    for (const tick of this.held.keys()) {
      if (tick === inputs.tick) break;
      if (tick > inputs.tick - DISPUTE_WINDOW_TICKS && this.heldBytes <= DISPUTE_RING_BYTES) break;
      this.drop(tick);
    }
  }

  /** Keep the verdict for `tick` as the latest record, with that tick's inputs while they are held. */
  freeze(
    role: DisputeRecord['role'],
    tick: number,
    domains: readonly SyncDomain[],
    counterparts: readonly string[],
  ): void {
    const inputs = this.held.get(tick)?.inputs;
    this.latest = {
      role,
      tick,
      domains,
      counterparts,
      inputs: inputs === undefined ? null : digestInputsToJson(inputs),
    };
  }

  /** Drop the dropped world's inputs; the record stays, since a report needs it after the world. */
  forgetWorld(): void {
    this.held.clear();
    this.heldBytes = 0;
  }

  private drop(tick: number): void {
    const held = this.held.get(tick);
    if (held === undefined) return;
    this.held.delete(tick);
    this.heldBytes -= held.bytes;
  }
}
