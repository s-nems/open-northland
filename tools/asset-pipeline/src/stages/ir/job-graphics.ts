import { readFile } from 'node:fs/promises';
import type { JobGraphics } from '@open-northland/data';
import {
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  iniBytesToSections,
  type JobBaseGraphicsBinding,
  makeSource,
  type SourceRef,
} from '../../decoders/ini.js';
import { CULTURESNATION_MOD } from '../../mod-root.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';
import { loadCifTable } from './cif-tables.js';

const MOD_FILE = `${CULTURESNATION_MOD}/types/humanstype/jobgraphics.ini`;
const BASE_FILE = 'Data/engine2d/inis/humans/jobgraphics.cif';

/** The IR rows of one source's `[jobbasegraphics]` records; a record missing its tribe or job is dropped. */
export function jobGraphicsRows(records: readonly JobBaseGraphicsBinding[], src: SourceRef): JobGraphics[] {
  const rows: JobGraphics[] = [];
  for (const rec of records) {
    const body = rec.body[0];
    if (rec.tribeId === undefined || rec.jobId === undefined || body === undefined) continue;
    rows.push({
      tribe: rec.tribeId,
      job: rec.jobId,
      body: body.bmd,
      ...(body.shadowBmd !== undefined ? { shadowBody: body.shadowBmd } : {}),
      heads: rec.head.map((h) => h.bmd),
      ...(rec.bodyPalette !== undefined ? { bodyPalette: rec.bodyPalette } : {}),
      ...(rec.headPalette !== undefined ? { headPalette: rec.headPalette } : {}),
      randomPalettes: [...rec.randomPalettes],
      source: makeSource(src, 'jobbasegraphics'),
    });
  }
  return rows;
}

/**
 * A `[jobchangegraphics]` record's palette part: the `gfxpaletterandom` names it lists in file order.
 * Original behavior: the loader keeps one change recipe per record, and each line overwrites the last.
 */
export interface JobChangeRecipes {
  readonly tribe: number;
  readonly job: number;
  readonly recipes: readonly string[];
}

/** The palette part of one source's `[jobchangegraphics]` records; a record missing its tribe or job is
 *  dropped. */
export function jobChangeRows(records: readonly JobBaseGraphicsBinding[]): JobChangeRecipes[] {
  return records.flatMap((rec) =>
    rec.tribeId === undefined || rec.jobId === undefined
      ? []
      : [{ tribe: rec.tribeId, job: rec.jobId, recipes: rec.randomPalettes }],
  );
}

/** Folds the layers highest precedence first: the first row per `(tribe, job)` wins. */
export function mergeJobGraphics<Row extends { readonly tribe: number; readonly job: number }>(
  layers: readonly (readonly Row[])[],
): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const layer of layers) {
    for (const row of layer) {
      const key = `${row.tribe}:${row.job}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/** The human graphics tables: `[jobbasegraphics]` looks and `[jobchangegraphics]` palette recipes. */
export interface HumanJobGraphics {
  readonly jobGraphics: JobGraphics[];
  readonly jobChanges: JobChangeRecipes[];
}

/**
 * The human `[jobbasegraphics]` and `[jobchangegraphics]` tables, mod `.ini` over base `.cif`. An absent
 * source contributes nothing, so a partial mod tree still yields the rows it has.
 */
export async function loadJobGraphics(roots: SourceRoots): Promise<HumanJobGraphics> {
  const modPath = await resolveSourceFile(roots, MOD_FILE);
  const modSections = modPath === undefined ? [] : iniBytesToSections(await readFile(modPath));
  const base = await loadCifTable(
    roots,
    BASE_FILE,
    (sections, src) => ({
      looks: jobGraphicsRows(extractJobBaseGraphics(sections), src),
      changes: jobChangeRows(extractJobChangeGraphics(sections)),
    }),
    { looks: [], changes: [] },
  );
  const modLooks = jobGraphicsRows(extractJobBaseGraphics(modSections), { file: MOD_FILE, layer: 'mod' });
  return {
    jobGraphics: mergeJobGraphics([modLooks, base.looks]),
    jobChanges: mergeJobGraphics([jobChangeRows(extractJobChangeGraphics(modSections)), base.changes]),
  };
}
