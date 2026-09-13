import { describe, expect, it } from 'vitest';
import { type DigestReport, SyncLedger } from '../src/relay/sync-ledger.js';
import { digest } from './support/message-stage.js';

/** The ledger decides who is right from digests alone: the majority, and the oldest connection on a tie. */

function report(token: string, connectedSince: number, word: number, joinOrder = 0): DigestReport {
  return { token, nick: token.toUpperCase(), connectedSince, joinOrder, digest: digest(word) };
}

const ABC = new Set(['a', 'b', 'c']);
const AB = new Set(['a', 'b']);

describe('sync ledger', () => {
  it('holds a tick until every client in sync has passed it, then names the minority by domain', () => {
    const ledger = new SyncLedger();
    expect(ledger.report(5, report('a', 0, 1))).toBeNull();
    expect(ledger.settle(4, ABC)).toEqual([]);
    expect(ledger.report(5, report('b', 10, 1))).toBeNull();
    expect(ledger.report(5, report('c', 20, 2))).toBeNull();
    const [verdict] = ledger.settle(5, ABC);
    expect(verdict?.reference.token).toBe('a');
    expect(verdict?.outOfSync).toEqual([{ token: 'c', domains: ['rng'] }]);
  });

  it('settles nothing to report when everyone agrees, and settles lower ticks first', () => {
    const ledger = new SyncLedger();
    ledger.report(3, report('a', 0, 1));
    ledger.report(2, report('a', 0, 1));
    ledger.report(1, report('a', 0, 1));
    ledger.report(1, report('b', 5, 1));
    ledger.report(3, report('b', 5, 4));
    ledger.report(2, report('b', 5, 3));
    expect(ledger.settle(3, AB).map((verdict) => verdict.tick)).toEqual([2, 3]);
  });

  it('gives a tie to the longest-connected client, whatever it reported, then to the earlier joiner', () => {
    const ledger = new SyncLedger();
    ledger.report(1, report('newer', 100, 7));
    ledger.report(1, report('older', 1, 9));
    const [verdict] = ledger.settle(1, new Set(['newer', 'older']));
    expect(verdict?.reference.token).toBe('older');
    expect(verdict?.outOfSync.map((entry) => entry.token)).toEqual(['newer']);

    ledger.report(2, report('second', 5, 7, 1));
    ledger.report(2, report('first', 5, 9, 0));
    expect(ledger.settle(2, new Set(['first', 'second']))[0]?.reference.token).toBe('first');
  });

  it('judges a late report against the reference the tick settled on', () => {
    const ledger = new SyncLedger();
    ledger.report(4, report('a', 0, 1));
    expect(ledger.settle(4, new Set(['a']))).toEqual([]);
    expect(ledger.report(4, report('b', 1, 1))).toBeNull();
    expect(ledger.report(4, report('c', 2, 5))?.outOfSync).toEqual([{ token: 'c', domains: ['rng'] }]);
    ledger.pruneBefore(5);
    expect(ledger.report(4, report('d', 3, 5))).toBeNull();
  });

  it('counts only the clients in sync, and drops a tick none of them reported', () => {
    const ledger = new SyncLedger();
    ledger.report(1, report('gone', 0, 2));
    ledger.report(1, report('a', 1, 1));
    ledger.report(2, report('gone', 0, 2));
    expect(ledger.settle(2, new Set(['a']))).toEqual([]);
    expect(ledger.report(1, report('b', 2, 2))?.reference.token).toBe('a');
    expect(ledger.report(2, report('b', 2, 2))).toBeNull();
  });

  it('lets a client’s newer report of a held tick replace its earlier one', () => {
    const ledger = new SyncLedger();
    ledger.report(1, report('a', 0, 1));
    ledger.report(1, report('b', 1, 9));
    ledger.report(1, report('b', 1, 1));
    expect(ledger.settle(1, AB)).toEqual([]);
  });

  it('forgets a client’s held reports once it is out of sync', () => {
    const ledger = new SyncLedger();
    ledger.report(1, report('a', 0, 1));
    ledger.report(1, report('lost', 1, 2));
    ledger.forget('lost');
    expect(ledger.settle(1, new Set(['a', 'lost']))).toEqual([]);
    expect(ledger.report(1, report('b', 2, 2))?.reference.token).toBe('a');
  });
});
