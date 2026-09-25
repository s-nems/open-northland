import type { ResidentRow } from '../../tool-panel/residents/rows.js';

/** The longest the kicker's "i / n" may lag behind births, deaths and trade changes: the list is a walk
 *  over the seat's people, so it runs on a selection change and at most this often, never per tick. */
export const PEERS_REFRESH_MS = 5000;

/** The seat's people of one trade in a stable order, and where the selected one stands among them. */
export interface TradePeers {
  readonly ids: readonly number[];
  /** Index of the selected settler in `ids`, -1 when it is not among them (another seat's person). */
  readonly index: number;
}

export const NO_PEERS: TradePeers = { ids: [], index: -1 };

export function tradePeers(
  rows: readonly ResidentRow[],
  jobType: number | null,
  selected: number,
): TradePeers {
  const ids = rows
    .filter((row) => row.jobType === jobType)
    .map((row) => row.id)
    .sort((a, b) => a - b);
  return { ids, index: ids.indexOf(selected) };
}

/** The peer a step lands on, wrapping at both ends; null when there is no one else to step to. */
export function peerAt(peers: TradePeers, step: 1 | -1): number | null {
  const count = peers.ids.length;
  if (peers.index < 0 || count < 2) return null;
  return peers.ids[(peers.index + step + count) % count] ?? null;
}

/** The peer list of the shown settler, recomputed on a selection change and at most every
 *  {@link PEERS_REFRESH_MS}. */
export interface PeerIndex {
  peersOf(selected: number, jobType: number | null, structural: boolean): TradePeers;
}

export function createPeerIndex(rows: () => readonly ResidentRow[], now: () => number): PeerIndex {
  let cached: { peers: TradePeers; selected: number; jobType: number | null; at: number } | null = null;
  return {
    peersOf(selected, jobType, structural): TradePeers {
      const at = now();
      const fresh =
        cached !== null &&
        !structural &&
        cached.selected === selected &&
        cached.jobType === jobType &&
        at - cached.at < PEERS_REFRESH_MS;
      if (fresh && cached !== null) return cached.peers;
      const peers = tradePeers(rows(), jobType, selected);
      cached = { peers, selected, jobType, at };
      return peers;
    },
  };
}
