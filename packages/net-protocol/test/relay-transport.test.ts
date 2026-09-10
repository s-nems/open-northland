import {
  COMMAND_ENVELOPE_VERSION,
  type CommandEnvelope,
  parseCommandEnvelope,
  setupCommand,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type ClientMessage, RelayTransport } from '../src/index.js';

/** The transport is where the wire meets the driver: what goes up carries the issuing tick, what comes
 *  down is held until asked for, and only what the sim's parser accepts reaches it. */

function order(player: number, value: number): Extract<CommandEnvelope, { origin: 'player' }> {
  return {
    v: COMMAND_ENVELOPE_VERSION,
    origin: 'player',
    player,
    command: { kind: 'setAssistantCounter', player, counter: 'extraMen', value, infinite: false },
  };
}

function harness() {
  const sent: ClientMessage[] = [];
  const dropped: string[] = [];
  const transport = new RelayTransport({
    send: (message) => sent.push(message),
    parseEnvelope: parseCommandEnvelope,
    onDropped: (tick, reason) => dropped.push(`${tick}: ${reason}`),
  });
  return { transport, sent, dropped };
}

describe('relay transport', () => {
  it('sends a seat command with the tick it was issued on', () => {
    const { transport, sent } = harness();
    transport.submit(order(0, 4), 12);
    expect(sent).toEqual([{ kind: 'command', envelope: order(0, 4), fromTick: 12 }]);
  });

  it('refuses a trusted envelope instead of sending it', () => {
    const { transport, sent } = harness();
    expect(() => transport.submit(setupCommand({ kind: 'setNeedsEnabled', enabled: false }), 0)).toThrow(
      /seat commands only/,
    );
    expect(sent).toEqual([]);
  });

  it('holds a tick until its frame has arrived, then hands it over once', () => {
    const { transport } = harness();
    expect(transport.take(1)).toBeNull();
    transport.receiveFrame({ tick: 1, commands: [{ envelope: order(0, 4), sequence: 0 }] });
    expect(transport.bufferedTicks).toBe(1);
    expect(transport.take(1)).toEqual({ tick: 1, commands: [{ envelope: order(0, 4), sequence: 0 }] });
    expect(transport.take(1)).toBeNull();
  });

  it('keeps the first copy of a tick and ignores one for a tick already run', () => {
    const { transport } = harness();
    transport.receiveFrame({ tick: 1, commands: [{ envelope: order(0, 1), sequence: 0 }] });
    transport.receiveFrame({ tick: 1, commands: [] });
    expect(transport.take(1)?.commands).toHaveLength(1);
    transport.receiveFrame({ tick: 1, commands: [] });
    expect(transport.bufferedTicks).toBe(0);
  });

  it('drops an envelope the sim refuses and keeps the rest of the frame', () => {
    const { transport, dropped } = harness();
    transport.receiveFrame({
      tick: 3,
      commands: [
        {
          envelope: { v: 1, origin: 'player', player: 0, command: { kind: 'setAssistantCounter' } },
          sequence: 0,
        },
        { envelope: order(1, 9), sequence: 1 },
      ],
    });
    expect(transport.take(3)).toEqual({ tick: 3, commands: [{ envelope: order(1, 9), sequence: 1 }] });
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatch(/^3: /);
  });
});
