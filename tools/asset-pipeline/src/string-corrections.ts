import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { errorMessage } from './errors.js';

/** The committed fixes to decoded display strings; this package's AGENTS.md sets the rules. */
export const STRING_CORRECTIONS_FILE = fileURLToPath(
  new URL('../corrections/strings/tables.json', import.meta.url),
);

/** One display string replaced while the decoded original still reads `from`. */
export interface StringCorrection {
  /** The text folder, e.g. `rus`. */
  readonly lang: string;
  /** The table key in `gui/strings/<lang>.json`. */
  readonly table: string;
  /** The string id within that table. */
  readonly id: number;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

/** One pipeline run's string corrections, and which of them the decoded tables took. */
export interface StringCorrections {
  readonly list: readonly StringCorrection[];
  /** `byId` with every correction naming `lang`/`table` applied where the text still matches. */
  correct(lang: string, table: string, byId: Readonly<Record<number, string>>): Record<number, string>;
  /** Throws naming every correction the run did not apply, and why. */
  assertApplied(): void;
}

const ENTRY_KEYS = ['lang', 'table', 'id', 'from', 'to', 'reason'] as const;

/** Loads the corrections at `path`; a missing file holds none, a malformed one throws. */
export async function loadStringCorrections(path: string): Promise<StringCorrections> {
  let text: string | undefined;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    text = undefined;
  }
  const list = text === undefined ? [] : parseStringCorrections(path, parseJson(path, text));

  const applied = new Set<StringCorrection>();
  const failures = new Map<StringCorrection, string>();
  return {
    list,
    correct(lang, table, byId) {
      const corrected: Record<number, string> = { ...byId };
      for (const entry of list) {
        if (entry.lang !== lang || entry.table !== table) continue;
        const actual = byId[entry.id];
        if (actual === entry.from) {
          corrected[entry.id] = entry.to;
          applied.add(entry);
        } else {
          failures.set(
            entry,
            actual === undefined
              ? 'the table has no such id'
              : `the text is now ${JSON.stringify(actual)}; check whether the mod now fixes it`,
          );
        }
      }
      return corrected;
    },
    assertApplied() {
      const problems = list
        .filter((entry) => !applied.has(entry))
        .map(
          (entry) =>
            `${entry.lang}/${entry.table}/${entry.id} ${JSON.stringify(entry.from)}: ${failures.get(entry) ?? 'never read: the mod lacks the table, or no stage decodes it'}`,
        );
      if (problems.length > 0) {
        throw new Error(
          `string corrections not applied; update or delete them in ${path}:\n  ${problems.join('\n  ')}`,
        );
      }
    },
  };
}

function parseJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`string corrections ${path}: ${errorMessage(err)}`);
  }
}

function parseStringCorrections(path: string, raw: unknown): StringCorrection[] {
  const fail = (why: string): never => {
    throw new Error(`string corrections ${path}: ${why}`);
  };
  if (!Array.isArray(raw)) return fail('not a JSON array');
  const seen = new Set<string>();
  return raw.map((item: unknown, index): StringCorrection => {
    const at = (why: string): never => fail(`entry ${index}: ${why}`);
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return at('not a JSON object');
    const record = item as Record<string, unknown>;
    const unknownKey = Object.keys(record).find((key) => !(ENTRY_KEYS as readonly string[]).includes(key));
    if (unknownKey !== undefined) at(`unknown key "${unknownKey}"`);
    const { lang, table, id, from, to, reason } = record;
    if (typeof lang !== 'string' || lang === '') return at('lang must name a text folder');
    if (typeof table !== 'string' || table === '') return at('table must name a string table');
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return at('id must be a string id');
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) {
      return at('"from" and "to" must be two different strings');
    }
    if (typeof reason !== 'string' || reason.trim() === '') return at('reason must say why the fix exists');
    const key = `${lang}/${table}/${id}`;
    if (seen.has(key)) at(`a second entry for ${key}`);
    seen.add(key);
    return { lang, table, id, from, to, reason };
  });
}
