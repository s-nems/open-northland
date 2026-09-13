import { describe, expect, it } from 'vitest';
import { type Command, parseCommandEnvelope } from '../../src/index.js';

/**
 * The per-kind field contract the parser holds an untrusted payload to. Without it a hand-edited log
 * or another player's envelope reaches a handler with a string where a coordinate belongs, and the
 * handler writes state no later read can find.
 */

const SEAT = 2;
const UNIT = 7;

/** One trusted envelope around `command`, the shape an imported log carries. */
function imported(command: Record<string, unknown>): unknown {
  return { v: 1, origin: 'setup', command };
}

function parse(command: Record<string, unknown>): unknown {
  return parseCommandEnvelope(imported(command));
}

describe('command payload contracts', () => {
  it('preserves finite-deposit work cycles through the serialized command boundary', () => {
    const command: Extract<Command, { kind: 'placeResource' }> = {
      kind: 'placeResource',
      good: 1,
      x: 4,
      y: 6,
      remaining: 20,
      harvestAtomic: 1,
      deposit: { levels: 3, strikesPerUnit: 4 },
    };
    expect(parseCommandEnvelope(JSON.parse(JSON.stringify(imported({ ...command }))))).toEqual(
      imported({ ...command }),
    );
    expect(() => parse({ ...command, deposit: { levels: 3 } })).toThrow(
      /deposit: missing field 'strikesPerUnit'/,
    );
    for (const strikesPerUnit of ['4', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parse({ ...command, deposit: { levels: 3, strikesPerUnit } })).toThrow(
        /deposit.strikesPerUnit/,
      );
    }
    expect(() => parse({ ...command, deposit: { levels: 3, strikesPerUnit: 4, unknown: true } })).toThrow(
      /deposit: unknown field/,
    );
  });

  it.each([
    { kind: 'cancelTraining', entity: UNIT },
    { kind: 'exploreArea', entity: UNIT, x: 3, y: 4 },
    { kind: 'orderNeed', entity: UNIT, need: 'piety' },
    { kind: 'setRegeneration', entity: UNIT, enabled: false },
    { kind: 'unassignBuilder', entity: UNIT },
  ])('round-trips a player $kind order and rejects its malformed entity', (command) => {
    const envelope = { v: 1, origin: 'player', player: SEAT, command };
    expect(parseCommandEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    expect(() => parseCommandEnvelope({ ...envelope, command: { ...command, entity: 1.5 } })).toThrow(
      /command.entity/,
    );
  });

  it('rejects invalid need orders and regeneration toggles', () => {
    expect(() => parse({ kind: 'orderNeed', entity: UNIT, need: 'unknown' })).toThrow(/command.need/);
    expect(() => parse({ kind: 'setRegeneration', entity: UNIT, enabled: 1 })).toThrow(/command.enabled/);
    expect(() => parse({ kind: 'exploreArea', entity: UNIT, x: 1e30, y: 0 })).toThrow(/command.x/);
  });

  it('accepts a payload carrying every optional field of its kind', () => {
    const spawn = {
      kind: 'spawnSettler',
      jobType: 3,
      x: 4,
      y: 6,
      tribe: 1,
      hitpoints: 40,
      armorClass: 2,
      weaponTypeId: 11,
      equipment: { boots: { goodType: 30 }, tool: null, misc: [{ goodType: 31, degreeOfUsePct: 50 }] },
      moveSpeed: 8,
      owner: 0,
      experience: [[2, 120]],
      gatherGood: 5,
      home: { x: 8, y: 8 },
      workplace: { x: 10, y: 10 },
    };
    expect(parse(spawn)).toEqual({ v: 1, origin: 'setup', command: spawn });
  });

  it('refuses a string where a coordinate belongs', () => {
    expect(() => parse({ kind: 'moveUnit', entity: UNIT, x: '3', y: 0 })).toThrow(
      'envelope.command.x: expected an integer, got "3"',
    );
  });

  it('refuses a fractional entity reference', () => {
    expect(() => parse({ kind: 'marry', entity: 1.5 })).toThrow(
      'envelope.command.entity: expected an integer, got 1.5',
    );
  });

  it('refuses a non-finite number', () => {
    expect(() => parse({ kind: 'dropGood', good: 1, x: 0, y: 0, amount: Number.NaN })).toThrow(
      /command\.amount: expected an integer/,
    );
    expect(() => parse({ kind: 'dropGood', good: 1, x: 0, y: 0, amount: Number.POSITIVE_INFINITY })).toThrow(
      /command\.amount: expected an integer/,
    );
  });

  it('refuses integers that cannot be represented exactly', () => {
    expect(() => parse({ kind: 'moveUnit', entity: UNIT, x: 1e30, y: 0 })).toThrow(
      /command\.x: expected an integer/,
    );
  });

  it('refuses an array whose elements are not all of the declared type', () => {
    expect(() => parse({ kind: 'setCraftGoods', entity: UNIT, goods: [1, '2'] })).toThrow(
      'envelope.command.goods[1]: expected an integer, got "2"',
    );
    expect(() => parse({ kind: 'setCraftGoods', entity: UNIT, goods: 1 })).toThrow(
      /command\.goods: expected an array/,
    );
  });

  it('refuses a value outside a fixed set', () => {
    expect(() => parse({ kind: 'makeChild', entity: UNIT, child: 'other' })).toThrow(
      'envelope.command.child: expected one of female, male, got "other"',
    );
    expect(() => parse({ kind: 'setDiplomacy', from: 0, to: 1, state: 'ally' })).toThrow(
      /command\.state: expected one of friend, neutral, enemy/,
    );
  });

  it('names the path into a nested payload record', () => {
    expect(() => parse({ kind: 'spawnSettler', jobType: 0, x: 0, y: 0, tribe: 1, home: { x: 4 } })).toThrow(
      "envelope.command.home: missing field 'y'",
    );
    expect(() =>
      parse({ kind: 'spawnSettler', jobType: 0, x: 0, y: 0, tribe: 1, experience: [[1]] }),
    ).toThrow(/command\.experience\[0\]: expected 2 entries/);
  });

  it('refuses a missing required field and accepts an absent optional one', () => {
    expect(() => parse({ kind: 'moveUnit', entity: UNIT, x: 0 })).toThrow(
      "envelope.command: missing field 'y'",
    );
    expect(parse({ kind: 'spawnAnimalHerd', tribe: 4, x: 1, y: 2 })).toBeDefined();
  });

  it('refuses a field the kind does not declare', () => {
    // The authority gate reads `owner` and `player` with `in`, so a payload may not smuggle in a name
    // of its own.
    expect(() => parse({ kind: 'marry', entity: UNIT, owner: SEAT })).toThrow(
      "envelope.command: unknown field 'owner'",
    );
    expect(() => parse({ kind: 'marry', entity: UNIT, player: SEAT })).toThrow(
      "envelope.command: unknown field 'player'",
    );
  });

  it('accepts an explicit null only where the kind allows one', () => {
    expect(parse({ kind: 'setGatherGood', entity: UNIT, goodType: null })).toBeDefined();
    expect(() => parse({ kind: 'setGatherGood', entity: UNIT, goodType: 'wood' })).toThrow(
      /command\.goodType: expected an integer/,
    );
    expect(() => parse({ kind: 'setJob', entity: UNIT, jobType: null })).toThrow(
      /command\.jobType: expected an integer/,
    );
  });
});
