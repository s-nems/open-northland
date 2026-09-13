import type { GameSession } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import { type ClientMessage, DESCRIPTOR_WORLD } from '@open-northland/net-protocol';
import { components, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

const session: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 1,
  seats: [
    { player: 0, mode: 'human', color: 0 },
    { player: 1, mode: 'human', color: 1 },
  ],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};

async function clientFor(sim: Simulation) {
  const sent: ClientMessage[] = [];
  const errors: string[] = [];
  const client = new RelayClient({
    token: 'abcdefghijklmnop',
    nick: 'Ania',
    onError: (what, error) => errors.push(`${what}: ${String(error)}`),
    world: {
      open: async () => ({ sim, generation: DESCRIPTOR_WORLD }),
      restore: async () => null,
    },
  });
  client.attach((message) => sent.push(message));
  client.receive({ kind: 'start', session, snapshotTick: null });
  await client.settled();
  return { client, sent, errors };
}

describe('client match completion', () => {
  it('refuses a terminal snapshot with a different full hash before exposing a confirmed result', async () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), components.MatchRules, { participants: 3, dead: 0, won: 3 });
    const { client, errors } = await clientFor(sim);
    const hash = sim.hashState() === '00000000' ? 'ffffffff' : '00000000';
    client.receive({ kind: 'ended', tick: 0, hash });
    client.receive({ kind: 'frame', tick: 1, commands: [] });
    client.advance(1000);
    client.advance(1000);
    expect(client.endedTick).toBeNull();
    expect(client.tick).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/confirmed match result/);
  });

  it('reports an already decided adopted world without running an extra tick or requiring a mutation digest', async () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), components.MatchRules, { participants: 3, dead: 0, won: 3 });
    const hash = sim.hashState();
    const { client, sent } = await clientFor(sim);
    for (let tick = 1; tick < 8; tick++) client.receive({ kind: 'frame', tick, commands: [] });
    client.advance(1000);
    client.advance(1000);
    expect(client.tick).toBe(0);
    expect(client.resultTick).toBe(0);
    expect(client.endedTick).toBeNull();
    expect(sent.filter((message) => message.kind === 'finish')).toEqual([
      { kind: 'finish', tick: 0, hash, world: DESCRIPTOR_WORLD },
    ]);
    client.receive({ kind: 'ended', tick: 0, hash });
    client.advance(0);
    expect(client.endedTick).toBe(0);
    client.receive({ kind: 'left' });
    expect(client.endedTick).toBeNull();
    expect(client.resultTick).toBeNull();
  });

  it('does not stop when only the local player has lost', async () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), components.MatchRules, { participants: 7, dead: 1, won: 0 });
    const { client, sent } = await clientFor(sim);
    client.receive({ kind: 'frame', tick: 1, commands: [] });
    client.advance(200);
    expect(sim.matchOutcome(0)).toBe('defeat');
    expect(sim.tick).toBe(1);
    expect(sent.some((message) => message.kind === 'finish')).toBe(false);
  });
});
