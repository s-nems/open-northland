import type { GameSession } from '@open-northland/lockstep';
import {
  type AdoptedWorld,
  DISPUTE_WINDOW_TICKS,
  decodeSnapshot,
  JITTER_BUFFER_TICKS,
  type OpenedWorld,
  prepareInitialSave,
  RelayClient,
  type WorldPort,
} from '@open-northland/net-client';
import {
  type ClientMessage,
  DESCRIPTOR_WORLD,
  PROTOCOL_VERSION,
  TICK_MS,
  TICKS_PER_SECOND,
} from '@open-northland/net-protocol';
import { digestInputsToJson, exportSaveGame, Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import * as snapshotCodec from '../src/snapshot-codec.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  seats: [
    { player: 0, mode: 'human', color: 0 },
    { player: 1, mode: 'human', color: 1 },
  ],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const RESTORED_TICK = 40;
const FIRST_WORLD_ID = 1;

function harness(port: Partial<WorldPort>, awaitsDisplay = false) {
  const sent: ClientMessage[] = [];
  const worlds: AdoptedWorld[] = [];
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    world: {
      open: port.open ?? (async () => null),
      restore: port.restore ?? (async () => null),
    },
    onWorld: (world) => worlds.push(world),
    awaitsDisplay,
  });
  client.attach((message) => sent.push(message));
  return { client, sent, worlds };
}

function start(client: RelayClient, snapshotTick: number | null): void {
  client.receive({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  client.receive({ kind: 'start', session: SESSION, snapshotTick });
}

describe('RelayClient and its world port', () => {
  it.each([
    { tick: 4, generation: 5 },
    { tick: 5, generation: DESCRIPTOR_WORLD },
  ])(
    'refuses a restored world with tick $tick and generation $generation for snapshot 5',
    async ({ tick, generation }) => {
      const sim = new Simulation({ seed: 3, content: testContent() });
      sim.run(tick);
      const { client, worlds } = harness({ restore: async () => ({ sim, generation }) });
      start(client, 5);
      await client.settled();
      client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 5, bytes: 'AAAA' });
      await expect(client.settled()).rejects.toThrow('snapshot');
      expect(client.sim).toBeNull();
      expect(worlds).toEqual([]);
    },
  );

  it('uploads the captured manual save rather than exporting a later live tick', async () => {
    const sim = new Simulation({ seed: 3, content: testContent() });
    const { client, sent } = harness({ open: async () => ({ sim, generation: DESCRIPTOR_WORLD }) });
    start(client, null);
    await client.settled();
    const save = exportSaveGame(sim, { savedAt: 123, session: { example: 'captured' } });
    // Gzipped the way a host compresses its slot, not through this package's encoder.
    const bytes = await gzip(serializeSaveGame(save));
    sim.step();
    await client.shareSave(null, { header: save.header, bytes });
    const upload = sent.find((message) => message.kind === 'blob' && message.type === 'save');
    expect(upload).toMatchObject({ tick: 0 });
    if (upload?.kind !== 'blob') throw new Error('missing uploaded save');
    expect(await decodeSnapshot(upload.bytes)).toEqual(save);
  });

  it('refuses to share a save that is not a gzip stream', async () => {
    const sim = new Simulation({ seed: 3, content: testContent() });
    const { client, sent } = harness({ open: async () => ({ sim, generation: DESCRIPTOR_WORLD }) });
    start(client, null);
    await client.settled();
    const save = exportSaveGame(sim, { savedAt: 123 });
    const plain = new TextEncoder().encode(serializeSaveGame(save));
    expect(() => client.shareSave(null, { header: save.header, bytes: plain })).toThrow('gzip');
    expect(sent.some((message) => message.kind === 'blob' && message.type === 'save')).toBe(false);
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
    client.receive({ kind: 'clock', tick: 1, speed: 2, paused: false, by: null, governed: null });
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

describe('RelayClient behind a display', () => {
  const loadedOf = (sent: readonly ClientMessage[]) => sent.filter((message) => message.kind === 'loaded');

  it('reports its world loaded only once the display shows that world', async () => {
    const { client, sent } = harness({ open: async () => fixtureWorld() }, true);
    start(client, null);
    await client.settled();
    expect(loadedOf(sent)).toEqual([]);
    client.worldShown(FIRST_WORLD_ID + 1);
    expect(loadedOf(sent)).toEqual([]);
    client.worldShown(FIRST_WORLD_ID);
    client.worldShown(FIRST_WORLD_ID);
    expect(loadedOf(sent)).toEqual([{ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD }]);
  });

  it('answers a start repeated before the display with nothing, and after it at once', async () => {
    const { client, sent } = harness({ open: async () => fixtureWorld() }, true);
    start(client, null);
    await client.settled();
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    expect(loadedOf(sent)).toEqual([]);
    client.worldShown(FIRST_WORLD_ID);
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    expect(loadedOf(sent)).toHaveLength(2);
  });

  it('asks for the cached snapshot at once, since it holds no world to show', async () => {
    const { client, sent } = harness({}, true);
    start(client, 12);
    await client.settled();
    expect(loadedOf(sent)).toEqual([{ kind: 'loaded', tick: null }]);
  });

  it('forgets a held report when its world is dropped before it is shown', async () => {
    const { client, sent } = harness({ open: async () => fixtureWorld() }, true);
    start(client, null);
    await client.settled();
    client.receive({ kind: 'desync', tick: 1, domains: ['rng'], reference: 'Bartek' });
    client.worldShown(FIRST_WORLD_ID);
    expect(loadedOf(sent)).toEqual([]);
  });

  it('reports boot progress in whole percent', () => {
    const { client, sent } = harness({});
    client.reportLoading(40);
    expect(sent).toEqual([{ kind: 'loading', progress: 40 }]);
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
    client.receive({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null });
    for (let tick = 1; tick <= 4; tick++) client.receive({ kind: 'frame', tick, commands: [] });
    client.receive({ kind: 'clock', tick: 5, speed: 1, paused: true, by: 'Ania', governed: null });
    expect(client.paused).toBe(true);
    client.advance(1000);
    client.advance(1000);
    expect(client.tick).toBe(4);
    expect(client.bufferedTicks).toBe(0);
    client.receive({ kind: 'frame', tick: 5, commands: [] });
    client.advance(1000);
    expect(client.tick).toBe(5);
    client.receive({ kind: 'clock', tick: 6, speed: 1, paused: false, by: 'Ania', governed: null });
    client.receive({ kind: 'frame', tick: 6, commands: [] });
    client.advance(1000);
    expect(client.tick).toBe(6);
  });
});

describe('RelayClient under a governed clock', () => {
  it('runs at the governed speed while it is set and reports the requested one', async () => {
    const REQUESTED_SPEED = 2;
    const GOVERNED_SPEED = 0.5;
    const { client } = harness({ open: async () => fixtureWorld() });
    start(client, null);
    await client.settled();
    const governed = { nick: 'Ola', speed: GOVERNED_SPEED, cause: 'load' };
    client.receive({ kind: 'clock', tick: 1, speed: REQUESTED_SPEED, paused: false, by: null, governed });
    // A buffer one frame past the jitter buffer runs at the clock's own pace.
    for (let tick = 1; tick <= JITTER_BUFFER_TICKS + 1; tick++) {
      client.receive({ kind: 'frame', tick, commands: [] });
    }
    client.advance(TICK_MS / GOVERNED_SPEED);
    expect(client.tick).toBe(1);
    expect(client.speed).toBe(REQUESTED_SPEED);
    expect(client.governed).toEqual(governed);

    client.receive({
      kind: 'clock',
      tick: 2,
      speed: REQUESTED_SPEED,
      paused: false,
      by: null,
      governed: null,
    });
    client.receive({ kind: 'frame', tick: JITTER_BUFFER_TICKS + 2, commands: [] });
    client.advance(TICK_MS / REQUESTED_SPEED);
    expect(client.tick).toBe(2);
    expect(client.governed).toBeNull();
  });
});

describe('RelayClient acknowledgements', () => {
  it('carries the smoothed tick cost and the frames still buffered', async () => {
    const FIRST_TICK_MS = 12;
    const SECOND_TICK_MS = 24;
    // Each tick's cost runs from the reading before it to the reading at its end.
    const readings = [0, FIRST_TICK_MS, FIRST_TICK_MS, FIRST_TICK_MS + SECOND_TICK_MS];
    const sent: ClientMessage[] = [];
    const client = new RelayClient({
      token: 'token-0123456789abcdef',
      nick: 'Ania',
      world: { open: async () => fixtureWorld(), restore: async () => null },
      now: () => readings.shift() ?? Number.NaN,
    });
    client.attach((message) => sent.push(message));
    start(client, null);
    await client.settled();
    client.receive({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null });
    for (let tick = 1; tick <= 3; tick++) client.receive({ kind: 'frame', tick, commands: [] });
    client.advance(TICK_MS * 2);
    const acks = sent.filter((message) => message.kind === 'ack');
    expect(acks.map((ack) => ack.load)).toEqual([
      { tickMs: FIRST_TICK_MS, buffered: 2 },
      { tickMs: FIRST_TICK_MS + (SECOND_TICK_MS - FIRST_TICK_MS) / TICKS_PER_SECOND, buffered: 1 },
    ]);
  });

  it("counts the host's per-tick work, and reports a slower display's cost instead of the sim's", async () => {
    const SIM_MS = 2;
    const HOST_MS = 3;
    const DRAWN_MS = 50;
    let nowMs = 0;
    const sent: ClientMessage[] = [];
    const client = new RelayClient({
      token: 'token-0123456789abcdef',
      nick: 'Ania',
      world: { open: async () => fixtureWorld(), restore: async () => null },
      now: () => nowMs,
    });
    client.attach((message) => sent.push(message));
    start(client, null);
    await client.settled();
    client.receive({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null });
    for (let tick = 1; tick <= 3; tick++) client.receive({ kind: 'frame', tick, commands: [] });
    const acknowledged = () => sent.filter((message) => message.kind === 'ack').map((ack) => ack.load.tickMs);

    // The host's `onTick` runs inside the tick's measured span.
    client.advance(TICK_MS, () => {
      nowMs += HOST_MS;
    });
    expect(acknowledged()).toEqual([HOST_MS]);

    client.drawnTickCost(DRAWN_MS, 1);
    client.advance(TICK_MS, () => {
      nowMs += SIM_MS;
    });
    expect(acknowledged()[1]).toBe(DRAWN_MS);
  });
});

function deferredWorld() {
  let release: (world: OpenedWorld | null) => void = () => undefined;
  const promise = new Promise<OpenedWorld | null>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixtureWorld(tick = 0): OpenedWorld {
  const sim = new Simulation({ seed: 3, content: testContent() });
  sim.run(tick);
  return { sim, generation: tick === 0 ? DESCRIPTOR_WORLD : tick };
}

describe('RelayClient world operation ownership', () => {
  it('answers the next snapshot request after compression failed', async () => {
    const { client, sent } = harness({ open: async () => fixtureWorld(5) });
    start(client, 5);
    await client.settled();
    const encode = vi.spyOn(snapshotCodec, 'encodeSnapshot').mockRejectedValueOnce(new Error('compression'));
    try {
      client.receive({ kind: 'snapshotRequest' });
      await expect(client.settled()).rejects.toThrow('compression');
      client.receive({ kind: 'snapshotRequest' });
      await client.settled();
      const snapshots = sent.filter((message) => message.kind === 'blob');
      expect(snapshots).toHaveLength(1);
      expect(await decodeSnapshot(snapshots[0]?.bytes ?? '')).toMatchObject({ header: { tick: 5 } });
    } finally {
      encode.mockRestore();
    }
  });

  it('keeps a new world capture protected when the discarded world finishes compressing', async () => {
    const { client, sent, worlds } = harness({ open: async () => fixtureWorld(5) });
    start(client, 5);
    await client.settled();
    const releases: ((bytes: string) => void)[] = [];
    const encode = vi
      .spyOn(snapshotCodec, 'encodeSnapshot')
      .mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    try {
      client.receive({ kind: 'snapshotRequest' });
      const oldWork = client.settled();
      client.receive({ kind: 'left' });
      start(client, 5);
      await vi.waitFor(() => expect(worlds).toHaveLength(2));
      client.receive({ kind: 'snapshotRequest' });
      expect(releases).toHaveLength(2);
      releases[0]?.('AAAA');
      await oldWork;
      client.receive({ kind: 'snapshotRequest' });
      expect(releases).toHaveLength(2);
      releases[1]?.('BBBB');
      await client.settled();
      expect(sent.filter((message) => message.kind === 'blob')).toEqual([
        { kind: 'blob', type: 'snapshot', to: null, tick: 5, world: 5, bytes: 'BBBB' },
      ]);
    } finally {
      for (const release of releases) release('AAAA');
      await client.settled();
      encode.mockRestore();
    }
  });

  it('answers overlapping snapshot requests with one capture, then permits a fresh capture', async () => {
    const { client, sent } = harness({ open: async () => fixtureWorld(5) });
    start(client, 5);
    await client.settled();
    sent.length = 0;
    for (let request = 0; request < 3; request++) client.receive({ kind: 'snapshotRequest' });
    await client.settled();
    const snapshots = () => sent.filter((message) => message.kind === 'blob');
    expect(snapshots()).toHaveLength(1);
    expect(await decodeSnapshot(snapshots()[0]?.bytes ?? '')).toMatchObject({ header: { tick: 5 } });
    client.receive({ kind: 'frame', tick: 6, commands: [] });
    client.advance(1000);
    client.receive({ kind: 'snapshotRequest' });
    await client.settled();
    expect(snapshots()).toHaveLength(2);
    expect(await decodeSnapshot(snapshots()[1]?.bytes ?? '')).toMatchObject({ header: { tick: 6 } });
  });

  it.each([DESCRIPTOR_WORLD, RESTORED_TICK])(
    'uploads the snapshot tick and world generation captured before compression (world %i)',
    async (world) => {
      const opened = fixtureWorld(world);
      opened.sim.run(2);
      const tick = opened.sim.tick;
      const { client, sent } = harness({ open: async () => opened });
      start(client, world === DESCRIPTOR_WORLD ? null : world);
      await client.settled();
      sent.length = 0;
      client.receive({ kind: 'snapshotRequest' });
      opened.sim.step();
      await client.settled();
      const upload = sent.find((message) => message.kind === 'blob');
      expect(upload).toMatchObject({ type: 'snapshot', tick, world });
      if (upload?.kind !== 'blob') throw new Error('missing uploaded snapshot');
      expect((await decodeSnapshot(upload.bytes)).header.tick).toBe(tick);
    },
  );

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
    const expected = fixtureWorld(6);
    const { client, worlds } = harness({
      restore: (_session, bytes) => (bytes === 'AAAA' ? older.promise : newer.promise),
    });
    start(client, 5);
    await client.settled();
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 5, bytes: 'AAAA' });
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 6, bytes: 'BBBB' });
    newer.release(expected);
    older.release(fixtureWorld(5));
    await client.settled();
    expect(client.sim).toBe(expected.sim);
    expect(worlds).toEqual([{ ...expected, worldId: FIRST_WORLD_ID }]);
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
    restore.release(fixtureWorld(5));
    await client.settled();
    expect(sent).toEqual([{ kind: 'loaded', tick: 5, world: 5 }]);
  });

  it('numbers every adopted world and holds no number between worlds', async () => {
    const { client, worlds } = harness({
      open: async () => fixtureWorld(),
      restore: async () => fixtureWorld(5),
    });
    expect(client.worldId).toBeNull();
    start(client, null);
    await client.settled();
    expect(client.worldId).toBe(FIRST_WORLD_ID);
    client.receive({ kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' });
    expect(client.worldId).toBeNull();
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: 5, bytes: 'AAAA' });
    await client.settled();
    expect(client.worldId).toBe(FIRST_WORLD_ID + 1);
    expect(worlds.map((world) => world.worldId)).toEqual([FIRST_WORLD_ID, FIRST_WORLD_ID + 1]);
    client.receive({ kind: 'left' });
    expect(client.worldId).toBeNull();
  });

  it('leaving cancels an open and clears the previous session clock', async () => {
    const opening = deferredWorld();
    const { client, sent } = harness({ open: () => opening.promise });
    start(client, null);
    client.receive({ kind: 'clock', tick: 1, speed: 2, paused: true, by: null, governed: null });
    client.receive({ kind: 'left' });
    opening.release(fixtureWorld());
    await client.settled();
    expect(client.sim).toBeNull();
    expect(client.session).toBeNull();
    expect(client.clockState).toBeNull();
    expect(sent).toEqual([]);
  });
});

/** Deliver frames up to `tick` and run them all. */
function runTo(client: RelayClient, tick: number): void {
  const from = (client.tick ?? 0) + 1;
  for (let next = from; next <= tick; next++) client.receive({ kind: 'frame', tick: next, commands: [] });
  while ((client.tick ?? tick) < tick) client.advance(TICK_MS * (tick - (client.tick ?? 0)));
}

describe('RelayClient desync verdicts', () => {
  const DISPUTED_TICK = 3;

  async function running() {
    const world = fixtureWorld();
    const { client } = harness({ open: async () => world });
    start(client, null);
    await client.settled();
    client.receive({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null });
    return { client, sim: world.sim };
  }

  it('freezes a reference record with the fold inputs of the disputed tick', async () => {
    const { client, sim } = await running();
    runTo(client, DISPUTED_TICK);
    const inputs = sim.syncDigestInputs();
    if (inputs === null) throw new Error('the client should capture digest inputs');
    runTo(client, DISPUTED_TICK + 2);
    client.receive({
      kind: 'disputed',
      tick: DISPUTED_TICK,
      domains: ['rng'],
      diverged: ['Bartek', 'Cezary'],
    });
    expect(client.dispute).toEqual({
      role: 'reference',
      tick: DISPUTED_TICK,
      domains: ['rng'],
      counterparts: ['Bartek', 'Cezary'],
      inputs: digestInputsToJson(inputs),
    });
    expect(client.sim).toBe(sim);
  });

  it('freezes a diverged record before it drops the world, and keeps it', async () => {
    const { client } = await running();
    runTo(client, DISPUTED_TICK);
    client.receive({ kind: 'desync', tick: DISPUTED_TICK, domains: ['movement'], reference: 'Bartek' });
    expect(client.sim).toBeNull();
    expect(client.dispute).toMatchObject({
      role: 'diverged',
      tick: DISPUTED_TICK,
      domains: ['movement'],
      counterparts: ['Bartek'],
      inputs: { tick: DISPUTED_TICK },
    });
  });

  it('keeps no inputs for a tick that already left the window', async () => {
    const { client } = await running();
    runTo(client, DISPUTED_TICK + DISPUTE_WINDOW_TICKS);
    client.receive({ kind: 'disputed', tick: DISPUTED_TICK, domains: ['rng'], diverged: ['Bartek'] });
    expect(client.dispute).toMatchObject({ role: 'reference', tick: DISPUTED_TICK, inputs: null });
  });
});

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
