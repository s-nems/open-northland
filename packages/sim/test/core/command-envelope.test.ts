import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  adminCommand,
  COMMAND_ENVELOPE_VERSION,
  type PlayerCommand,
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
const UNIT = 7 as unknown as Entity;

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
      /needs a player slot/,
    );
  });

  it('does not mistake an inherited property for a command kind', () => {
    // `kind in COMMAND_ISSUER` would accept every Object.prototype member and hand the dispatcher a
    // variant it has no case for, throwing mid-tick instead of at the import boundary.
    for (const kind of ['toString', 'constructor', 'hasOwnProperty']) {
      expect(() => parseCommandEnvelope({ v: 1, origin: 'setup', command: { kind } })).toThrow(
        `unknown kind "${kind}"`,
      );
    }
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
    for (const queued of queue.drain(1)) queue.record(1, queued);

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
  it('owns its copy of the payload', () => {
    const queue = new CommandQueue();
    const source = { kind: 'setCraftGoods', entity: UNIT, goods: [1, 2] } as const;
    const mutable = { ...source, goods: [...source.goods] as number[] };
    queue.enqueue(playerCommand(SEAT, mutable));
    mutable.goods.push(3);

    expect(queue.drain(1)[0]?.command).toEqual(source);
  });

  it('refuses a payload that is not plain serializable data', () => {
    const queue = new CommandQueue();
    const command = { kind: 'setCraftGoods', entity: UNIT, goods: new Set([1]) } as unknown as PlayerCommand;

    expect(() => queue.enqueue(playerCommand(SEAT, command))).toThrow(/non-serializable Set/);
  });

  it('keeps a forged `__proto__` payload key inert', () => {
    // An imported bug-report log is hand-editable, and a cloned-in prototype would let it smuggle the
    // `owner`/`player` fields the authority gate reads.
    const queue = new CommandQueue();
    const forged = JSON.parse(
      '{"kind":"marry","entity":1,"__proto__":{"owner":5,"player":9}}',
    ) as PlayerCommand;
    queue.enqueue(playerCommand(SEAT, forged));

    const command = queue.drain(1)[0]?.command as Record<string, unknown>;
    expect('owner' in command).toBe(false);
    expect('player' in command).toBe(false);
  });

  it('numbers commands in apply order, skipping a discarded batch', () => {
    // Replay reconstruction discards the sim's own re-emissions before feeding the logged commands, so
    // numbering at record time keeps a replayed log numbered like the run it reconstructs.
    const queue = new CommandQueue();
    queue.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    queue.discardPending();
    queue.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: true }));
    for (const queued of queue.drain(1)) queue.record(1, queued);

    expect(queue.log.map((e) => [e.applyTick, e.sequence])).toEqual([[1, 0]]);
  });
});
