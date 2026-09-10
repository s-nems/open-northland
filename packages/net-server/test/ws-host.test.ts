import { randomUUID } from 'node:crypto';
import { connect as connectTcp } from 'node:net';
import type { GameSession } from '@open-northland/lockstep';
import { PROTOCOL_VERSION, type RoomSettings } from '@open-northland/net-protocol';
import { HEALTH_PATH, type RelayHost, startRelayHost } from '@open-northland/net-server';
import { playerCommand, restoreSimulation, type SaveGame, Simulation } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';

/**
 * The WebSocket host over a real socket: what the in-memory tests prove, once, through the wire.
 * `ON_RELAY_URL=wss://…` points the same run at a deployed relay instead of a host started here.
 */

const REMOTE_URL = process.env.ON_RELAY_URL;

const SETTINGS: RoomSettings = {
  name: 'socket',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
const SEATS = [
  { player: 0, mode: 'idle', color: 0 },
  { player: 1, mode: 'idle', color: 1 },
] as const;
const RUN_TICKS = 24;
const POLL_MS = 10;
const STEP_TIMEOUT_MS = 5000;
const SESSION_TIMEOUT_MS = 30_000;

async function buildWorld(session: GameSession): Promise<Simulation> {
  return new Simulation({ seed: session.seed, content: testContent() });
}

async function restoreWorld(_session: GameSession, save: SaveGame): Promise<Simulation> {
  return restoreSimulation(save, { content: testContent() }).sim;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + STEP_TIMEOUT_MS;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(POLL_MS);
  }
}

interface Target {
  readonly url: string;
  readonly host: RelayHost | null;
}

async function target(): Promise<Target> {
  if (REMOTE_URL !== undefined) return { url: REMOTE_URL, host: null };
  const host = await startRelayHost({ port: 0 });
  return { url: `ws://127.0.0.1:${host.port}`, host };
}

/** The health endpoint beside the WebSocket: the same origin over plain HTTP. */
function healthUrl(url: string): string {
  const http = new URL(url);
  http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
  http.pathname = HEALTH_PATH;
  return http.toString();
}

async function connect(url: string, nick: string): Promise<{ client: HeadlessClient; socket: WebSocket }> {
  const socket = new WebSocket(url);
  const client = new HeadlessClient({
    token: `${nick.toLowerCase()}-${randomUUID()}`,
    nick,
    buildWorld,
    restoreWorld,
  });
  socket.addEventListener('message', (event) => client.receive(JSON.parse(String(event.data))));
  client.attach((message) => socket.send(JSON.stringify(message)));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket failed to open')));
  });
  return { client, socket };
}

describe('websocket host', () => {
  let host: RelayHost | null = null;
  afterEach(async () => {
    await host?.close();
    host = null;
  });

  it(
    'plays a session between two clients over real sockets',
    async () => {
      const relay = await target();
      host = relay.host;
      const a = await connect(relay.url, 'Ania');
      const b = await connect(relay.url, 'Bartek');
      const clients = [a.client, b.client];
      for (const client of clients) client.hello();
      await until(() => clients.every((client) => client.welcomed), 'welcome');
      a.client.createRoom(SETTINGS, SEATS);
      await until(() => a.client.room !== null, 'the room');
      const roomId = a.client.room?.id ?? '';
      b.client.joinRoom(roomId);
      await until(() => b.client.room !== null, 'the join');
      a.client.claimSeat(0);
      b.client.claimSeat(1);
      await until(() => a.client.room?.seats.every((seat) => seat.nick !== null) === true, 'the seats');
      a.client.setReady(true);
      b.client.setReady(true);
      await until(() => a.client.room?.seats.every((seat) => seat.ready) === true, 'readiness');
      a.client.start();
      await until(() => clients.every((client) => client.session !== null), 'the start');
      await Promise.all(clients.map((client) => client.settled()));
      await until(() => clients.every((client) => client.clockNotices.length > 0), 'the clock');

      const hashes = new Map<HeadlessClient, string>();
      let last = performance.now();
      while (hashes.size < clients.length) {
        await sleep(POLL_MS);
        const now = performance.now();
        const elapsed = now - last;
        last = now;
        for (const client of clients) {
          if (hashes.has(client)) continue;
          client.advance(elapsed, () => {
            const sim = client.sim;
            if (sim === null) return;
            const seat = client.session?.localSeat;
            if (typeof seat === 'number' && sim.tick % 5 === seat) {
              client.submit(
                playerCommand(seat, {
                  kind: 'setAssistantCounter',
                  player: seat,
                  counter: 'extraMen',
                  value: sim.tick,
                  infinite: false,
                }),
              );
            }
            if (sim.tick === RUN_TICKS) hashes.set(client, sim.hashState());
          });
        }
      }
      expect(hashes.get(a.client)).toBe(hashes.get(b.client));
      expect(a.client.sim?.commands.log.length).toBeGreaterThan(0);
      expect(
        a.client.sim?.commands.log.map((entry) => [entry.applyTick, entry.sequence, entry.command]),
      ).toEqual(b.client.sim?.commands.log.map((entry) => [entry.applyTick, entry.sequence, entry.command]));
      a.socket.close();
      b.socket.close();
    },
    SESSION_TIMEOUT_MS,
  );

  it('closes a connection that speaks before hello', async () => {
    const relay = await target();
    host = relay.host;
    const { client, socket } = await connect(relay.url, 'Cezary');
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener('close', resolve));
    client.say('hej');
    const event = await closed;
    expect(client.errors).toEqual(['hello first']);
    expect(event.reason).toBe('hello first');
  });

  it.skipIf(REMOTE_URL !== undefined)('survives a request target the URL parser would refuse', async () => {
    const relay = await target();
    host = relay.host;
    const port = new URL(relay.url).port;
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connectTcp(Number(port), '127.0.0.1', () => {
        socket.write('GET http://a:99999/ HTTP/1.1\r\nHost: relay\r\nConnection: close\r\n\r\n');
      });
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk.toString();
      });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
    expect(answer).toMatch(/^HTTP\/1\.1 404/);
    const response = await fetch(healthUrl(relay.url));
    expect(response.status).toBe(200);
  });

  it('answers the health check with what it speaks, and nothing else over plain HTTP', async () => {
    const relay = await target();
    host = relay.host;
    const response = await fetch(healthUrl(relay.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const health = await response.json();
    expect(health).toMatchObject({ ok: true, protocol: PROTOCOL_VERSION });
    expect(typeof health.rooms).toBe('number');
    expect(typeof health.clients).toBe('number');
    expect(typeof health.uptimeSeconds).toBe('number');
    const missing = await fetch(new URL('/no-such-path', healthUrl(relay.url)));
    expect(missing.status).toBe(404);
    if (relay.host !== null) expect(relay.host.health()).toMatchObject({ url: null, build: null });
  });
});
