import { MAX_BLOB_MESSAGE_BYTES } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  BYTE_BURST,
  BYTES_PER_SECOND,
  MAX_BUFFERED_BYTES,
  MESSAGE_BURST,
  MESSAGES_PER_SECOND,
  SocketBudget,
  sendBounded,
} from '../src/host/socket-budget.js';

describe('socket traffic budgets', () => {
  it('limits a tiny-message flood and replenishes by elapsed time', () => {
    const budget = new SocketBudget(0);
    for (let i = 0; i < MESSAGE_BURST; i++) expect(budget.take(1, 0)).toBe(true);
    expect(budget.take(1, 0)).toBe(false);
    for (let i = 0; i < MESSAGES_PER_SECOND; i++) expect(budget.take(1, 1000)).toBe(true);
    expect(budget.take(1, 1000)).toBe(false);
  });

  it('allows two maximum snapshots but bounds repeated blob uploads independently of message count', () => {
    const budget = new SocketBudget(0);
    expect(budget.take(MAX_BLOB_MESSAGE_BYTES, 0)).toBe(true);
    expect(budget.take(MAX_BLOB_MESSAGE_BYTES, 0)).toBe(true);
    expect(budget.take(1, 0)).toBe(false);
    expect(budget.take(BYTES_PER_SECOND, 1000)).toBe(true);
    expect(budget.take(1, 1000)).toBe(false);
    expect(budget.take(BYTE_BURST + 1, 1e9)).toBe(false);
  });

  it('disconnects a slow recipient before growing its output queue, counting UTF-8 bytes', () => {
    const slow = {
      OPEN: 1 as const,
      readyState: 1 as const,
      bufferedAmount: MAX_BUFFERED_BYTES - 1,
      send: vi.fn(),
      terminate: vi.fn(),
    };
    const healthy = { ...slow, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    for (const socket of [slow, healthy]) sendBounded(socket, 'ą');
    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledWith('ą');
    expect(healthy.terminate).not.toHaveBeenCalled();
  });
});
