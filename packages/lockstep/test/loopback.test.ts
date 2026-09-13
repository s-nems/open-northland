import { adminCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { LOOPBACK_DELAY_TICKS, LoopbackTransport } from '../src/index.js';

const envelope = (enabled: boolean) => adminCommand({ kind: 'setNeedsEnabled', enabled });

describe('loopback transport', () => {
  it('stamps a submission for the tick after the one it was issued on', () => {
    const transport = new LoopbackTransport();
    transport.submit(envelope(false), 4);
    expect(transport.take(4).commands).toEqual([]);
    expect(transport.take(4 + LOOPBACK_DELAY_TICKS).commands).toHaveLength(1);
  });

  it('owns a submitted payload before the caller can change it', () => {
    const transport = new LoopbackTransport();
    const command = { kind: 'setMatchParticipants' as const, players: [0, 1] };
    transport.submit(adminCommand(command), 0);
    command.players[0] = 7;
    expect(transport.take(1).commands[0]?.envelope.command).toEqual({
      kind: 'setMatchParticipants',
      players: [0, 1],
    });
  });

  it('numbers a tick from zero and hands each frame over once', () => {
    const transport = new LoopbackTransport();
    transport.submit(envelope(false), 0);
    transport.submit(envelope(true), 0);
    expect(transport.take(1).commands.map((c) => c.sequence)).toEqual([0, 1]);
    expect(transport.take(1).commands).toEqual([]);
  });
});
