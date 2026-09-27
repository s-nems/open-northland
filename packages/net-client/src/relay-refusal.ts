import type { RelayReason } from '@open-northland/net-protocol';

/** A request the relay refused, carried as an error so the host can word `reason` for its player. */
export class RelayRefusal extends Error {
  constructor(readonly reason: RelayReason) {
    super(`the relay refused: ${JSON.stringify(reason)}`);
    this.name = 'RelayRefusal';
  }
}
