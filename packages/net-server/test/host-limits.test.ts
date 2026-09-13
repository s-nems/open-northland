import { once } from 'node:events';
import { PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MESSAGE_BURST } from '../src/host/socket-budget.js';
import { type RelayHost, startRelayHost } from '../src/host/ws-host.js';

describe('host resource limits', () => {
  let host: RelayHost | null = null;
  afterEach(async () => {
    await host?.close();
  });

  it('refuses excess upgrades while keeping admitted clients and HTTP health available', async () => {
    host = await startRelayHost({ port: 0, maxConnections: 1 });
    const url = `ws://127.0.0.1:${host.port}`;
    const admitted = new WebSocket(url);
    await once(admitted, 'open');
    const excess = new WebSocket(url);
    excess.on('error', () => undefined);
    const status = await new Promise<number | undefined>((resolve) => {
      excess.on('unexpected-response', (_request, response) => {
        response.resume();
        excess.terminate();
        resolve(response.statusCode);
      });
    });
    expect(status).toBe(503);
    expect(host.relay.clientCount).toBe(1);
    expect(admitted.readyState).toBe(WebSocket.OPEN);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
    admitted.terminate();
  });

  it('disconnects a message flood without stopping the relay', async () => {
    host = await startRelayHost({ port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    const welcomed = once(socket, 'message');
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'flood-test-token-1234',
        nick: 'Flood',
      }),
    );
    await welcomed;
    const closed = once(socket, 'close');
    for (let i = 0; i < MESSAGE_BURST * 4; i++) socket.send('{"kind":"listRooms"}');
    const [code, reason] = await closed;
    expect(code).toBe(1002);
    expect(String(reason)).toBe('relay traffic limit');
    expect(host.relay.clientCount).toBe(0);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
  });
});
