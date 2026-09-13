import type { GameSession } from '@open-northland/lockstep';
import {
  decodeSnapshot,
  type OpenedWorld,
  prepareInitialSave,
  RelayClient,
  type WorldPort,
} from '@open-northland/net-client';
import { type ClientMessage, DESCRIPTOR_WORLD, PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { exportSaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  seats: [
    { player: 0, mode: 'human', color: 0 },
    { player: 1, mode: 'human', color: 1 },
  ],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
const RESTORED_TICK = 40;

function harness(port: Partial<WorldPort>) {
  const sent: ClientMessage[] = [];
  const worlds: OpenedWorld[] = [];
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    world: {
      open: port.open ?? (async () => null),
      restore: port.restore ?? (async () => null),
    },
    onWorld: (world) => worlds.push(world),
  });
  client.attach((message) => sent.push(message));
  return { client, sent, worlds };
}

function start(client: RelayClient, snapshotTick: number | null): void {
  client.receive({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  client.receive({ kind: 'start', session: SESSION, snapshotTick });
}

describe('RelayClient and its world port', () => {
  it('uploads the captured manual save rather than exporting a later live tick', async () => {
    const sim = new Simulation({ seed: 3, content: testContent() });
    const { client, sent } = harness({ open: async () => ({ sim, generation: DESCRIPTOR_WORLD }) });
    start(client, null);
    await client.settled();
    const save = exportSaveGame(sim, { savedAt: 123, session: { example: 'captured' } });
    sim.step();
    await client.shareSave(null, save);
    const upload = sent.find((message) => message.kind === 'blob' && message.type === 'save');
    expect(upload).toMatchObject({ tick: 0 });
    if (upload?.kind !== 'blob') throw new Error('missing uploaded save');
    expect(await decodeSnapshot(upload.bytes)).toEqual(save);
  });

  it('does not adopt a descriptor world for a saved room or restore corrupt initial bytes', async () => {
    const sim = new Simulation({ seed: 3, content: testContent() });
    const prepared = await prepareInitialSave(exportSaveGame(sim));
    let restores = 0;
    const { client, sent, worlds } = harness({
      open: async () => ({ sim, generation: 0 }),
      restore: async () => {
        restores++;
        return { sim, generation: 0 };
      },
    });
    client.receive({
      kind: 'start',
      session: { ...SESSION, initialSave: prepared.identity },
      snapshotTick: 0,
    });
    await client.settled();
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: null });
    expect(worlds).toHaveLength(0);
    client.receive({ kind: 'blob', type: 'snapshot', from: 'creator', tick: 0, bytes: 'AAAA' });
    await expect(client.settled()).rejects.toThrow('fingerprint');
    expect(restores).toBe(0);
    expect(client.sim).toBeNull();
    client.receive({ kind: 'blob', type: 'snapshot', from: 'creator', tick: 0, bytes: prepared.bytes });
    await client.settled();
    expect(restores).toBe(1);
    expect(client.sim).toBe(sim);
  });

  it('reports a world the port built with the descriptor generation', async () => {
    const { client, sent, worlds } = harness({
      open: async () => ({
        sim: new Simulation({ seed: 3, content: testContent() }),
        generation: DESCRIPTOR_WORLD,
      }),
    });
    start(client, null);
    await client.settled();
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD });
    expect(worlds).toHaveLength(1);
    expect(client.tick).toBe(0);
  });

  it('asks for the cached snapshot when the port opens nothing', async () => {
    const { client, sent } = harness({});
    start(client, 12);
    await client.settled();
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: null });
    expect(client.sim).toBeNull();
  });

  it('reports a world the port restored under its snapshot generation', async () => {
    const { client, sent } = harness({
      open: async () => {
        const sim = new Simulation({ seed: 3, content: testContent() });
        for (let i = 0; i < RESTORED_TICK; i++) sim.step();
        return { sim, generation: sim.tick };
      },
    });
    start(client, RESTORED_TICK);
    await client.settled();
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: RESTORED_TICK, world: RESTORED_TICK });
  });

  it('keeps no world when the port rebuilds a served snapshot elsewhere', async () => {
    let restores = 0;
    const { client } = harness({
      open: async () => ({
        sim: new Simulation({ seed: 3, content: testContent() }),
        generation: DESCRIPTOR_WORLD,
      }),
      restore: async () => {
        restores++;
        return null;
      },
    });
    start(client, null);
    await client.settled();
    client.receive({ kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' });
    expect(client.sim).toBeNull();
    expect(client.isOutOfSync).toBe(true);
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 5, bytes: 'AAAA' });
    await client.settled();
    expect(restores).toBe(1);
    expect(client.sim).toBeNull();
  });

  it('answers a repeated start with the world it holds, and asks with null while out of sync', async () => {
    const { client, sent } = harness({
      open: async () => ({
        sim: new Simulation({ seed: 3, content: testContent() }),
        generation: DESCRIPTOR_WORLD,
      }),
    });
    start(client, null);
    await client.settled();
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD });
    client.receive({ kind: 'desync', tick: 1, domains: ['entities'], reference: 'Bartek' });
    client.receive({ kind: 'start', session: SESSION, snapshotTick: 1 });
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: null });
  });

  it('requests a clock change only when it differs from the relay’s last word', () => {
    const { client, sent } = harness({});
    start(client, 12);
    client.receive({ kind: 'clock', tick: 1, speed: 2, paused: false, by: null });
    sent.length = 0;
    client.setSpeed(2);
    client.setPaused(false);
    expect(sent).toEqual([]);
    client.setPaused(true);
    client.setSpeed(3);
    expect(sent).toEqual([
      { kind: 'clock', paused: true },
      { kind: 'clock', speed: 3 },
    ]);
    expect(client.paused).toBe(false);
    expect(client.speed).toBe(2);
  });

  it('answers a ping and keeps the round trip it carried', () => {
    const { client, sent } = harness({});
    client.receive({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
    client.receive({ kind: 'ping', t: 77, roundTripMs: 42 });
    expect(sent.at(-1)).toEqual({ kind: 'pong', t: 77 });
    expect(client.roundTripMs).toBe(42);
  });
});

describe('RelayClient under a failing or interrupted world port', () => {
  it('reports a port that fails and answers the next start again', async () => {
    let attempts = 0;
    const failures: string[] = [];
    const sent: ClientMessage[] = [];
    const client = new RelayClient({
      token: 'token-0123456789abcdef',
      nick: 'Ania',
      world: {
        open: async () => {
          attempts++;
          if (attempts === 1) throw new Error('no terrain');
          return { sim: new Simulation({ seed: 3, content: testContent() }), generation: DESCRIPTOR_WORLD };
        },
        restore: async () => null,
      },
      onError: (what, error) =>
        failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`),
    });
    client.attach((message) => sent.push(message));
    start(client, null);
    await client.settled().catch(() => undefined);
    expect(failures).toEqual(['open: no terrain']);
    expect(sent.some((message) => message.kind === 'loaded')).toBe(false);
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    await client.settled();
    expect(attempts).toBe(2);
    expect(sent.at(-1)).toEqual({ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD });
  });

  it('answers a start repeated while the world opens with the one loaded, and applies each frame once', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const sim = new Simulation({ seed: 3, content: testContent() });
    const { client, sent } = harness({
      open: () =>
        new Promise((resolve) => {
          gate.release = () => resolve({ sim, generation: DESCRIPTOR_WORLD });
        }),
    });
    start(client, null);
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    client.receive({ kind: 'frame', tick: 1, commands: [] });
    client.receive({ kind: 'frame', tick: 1, commands: [] });
    client.receive({ kind: 'frame', tick: 2, commands: [] });
    gate.release?.();
    await client.settled();
    expect(sent.filter((message) => message.kind === 'loaded')).toHaveLength(1);
    expect(client.bufferedTicks).toBe(2);
    client.advance(1000);
    expect(client.tick).toBe(2);
    expect(client.bufferedTicks).toBe(0);
  });

  it('drops a command issued with no world or no connection, and says so', () => {
    const failures: string[] = [];
    let connected = true;
    const sent: ClientMessage[] = [];
    const client = new RelayClient({
      token: 'token-0123456789abcdef',
      nick: 'Ania',
      world: { open: async () => null, restore: async () => null },
      onError: (what) => failures.push(what),
      connected: () => connected,
    });
    client.attach((message) => sent.push(message));
    client.submit({ v: 1, origin: 'player', player: 0, command: { kind: 'noop' } } as never);
    expect(failures).toEqual(['command']);
    expect(sent).toEqual([]);
    connected = false;
    client.submit({ v: 1, origin: 'player', player: 0, command: { kind: 'noop' } } as never);
    expect(failures).toEqual(['command', 'command']);
  });
});

describe('RelayClient at a pause', () => {
  it('runs the frames it still holds before it stands still, so every client rests on one tick', async () => {
    const { client } = harness({
      open: async () => ({
        sim: new Simulation({ seed: 3, content: testContent() }),
        generation: DESCRIPTOR_WORLD,
      }),
    });
    start(client, null);
    await client.settled();
    client.receive({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null });
    for (let tick = 1; tick <= 4; tick++) client.receive({ kind: 'frame', tick, commands: [] });
    client.receive({ kind: 'clock', tick: 5, speed: 1, paused: true, by: 'Ania' });
    expect(client.paused).toBe(true);
    client.advance(1000);
    client.advance(1000);
    expect(client.tick).toBe(4);
    expect(client.bufferedTicks).toBe(0);
    client.receive({ kind: 'frame', tick: 5, commands: [] });
    client.advance(1000);
    expect(client.tick).toBe(5);
    client.receive({ kind: 'clock', tick: 6, speed: 1, paused: false, by: 'Ania' });
    client.receive({ kind: 'frame', tick: 6, commands: [] });
    client.advance(1000);
    expect(client.tick).toBe(6);
  });
});

function deferredWorld() {
  let release: (world: OpenedWorld | null) => void = () => undefined;
  const promise = new Promise<OpenedWorld | null>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixtureWorld(): OpenedWorld {
  return { sim: new Simulation({ seed: 3, content: testContent() }), generation: DESCRIPTOR_WORLD };
}

describe('RelayClient world operation ownership', () => {
  it('does not upload a snapshot compressed after its world was invalidated', async () => {
    const { client, sent } = harness({ open: async () => fixtureWorld() });
    start(client, null);
    await client.settled();
    sent.length = 0;
    client.receive({ kind: 'snapshotRequest' });
    client.receive({ kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' });
    await client.settled();
    expect(sent).toEqual([]);
  });

  it('does not adopt an opening world after a desync invalidates it', async () => {
    const opening = deferredWorld();
    const { client, sent, worlds } = harness({ open: () => opening.promise });
    start(client, null);
    client.receive({ kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' });
    opening.release(fixtureWorld());
    await client.settled();
    expect(client.sim).toBeNull();
    expect(client.isOutOfSync).toBe(true);
    expect(worlds).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('keeps the newest snapshot when older restores finish later', async () => {
    const older = deferredWorld();
    const newer = deferredWorld();
    const expected = fixtureWorld();
    const { client, worlds } = harness({
      restore: (_session, bytes) => (bytes === 'AAAA' ? older.promise : newer.promise),
    });
    start(client, 5);
    await client.settled();
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 5, bytes: 'AAAA' });
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 6, bytes: 'BBBB' });
    newer.release(expected);
    older.release(fixtureWorld());
    await client.settled();
    expect(client.sim).toBe(expected.sim);
    expect(worlds).toEqual([expected]);
  });

  it('does not restart an in-flight restore on reconnect', async () => {
    const restore = deferredWorld();
    const { client, sent } = harness({ restore: () => restore.promise });
    start(client, 5);
    await client.settled();
    client.receive({ kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' });
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 5, bytes: 'AAAA' });
    sent.length = 0;
    client.receive({ kind: 'start', session: SESSION, snapshotTick: 5 });
    expect(sent).toEqual([]);
    restore.release(fixtureWorld());
    await client.settled();
    expect(sent).toEqual([{ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD }]);
  });

  it('leaving cancels an open and clears the previous session clock', async () => {
    const opening = deferredWorld();
    const { client, sent } = harness({ open: () => opening.promise });
    start(client, null);
    client.receive({ kind: 'clock', tick: 1, speed: 2, paused: true, by: null });
    client.receive({ kind: 'left' });
    opening.release(fixtureWorld());
    await client.settled();
    expect(client.sim).toBeNull();
    expect(client.session).toBeNull();
    expect(client.clockState).toBeNull();
    expect(sent).toEqual([]);
  });
});
