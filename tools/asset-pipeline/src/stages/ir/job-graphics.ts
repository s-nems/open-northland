import type { JobGraphics } from '@open-northland/data';
import { type Vfs, vjoin } from '@open-northland/vfs';
import {
  extractJobBaseGraphics,
  iniBytesToSections,
  type JobBaseGraphicsBinding,
  makeSource,
  type SourceRef,
} from '../../decoders/ini.js';
import { CULTURESNATION_MOD } from '../../probe.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';
import { loadCifTable } from './cif-tables.js';

const MOD_FILE = vjoin(CULTURESNATION_MOD, 'types', 'humanstype', 'jobgraphics.ini');
const BASE_FILE = vjoin('Data', 'engine2d', 'inis', 'humans', 'jobgraphics.cif');

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
      source: makeSource(src, 'jobbasegraphics'),
    });
  }
  return rows;
}

/** Folds the layers highest precedence first: the first row per `(tribe, job)` wins. */
export function mergeJobGraphics(layers: readonly (readonly JobGraphics[])[]): JobGraphics[] {
  const seen = new Set<string>();
  const out: JobGraphics[] = [];
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

/**
 * The human `[jobbasegraphics]` table, mod `.ini` over base `.cif`. A source absent from every root
 * contributes nothing, so a partial install still yields the rows it has.
 */
export async function loadJobGraphics(fs: Vfs, roots: SourceRoots): Promise<JobGraphics[]> {
  const modPath = await resolveSourceFile(fs, roots, MOD_FILE);
  const mod =
    modPath === undefined
      ? []
      : jobGraphicsRows(extractJobBaseGraphics(iniBytesToSections(await fs.readFile(modPath))), {
          file: MOD_FILE,
          layer: 'mod',
        });
  const base = await loadCifTable(
    fs,
    roots,
    BASE_FILE,
    (sections, src) => jobGraphicsRows(extractJobBaseGraphics(sections), src),
    [],
  );
  return mergeJobGraphics([mod, base]);
}
