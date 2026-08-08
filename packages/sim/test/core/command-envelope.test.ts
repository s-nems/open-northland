import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../src/core/command-queue.js';
import {
  adminCommand,
  COMMAND_ENVELOPE_VERSION,
  parseCommandEnvelope,
  parseCommandLog,
  playerCommand,
  setupCommand,
} from '../../src/index.js';

/**
 * The command envelope is the sim's authority boundary in wire form: what a caller may claim, what the
 * queue keeps, and what an imported replay or diagnostics log has to prove before it is trusted.
 */

const SEAT = 2;
const UNIT = 7 as never;

/** JSON round-trip, so a parsed envelope is held to what actually survives a bug report. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('parseCommandEnvelope', () => {
  it('accepts a seat and a trusted envelope after a JSON round trip', () => {
    const seat = parseCommandEnvelope(wire(playerCommand(SEAT, { kind: 'marry', entity: UNIT })));
    expect(seat).toEqual({
      v: COMMAND_ENVELOPE_VERSION,
      origin: 'player',
      player: SEAT,
      command: { kind: 'marry', entity: UNIT },
    });

    const trusted = parseCommandEnvelope(wire(adminCommand({ kind: 'setNeedsEnabled', enabled: false })));
    expect(trusted).toEqual({
      v: COMMAND_ENVELOPE_VERSION,
      origin: 'admin',
      command: { kind: 'setNeedsEnabled', enabled: false },
    });
  });

  it('names what is wrong with a malformed envelope', () => {
    expect(() => parseCommandEnvelope(null)).toThrow(/expected an object/);
    expect(() => parseCommandEnvelope({ v: 99, origin: 'setup', command: { kind: 'marry' } })).toThrow(
      /unsupported version 99/,
    );
    expect(() => parseCommandEnvelope({ v: 1, origin: 'setup', command: { kind: 'nope' } })).toThrow(
      /unknown kind "nope"/,
    );
    expect(() => parseCommandEnvelope({ v: 1, origin: 'root', command: { kind: 'marry' } })).toThrow(
      /unknown origin "root"/,
    );
    expect(() => parseCommandEnvelope({ v: 1, origin: 'player', command: { kind: 'marry' } })).toThrow(
      /needs an integer player/,
    );
  });

  it('refuses a seat envelope carrying a command only a trusted origin may issue', () => {
    const forged = { v: 1, origin: 'player', player: SEAT, command: { kind: 'setFogMode', mode: 0 } };
    expect(() => parseCommandEnvelope(forged)).toThrow(/may not issue 'setFogMode'/);
  });
});

describe('parseCommandLog', () => {
  it('accepts a recorded log and rejects one whose order was tampered with', () => {
    const queue = new CommandQueue();
    queue.enqueue(setupCommand({ kind: 'setNeedsEnabled', enabled: false }));
    queue.enqueue(playerCommand(SEAT, { kind: 'marry', entity: UNIT }));
    for (const queued of queue.drain()) queue.record(1, queued);

    const log = wire(queue.log) as unknown[];
    expect(parseCommandLog(log)).toHaveLength(2);
    expect(() => parseCommandLog([...log].reverse())).toThrow(/does not follow the previous entry/);
    expect(() => parseCommandLog({})).toThrow(/expected an array/);
    expect(() => parseCommandLog([{ ...(log[0] as object), applyTick: -1 }])).toThrow(
      /expected a non-negative integer/,
    );
  });
});

describe('CommandQueue', () => {
  it('owns its copy of the payload and numbers each enqueue', () => {
    const queue = new CommandQueue();
    const source = { kind: 'setCraftGoods', entity: UNIT, goods: [1, 2] } as const;
    const mutable = { ...source, goods: [...source.goods] as number[] };
    queue.enqueue(playerCommand(SEAT, mutable));
    mutable.goods.push(3);

    const [queued] = queue.drain();
    expect(queued?.command).toEqual(source);
    expect(queued?.sequence).toBe(0);
  });

  it('gives a discarded batch its sequence numbers back', () => {
    // Replay reconstruction discards the sim's own re-emissions before feeding the logged commands, so
    // burning numbers on them would drift the replayed log away from the recorded one.
    const queue = new CommandQueue();
    queue.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    queue.discardPending();
    queue.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: true }));

    expect(queue.drain().map((q) => q.sequence)).toEqual([0]);
  });
});
