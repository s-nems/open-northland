import { randomBytes } from 'node:crypto';
import { clientMessageKind, MAX_BLOB_MESSAGE_BYTES } from '@open-northland/net-protocol';
import type { WebSocket } from 'ws';

export const DEFAULT_MAX_CONNECTIONS = 256;
export const MESSAGES_PER_SECOND = 256;
export const MESSAGE_BURST = MESSAGES_PER_SECOND * 2;
export const BYTES_PER_SECOND = 1024 * 1024;
export const BYTE_BURST = MAX_BLOB_MESSAGE_BYTES * 2;
export const MAX_BUFFERED_BYTES = MAX_BLOB_MESSAGE_BYTES * 2;
/** Control pongs can keep a slow download alive before its complete JSON message is delivered. */
const TEXT_FRAGMENT_BYTES = 128 * 1024;
// RFC 6455: an unmasked frame needs at most 10 header bytes; a control frame is at most 127 bytes.
const MAX_FRAME_HEADER_BYTES = 10;
const MAX_CONTROL_FRAME_BYTES = 127;

/** Deployment budgets allow snapshot bursts alongside acknowledgements at the maximum game speed. */
export class SocketBudget {
  private messages = MESSAGE_BURST;
  private bytes = BYTE_BURST;

  constructor(private updatedAt: number) {}

  take(bytes: number, now: number, messageCost: 0 | 1 = 1): boolean {
    const seconds = Math.max(0, now - this.updatedAt) / 1000;
    this.updatedAt = now;
    this.messages = Math.min(MESSAGE_BURST, this.messages + seconds * MESSAGES_PER_SECOND);
    this.bytes = Math.min(BYTE_BURST, this.bytes + seconds * BYTES_PER_SECOND);
    if (this.messages < messageCost || this.bytes < bytes) return false;
    this.messages -= messageCost;
    this.bytes -= bytes;
    return true;
  }
}

/** Server-requested pongs use bytes, but do not spend the recipient's application message budget. */
export class ControlPings {
  private readonly challenge = randomBytes(16);
  private issued = 0n;
  private acknowledged = 0n;

  request(): Buffer | null {
    if (this.issued - this.acknowledged >= BigInt(MESSAGE_BURST)) return null;
    const payload = Buffer.alloc(this.challenge.length + 8);
    this.challenge.copy(payload);
    payload.writeBigUInt64BE(++this.issued, this.challenge.length);
    return payload;
  }

  answer(data: Buffer): boolean {
    if (
      data.length !== this.challenge.length + 8 ||
      !data.subarray(0, this.challenge.length).equals(this.challenge)
    )
      return false;
    const sequence = data.readBigUInt64BE(this.challenge.length);
    if (sequence <= this.acknowledged || sequence > this.issued) return false;
    // RFC 6455 permits a peer to answer only the newest of several pending pings.
    this.acknowledged = sequence;
    return true;
  }
}

export function sendBounded(
  socket: Pick<WebSocket, 'readyState' | 'OPEN' | 'bufferedAmount' | 'send' | 'ping' | 'terminate'>,
  text: string,
  ping: () => void = () => socket.ping(),
): void {
  if (socket.readyState !== socket.OPEN) return;
  const byteLength = Buffer.byteLength(text);
  const fragments = Math.max(1, Math.ceil(byteLength / TEXT_FRAGMENT_BYTES));
  const overhead = fragments * MAX_FRAME_HEADER_BYTES + (fragments - 1) * MAX_CONTROL_FRAME_BYTES;
  if (socket.bufferedAmount + byteLength + overhead > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }
  if (byteLength <= TEXT_FRAGMENT_BYTES) {
    socket.send(text);
    return;
  }
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += TEXT_FRAGMENT_BYTES) {
    const end = Math.min(offset + TEXT_FRAGMENT_BYTES, bytes.length);
    const fin = end === bytes.length;
    socket.send(bytes.subarray(offset, end), { binary: false, fin });
    if (!fin) ping();
  }
}

/** Recovery requests held in reserve, and the time one of them takes to come back. */
const RECOVERY_BURST = 4;
const RECOVERY_REFILL_MS = 2000;

/** Recovery can return a full snapshot or replay for a tiny request. */
export class RecoveryBudget {
  private remaining = RECOVERY_BURST;

  constructor(private updatedAt: number) {}

  take(raw: unknown, now: number): boolean {
    const kind = clientMessageKind(raw);
    if (kind !== 'loaded' && kind !== 'saveOrders' && kind !== 'requestInitialSave') return true;
    this.remaining = Math.min(
      RECOVERY_BURST,
      this.remaining + Math.max(0, now - this.updatedAt) / RECOVERY_REFILL_MS,
    );
    this.updatedAt = now;
    if (this.remaining < 1) return false;
    this.remaining--;
    return true;
  }
}
