import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeMissionGoal,
  decodeMissionResult,
  MapScript,
  type MissionDecodeWarning,
} from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentDir } from './helpers.js';

/**
 * The mission opcode registry against the real corpus: every `[MissionData]` line of every generated
 * script sidecar goes through the decoder, so a wrong name or a wrong parameter arity shows up as
 * unknown opcodes or as a wave of token-count warnings instead of as silent no-ops in the sim.
 */

/** Enough maps to show the join is general, few enough to keep the grid reads bounded. */
const MAPS_TO_MATCH = 3;

/** Reading a handful of multi-megabyte grids costs seconds on a contended machine. */
const MAP_SCAN_TIMEOUT_MS = 60_000;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function sidecars(suffix: string): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith(suffix))
    .sort();
}

function scriptOf(file: string): MapScript {
  return MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), file), 'utf8')));
}

/**
 * The opcode names the corpus itself gets wrong; the original resolves each to `True` or `None`, and
 * so does the decoder. Case variants (`timegone`, `EndSubmission`) are not here: they match.
 */
const CORPUS_MISSPELLINGS = new Set([
  'BuildHouse',
  'NumberOfHumansNearPos',
  'MissionMissionFailed',
  'SetLandspace',
  'DisableMission',
  'Disable All',
  'AddGoodsToHouse',
  `'ExploreArea"`,
]);

interface Decoded {
  readonly lines: number;
  readonly unknown: Map<string, number>;
  readonly tokenCounts: number;
}

let decoded: Decoded | undefined;

/** One pass over every sidecar, shared by the assertions below. */
function decodeCorpus(): Decoded {
  decoded ??= decodeEveryLine();
  return decoded;
}

function decodeEveryLine(): Decoded {
  const unknown = new Map<string, number>();
  let lines = 0;
  let tokenCounts = 0;
  const warn = (w: MissionDecodeWarning): void => {
    if (w.reason === 'unknownOpcode') unknown.set(w.opcode, (unknown.get(w.opcode) ?? 0) + 1);
    else tokenCounts++;
  };
  for (const file of sidecars('.script.json')) {
    for (const mission of scriptOf(file).missions) {
      for (const line of mission.goals) {
        decodeMissionGoal(line, warn);
        lines++;
      }
      for (const line of mission.results) {
        decodeMissionResult(line, warn);
        lines++;
      }
    }
  }
  return { lines, unknown, tokenCounts };
}

describe.runIf(existsSync(resolve(contentDir(), 'maps')))('mission opcodes over the real corpus', () => {
  it('decodes every goal and result line, and only the corpus misspellings stay unknown', () => {
    const { lines, unknown } = decodeCorpus();
    // ~33k lines across ~124 sidecars; a run that suddenly decodes a handful means the stage broke.
    expect(lines).toBeGreaterThan(10_000);
    expect([...unknown.keys()].filter((name) => !CORPUS_MISSPELLINGS.has(name.trim()))).toEqual([]);
    const unknownLines = [...unknown.values()].reduce((sum, n) => sum + n, 0);
    expect(unknownLines / lines).toBeLessThan(0.005);
  });

  it('reads the declared token count on all but a fraction of the corpus lines', () => {
    // A mistyped arity in the tables would put thousands of lines on the wrong parameters; the real
    // corpus only strays on the shapes MISSIONS.md records (a `SetHuman` with a token to spare,
    // an `AddGoodsToMapArea` without its trailing player).
    const { lines, tokenCounts } = decodeCorpus();
    expect(tokenCounts / lines).toBeLessThan(0.02);
  });

  it(
    'addresses authored placements: a result names an object id a sethouse carries',
    () => {
      // The grids are megabytes of lane data, so this reads the one lane it needs - the file schema
      // is the map-invariants suite's job - and stops once enough maps have shown the join.
      let mapsMatched = 0;
      for (const file of sidecars('.script.json')) {
        const grid = resolve(mapsDir(), file.replace('.script.json', '.json'));
        if (!existsSync(grid)) continue;
        const raw = JSON.parse(readFileSync(grid, 'utf8')) as {
          entities?: { buildings?: readonly { missionId?: number }[] };
        };
        const authored = new Set(
          (raw.entities?.buildings ?? []).flatMap((b) => (b.missionId === undefined ? [] : [b.missionId])),
        );
        if (authored.size === 0) continue;
        const names = scriptOf(file).missions.some((mission) =>
          mission.results.some((line) => {
            const result = decodeMissionResult(line);
            return (
              (result.opcode === 'SetHouseBehaviourFlag' || result.opcode === 'AddGoodsToHouses') &&
              authored.has(result.objectId)
            );
          }),
        );
        if (names && ++mapsMatched === MAPS_TO_MATCH) break;
      }
      // The `sethouse` id column and the results' object ids are one namespace; no overlap anywhere
      // means the column was dropped again or read from the wrong position.
      expect(mapsMatched).toBe(MAPS_TO_MATCH);
    },
    MAP_SCAN_TIMEOUT_MS,
  );
});
