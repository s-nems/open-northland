import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The named fixes to single mod files, one JSON file each; this package's AGENTS.md sets the rules. */
export const CORRECTIONS_DIR = fileURLToPath(new URL('../corrections/', import.meta.url));

/** One whole line of the file swapped for another; with `every`, each line spelled like `from`. */
interface LineEdit {
  readonly from: string;
  readonly to: string;
  readonly every: boolean;
}

/** A fix to the mod file `file`, applied only while its bytes still hash to `sha256`. */
export interface SourceCorrection {
  /** The correction's file name without `.json`. */
  readonly id: string;
  readonly reason: string;
  /** Mod-root-relative and `/`-separated, matched case-insensitively like every mod path. */
  readonly file: string;
  readonly sha256: string;
  readonly lines: readonly LineEdit[];
}

/** One pipeline run's corrections, and which of them its reads applied. */
export interface SourceCorrections {
  readonly list: readonly SourceCorrection[];
  /** The bytes at `path`, with the correction naming that mod file applied. */
  read(path: string): Promise<Uint8Array>;
  /** Throws naming every correction the run did not apply, and why. */
  assertApplied(): void;
}

const CORRECTION_KEYS = ['reason', 'file', 'sha256', 'lines'] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Script lines are printable ASCII, which the latin1 round trip keeps byte for byte. */
const SCRIPT_LINE = /^[\x20-\x7e]*$/;

/**
 * Loads every `<id>.json` under `dir` against the mod at `modRoot`. A missing directory holds no
 * corrections; a malformed file, or two corrections naming one mod file, throws.
 */
export async function loadSourceCorrections(dir: string, modRoot: string): Promise<SourceCorrections> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    names = [];
  }
  const list: SourceCorrection[] = [];
  for (const name of names) {
    const id = basename(name, '.json');
    list.push(parseCorrection(id, JSON.parse(await readFile(join(dir, name), 'utf8'))));
  }
  const byFile = new Map<string, SourceCorrection>();
  for (const correction of list) {
    const key = correction.file.toLowerCase();
    const twin = byFile.get(key);
    if (twin !== undefined) {
      throw new Error(`corrections ${twin.id} and ${correction.id} both name ${correction.file}; merge them`);
    }
    byFile.set(key, correction);
  }

  const applied = new Set<string>();
  const failures = new Map<string, string>();
  return {
    list,
    async read(path) {
      const bytes = await readFile(path);
      const correction = byFile.get(relative(modRoot, path).split(sep).join('/').toLowerCase());
      if (correction === undefined) return bytes;
      const corrected = applyCorrection(correction, bytes);
      if (typeof corrected === 'string') {
        failures.set(correction.id, corrected);
        return bytes;
      }
      applied.add(correction.id);
      return corrected;
    },
    assertApplied() {
      const problems = list
        .filter((correction) => !applied.has(correction.id))
        .map(
          (correction) =>
            `${correction.id} (${correction.file}): ${failures.get(correction.id) ?? 'never read: the mod lacks the file, or its stage reads it without readSourceFile'}`,
        );
      if (problems.length > 0) {
        throw new Error(
          `corrections not applied; update or delete them in ${dir}:\n  ${problems.join('\n  ')}`,
        );
      }
    },
  };
}

/** The corrected bytes, or why the correction no longer fits the file. */
function applyCorrection(correction: SourceCorrection, bytes: Uint8Array): Uint8Array | string {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== correction.sha256) {
    return `the file changed (sha256 ${actual}); check whether the mod now fixes it`;
  }
  // latin1 maps each byte to one code unit, so every untouched line keeps its exact bytes.
  const lines = Buffer.from(bytes).toString('latin1').split('\n');
  const edits = new Map<number, LineEdit>();
  for (const edit of correction.lines) {
    const at = lines.flatMap((line, i) => (line.replace(/\r$/, '') === edit.from ? [i] : []));
    if (at.length === 0 || (at.length > 1 && !edit.every)) {
      return `"${edit.from}" matches ${at.length} lines instead of one`;
    }
    for (const index of at) {
      if (edits.has(index)) return `two edits replace the line "${edit.from}"`;
      edits.set(index, edit);
    }
  }
  for (const [index, edit] of edits) {
    lines[index] = `${edit.to}${lines[index]?.endsWith('\r') ? '\r' : ''}`;
  }
  return Buffer.from(lines.join('\n'), 'latin1');
}

function parseCorrection(id: string, raw: unknown): SourceCorrection {
  const fail = (why: string): never => {
    throw new Error(`correction ${id}: ${why}`);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('not a JSON object');
  const record = raw as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !(CORRECTION_KEYS as readonly string[]).includes(key));
  if (unknownKey !== undefined) fail(`unknown key "${unknownKey}"`);
  const { reason, file, sha256, lines } = record;
  if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must say why the fix exists');
  if (typeof file !== 'string' || file === '') return fail('file must name a mod file');
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    return fail('sha256 must be the lower-case hex digest of the shipped file');
  }
  if (!Array.isArray(lines) || lines.length === 0) return fail('lines must list at least one edit');
  const edits = lines.map((line: unknown): LineEdit => {
    if (typeof line !== 'object' || line === null) return fail('each line edit is an object');
    const { from, to, every } = line as Record<string, unknown>;
    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      !SCRIPT_LINE.test(from) ||
      !SCRIPT_LINE.test(to)
    ) {
      return fail('each line edit has printable-ASCII "from" and "to" lines');
    }
    if (every !== undefined && every !== true) return fail('"every" is true or absent');
    return { from, to, every: every === true };
  });
  return { id, reason, file, sha256, lines: edits };
}
