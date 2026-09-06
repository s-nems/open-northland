import type { MapScriptLine } from '../schema/maps/script.js';
import {
  type Decoded,
  MISSION_GOALS,
  MISSION_RESULTS,
  type OpcodeRow,
  UNKNOWN_OPCODE_INDEX,
} from './opcodes.js';
import { MISSION_PARAMS } from './params.js';

/** What a line lost on the way in. The caller adds the map, mission index, and line it came from. */
export type MissionDecodeWarning =
  | { readonly reason: 'unknownOpcode'; readonly opcode: string }
  | {
      readonly reason: 'missingTokens' | 'surplusTokens';
      readonly opcode: string;
      readonly expected: number;
      readonly got: number;
    };

export type MissionWarn = (warning: MissionDecodeWarning) => void;

/** An opcode table, non-empty so its index 0 is the fallback every unmatched name resolves to. */
type OpcodeTable = readonly [OpcodeRow, ...OpcodeRow[]];

/**
 * Reads each parameter off the line in signature order. The engine reads exactly as many tokens as
 * the signature declares, so a surplus token is dropped and a missing one reads as zero; both are
 * common enough in the corpus to warn rather than reject.
 */
function decodeArgs(row: OpcodeRow, values: readonly string[], warn?: MissionWarn): Record<string, unknown> {
  const [opcode, ...params] = row;
  const args: Record<string, unknown> = {};
  let at = 1;
  for (const kind of params) {
    const param = MISSION_PARAMS[kind];
    args[param.field] = param.decode(values.slice(at, at + param.tokens));
    at += param.tokens;
  }
  const expected = at - 1;
  const got = values.length - 1;
  if (got !== expected) {
    warn?.({ reason: got < expected ? 'missingTokens' : 'surplusTokens', opcode, expected, got });
  }
  return args;
}

/**
 * One table's line decoder, its name lookup built once. Names match case-insensitively and trimmed:
 * the corpus authors both spellings and one map leaves a control character inside the quoted name.
 * An unmatched name resolves to the table's index 0 as in the original, and only that is reported:
 * the fallback declares no parameters, so the line's own tokens are not counted against it.
 */
function decoder<R extends OpcodeTable>(rows: R): (line: MapScriptLine, warn?: MissionWarn) => Decoded<R> {
  const byName = new Map(rows.map((row) => [row[0].toLowerCase(), row]));
  const unknown = rows[UNKNOWN_OPCODE_INDEX];
  return (line, warn) => {
    const name = line.values[0] ?? '';
    const row = byName.get(name.trim().toLowerCase());
    if (row === undefined) warn?.({ reason: 'unknownOpcode', opcode: name });
    const matched = row ?? unknown;
    const args = row === undefined ? {} : decodeArgs(matched, line.values, warn);
    // The table drives the shape, so the built object is asserted into the union it describes.
    return { opcode: matched[0], ...args } as unknown as Decoded<R>;
  };
}

/** Decodes one `goal "<Name>" args...` line into its goal, or `True` when the name matches none. */
export const decodeMissionGoal = decoder(MISSION_GOALS);

/** Decodes one `result "<Name>" args...` line into its result, or `None` when the name matches none. */
export const decodeMissionResult = decoder(MISSION_RESULTS);
