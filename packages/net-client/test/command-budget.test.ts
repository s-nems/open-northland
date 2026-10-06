import type { GameSession } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import {
  type ClientMessage,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_ENVELOPE_BYTES,
  type ServerMessage,
  TICK_MS,
} from '@open-northland/net-protocol';
import { MAX_UNIT_ORDER_MEMBERS, parseCommandEnvelope, playerCommand, Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  seats: [{ player: 0, mode: 'human', color: 0 }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null },
  speed: 1,
};
const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

async function runningClient(now: () => number = () => 0) {
  const sent: ClientMessage[] = [];
  const observed: ServerMessage[] = [];
  const errors: unknown[] = [];
  const sim = new Simulation({ seed: SESSION.seed, content: testContent() });
  const client = new RelayClient({
    token: 'command-budget-0123456789',
    nick: 'Ania',
    now,
    world: { open: async () => ({ sim, generation: 0 }), restore: async () => null },
    onMessage: (message) => observed.push(message),
    onError: (_what, error) => errors.push(error),
  });
  client.attach((message) => sent.push(message));
  client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
  await client.settled();
  sent.length = 0;
  observed.length = 0;
  return { client, sim, sent, observed, errors };
}

it('refuses a valid oversized army gesture atomically without sending it or disturbing latency stamps', async () => {
  let now = 100;
  const { client, sim, sent, observed, errors } = await runningClient(() => now);
  const command = (value: number) =>
    playerCommand(0, { kind: 'setAssistantCounter', player: 0, counter: 'extraMen', value, infinite: false });
  const first = command(1);
  const last = command(2);
  const oversized = parseCommandEnvelope(
    playerCommand(0, {
      kind: 'unitOrdersGroup',
      members: Array.from({ length: MAX_UNIT_ORDER_MEMBERS }, () => ({
        entity: sim.world.create(),
        actions: [
          { kind: 'equipGood', group: 'weapon', slot: 1, goodType: 123456789, skipReturn: false },
          { kind: 'equipGood', group: 'armor', slot: 1, goodType: 123456789, skipReturn: false },
        ],
      })),
    }),
  );
  expect(jsonBytes(oversized)).toBeGreaterThan(MAX_CLIENT_MESSAGE_BYTES);
  client.submit(first);
  now = 200;
  client.submit(oversized);
  now = 300;
  client.submit(last);
  expect(sent).toEqual([
    { kind: 'command', envelope: first, fromTick: 0 },
    { kind: 'command', envelope: last, fromTick: 0 },
  ]);
  expect(observed).toEqual([{ kind: 'rejected', of: 'command', reason: { code: 'envelopeTooLarge' } }]);
  expect(errors).toEqual([]);
  expect(sim.commands.log).toHaveLength(0);
  now = 400;
  client.receive({ kind: 'frame', tick: 1, commands: [{ sequence: 0, envelope: first }] });
  client.advance(TICK_MS * 2);
  expect(client.latency.lastMs).toBe(300);
  now = 600;
  client.receive({ kind: 'frame', tick: 2, commands: [{ sequence: 0, envelope: last }] });
  client.advance(TICK_MS * 2);
  expect(client.latency.lastMs).toBe(300);
  expect(sim.commands.log).toHaveLength(2);
  expect(client.tick).toBe(2);
});

it.each(['x', 'ą', '兵', '🚩'])(
  'checks the exact serialized UTF-8 boundary with %s before the envelope reaches transport validation',
  async (character) => {
    const { client, sim, sent, observed } = await runningClient();
    // The budget gate is independent of the sim's name-length validation: use one string to place
    // ASCII, two/three-byte characters and surrogate pairs exactly at the transport boundary.
    const entity = sim.world.create();
    const renamed = (name: string) => playerCommand(0, { kind: 'renameSettler', entity, name });
    const available = MAX_ENVELOPE_BYTES - jsonBytes(renamed(''));
    const width = new TextEncoder().encode(character).byteLength;
    const name = character.repeat(Math.floor(available / width)) + 'x'.repeat(available % width);
    const exact = renamed(name);
    const over = renamed(`${name}x`);
    expect(jsonBytes(exact)).toBe(MAX_ENVELOPE_BYTES);
    expect(jsonBytes(over)).toBe(MAX_ENVELOPE_BYTES + 1);
    client.submit(exact);
    client.submit(over);
    expect(sent).toEqual([{ kind: 'command', envelope: exact, fromTick: 0 }]);
    expect(jsonBytes(sent[0])).toBeLessThanOrEqual(MAX_CLIENT_MESSAGE_BYTES);
    expect(observed).toEqual([{ kind: 'rejected', of: 'command', reason: { code: 'envelopeTooLarge' } }]);
  },
);
