import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import { PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { MESSAGE_BURST } from '../src/host/socket-budget.js';
import { type RelayHost, startRelayHost } from '../src/host/ws-host.js';

describe('host resource limits', () => {
  let host: RelayHost | null = null;
  afterEach(async () => {
    await host?.close();
  });

  it('bounds TCP sockets that never send HTTP headers, then recovers capacity', async () => {
    host = await startRelayHost({ port: 0, maxConnections: 1 });
    const held: Socket[] = [];
    try {
      for (let i = 0; i < 17; i++) {
        const socket = connect(host.port, '127.0.0.1');
        held.push(socket);
        await once(socket, 'connect');
      }
      const excess = connect(host.port, '127.0.0.1');
      held.push(excess);
      await once(excess, 'close');
      expect(held.slice(0, 17).every((socket) => !socket.destroyed)).toBe(true);
      const closed = held.slice(0, 17).map((socket) => once(socket, 'close'));
      for (const socket of held) socket.destroy();
      await Promise.all(closed);
      expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
    } finally {
      for (const socket of held) socket.destroy();
    }
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

  it.each(['ping', 'pong'] as const)('bounds WebSocket %s floods before automatic replies', async (kind) => {
    host = await startRelayHost({ port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    let replies = 0;
    socket.on('pong', () => replies++);
    if (kind === 'ping') {
      const reply = once(socket, 'pong');
      socket.ping('ordinary keepalive');
      await reply;
      expect(replies).toBe(1);
    }
    const closed = once(socket, 'close');
    for (let i = 0; i < MESSAGE_BURST * 4; i++) socket[kind]('flood');
    const [code, reason] = await closed;
    expect(code).toBe(1002);
    expect(String(reason)).toBe('relay traffic limit');
    expect(replies).toBeLessThan(MESSAGE_BURST * 2);
    expect(host.relay.clientCount).toBe(0);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
  });

  it('stops repeated recovery requests before dispatching expensive relay work', async () => {
    host = await startRelayHost({ port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    const welcomed = once(socket, 'message');
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'recovery-flood-token',
        nick: 'Flood',
      }),
    );
    await welcomed;
    const receive = vi.spyOn(host.relay, 'receive');
    const closed = once(socket, 'close');
    for (let i = 0; i < 10; i++) socket.send(JSON.stringify({ kind: 'loaded', tick: null }));
    const [code, reason] = await closed;
    expect(code).toBe(1002);
    expect(String(reason)).toBe('relay traffic limit');
    expect(receive).toHaveBeenCalledTimes(4);
    expect(host.relay.clientCount).toBe(0);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
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
