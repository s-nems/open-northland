import { once } from 'node:events';
import { Socket } from 'node:net';
import { PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { SILENT_SOCKET_MS, startRelayHost } from '../src/host/ws-host.js';

it('keeps an unfinished upload alive while bytes arrive, then closes it when progress stops', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
  const host = await startRelayHost({ port: 0, host: '127.0.0.1' });
  const client = new WebSocket(`ws://127.0.0.1:${host.port}`, { autoPong: false });
  // Observe actual TCP delivery after its listeners ran, without a sleep or a control pong that
  // would itself refresh liveness and hide whether partial upload bytes counted.
  const emit = Socket.prototype.emit;
  let delivered: ((socket: Socket) => void) | null = null;
  const delivery = vi.spyOn(Socket.prototype, 'emit').mockImplementation(function (
    this: Socket,
    event,
    ...args
  ) {
    const result = emit.call(this, event, ...args);
    if (event === 'data' && this.localPort === host.port) delivered?.(this);
    return result;
  });
  const fragment = (text: string): Promise<Socket> =>
    new Promise((resolve) => {
      delivered = resolve;
      client.send(text, { fin: false });
    });
  try {
    await once(client, 'open');
    const welcome = once(client, 'message');
    client.send(
      JSON.stringify({
        kind: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'upload-liveness-token',
        nick: 'Uploader',
      }),
    );
    await welcome;
    const receive = vi.spyOn(host.relay, 'receive');
    vi.advanceTimersByTime(SILENT_SOCKET_MS - 5000);
    const transport = await fragment('{"kind":"chat","text":"');
    vi.advanceTimersByTime(SILENT_SOCKET_MS - 5000);
    expect(transport.destroyed).toBe(false);
    await fragment('still uploading');
    expect(receive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SILENT_SOCKET_MS - 5000);
    expect(transport.destroyed).toBe(false);
    const closed = once(client, 'close');
    vi.advanceTimersByTime(5000);
    expect(transport.destroyed).toBe(true);
    const [code] = await closed;
    expect(code).toBe(1006);
  } finally {
    delivered = null;
    client.terminate();
    await host.close();
    delivery.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
