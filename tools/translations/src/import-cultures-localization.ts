#!/usr/bin/env node
/**
 * Imports the Chinese text of CulturesGameLocalization into `translations/{chs,cht}/` as JSON overlays
 * against the data pack's German text, and rewrites `translations/glossary.csv`. Usage and provenance:
 * `translations/SOURCES.md`.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TRANSLATIONS_ROOT } from '@open-northland/translations';
import { LOCALIZATION_LANGUAGES } from './import/columns.js';
import { formatReport } from './import/report.js';
import { GLOSSARY_FILE, importCulturesLocalization } from './import/run.js';

/** The asset pipeline's corrections, beside this tool in `tools/`. */
const CORRECTIONS_DIR = fileURLToPath(new URL('../../asset-pipeline/corrections', import.meta.url));

const USAGE =
  'usage: import-cultures-localization --source <CulturesGameLocalization> --data-root <unpacked pack> --out <translations dir>';

/** The checkout's commit, marked when its tree has local changes, for `SOURCES.md`. */
function sourceCommit(source: string): string {
  try {
    const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    return dirty === '' ? head : `${head} (with local changes)`;
  } catch {
    return 'unknown commit';
  }
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** Every file under `out/<lang>/`, as paths relative to `out`. */
async function overlayFiles(out: string): Promise<string[]> {
  const files: string[] = [];
  for (const lang of LOCALIZATION_LANGUAGES) {
    let entries: string[];
    try {
      entries = await readdir(join(out, lang), { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries)
      if (entry.endsWith('.json'))
        files.push(
          relative(out, join(out, lang, entry))
            .split(sep)
            .join('/'),
        );
  }
  return files.sort();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      'data-root': { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (values.source === undefined || values['data-root'] === undefined || values.out === undefined) {
    throw new Error(USAGE);
  }
  // npm runs a workspace script inside the workspace; INIT_CWD is where it was invoked.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const source = resolve(baseDir, values.source);
  const out = resolve(baseDir, values.out);
  const result = await importCulturesLocalization({
    source,
    dataRoot: resolve(baseDir, values['data-root']),
    corrections: CORRECTIONS_DIR,
    translations: TRANSLATIONS_ROOT,
  });
  for (const file of result.files)
    await writeText(join(out, file.path), `${JSON.stringify(file.value, null, 2)}\n`);
  await writeText(join(out, GLOSSARY_FILE), result.glossary);
  console.log(formatReport(result, sourceCommit(source)));
  const written = new Set(result.files.map((file) => file.path));
  const others = (await overlayFiles(out)).filter((path) => !written.has(path));
  // A re-import replaces its own files; one it no longer writes, or a project overlay, stays for review.
  if (others.length > 0) console.log(`Overlay files this run did not write: ${others.join(', ')}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
