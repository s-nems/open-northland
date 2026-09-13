import { clientMessageKind, MAX_BLOB_MESSAGE_BYTES } from '@open-northland/net-protocol';
import type { WebSocket } from 'ws';

export const DEFAULT_MAX_CONNECTIONS = 256;
export const MESSAGES_PER_SECOND = 256;
export const MESSAGE_BURST = MESSAGES_PER_SECOND * 2;
export const BYTES_PER_SECOND = 1024 * 1024;
export const BYTE_BURST = MAX_BLOB_MESSAGE_BYTES * 2;
export const MAX_BUFFERED_BYTES = MAX_BLOB_MESSAGE_BYTES * 2;

/** Deployment budgets allow snapshot bursts alongside acknowledgements at the maximum game speed. */
export class SocketBudget {
  private messages = MESSAGE_BURST;
  private bytes = BYTE_BURST;

  constructor(private updatedAt: number) {}

  take(bytes: number, now: number): boolean {
    const seconds = Math.max(0, now - this.updatedAt) / 1000;
    this.updatedAt = now;
    this.messages = Math.min(MESSAGE_BURST, this.messages + seconds * MESSAGES_PER_SECOND);
    this.bytes = Math.min(BYTE_BURST, this.bytes + seconds * BYTES_PER_SECOND);
    if (this.messages < 1 || this.bytes < bytes) return false;
    this.messages--;
    this.bytes -= bytes;
    return true;
  }
}

export function sendBounded(
  socket: Pick<WebSocket, 'readyState' | 'OPEN' | 'bufferedAmount' | 'send' | 'terminate'>,
  text: string,
): void {
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount + Buffer.byteLength(text) > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }
  socket.send(text);
}

/** Recovery can return a full snapshot or replay for a tiny request. */
export class RecoveryBudget {
  private remaining = 4;

  constructor(private updatedAt: number) {}

  take(raw: unknown, now: number): boolean {
    const kind = clientMessageKind(raw);
    if (kind !== 'loaded' && kind !== 'saveOrders' && kind !== 'requestInitialSave') return true;
    this.remaining = Math.min(4, this.remaining + Math.max(0, now - this.updatedAt) / 2000);
    this.updatedAt = now;
    if (this.remaining < 1) return false;
    this.remaining--;
    return true;
  }
}
