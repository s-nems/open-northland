import {
  digestInputsToJson,
  type SyncDigestInputs,
  type SyncDigestInputsJson,
  type SyncDomain,
} from '@open-northland/sim';

/** The verdict for a tick lands once the slowest synced member acknowledged it, so the window must
 *  outlast the relay's slow threshold at the room speed plus a round trip. */
export const DISPUTE_WINDOW_TICKS = 256;

/** The relay's last desync verdict this client took part in, with the fold inputs of that tick. */
export interface DisputeRecord {
  readonly role: 'diverged' | 'reference';
  readonly tick: number;
  readonly domains: readonly SyncDomain[];
  /** The other side: the reference's nick for a diverged member, the diverged nicks for the reference. */
  readonly counterparts: readonly string[];
  /** Null when the tick had already left the window when the verdict arrived. */
  readonly inputs: SyncDigestInputsJson | null;
}

/** The digest inputs of the last acknowledged ticks, kept until a verdict names one of them. A ring
 *  indexed by tick, since one entry lands every tick. */
export class DisputeCapture {
  private readonly ring: (SyncDigestInputs | undefined)[] = new Array(DISPUTE_WINDOW_TICKS);
  private latest: DisputeRecord | null = null;

  get record(): DisputeRecord | null {
    return this.latest;
  }

  retain(inputs: SyncDigestInputs): void {
    this.ring[inputs.tick % DISPUTE_WINDOW_TICKS] = inputs;
  }

  /** Keep the verdict for `tick` as the latest record, with that tick's inputs while the ring holds them. */
  freeze(
    role: DisputeRecord['role'],
    tick: number,
    domains: readonly SyncDomain[],
    counterparts: readonly string[],
  ): void {
    const inputs = this.ring[tick % DISPUTE_WINDOW_TICKS];
    this.latest = {
      role,
      tick,
      domains,
      counterparts,
      inputs: inputs?.tick === tick ? digestInputsToJson(inputs) : null,
    };
  }

  /** Drop the dropped world's inputs; the record stays, since a report needs it after the world. */
  forgetWorld(): void {
    this.ring.fill(undefined);
  }
}
