/**
 * Human/creature job graphics bindings in both the flat `[jobgraphics]` schema and the indexed
 * `[jobbasegraphics]`/`[jobchangegraphics]` one.
 */

import {
  findProps,
  getInt,
  getPaletteName,
  normalizeAssetPath,
  normalizeOptionalPath,
  type RuleProp,
  type RuleSection,
} from '../grammar.js';
import { type BmdPaletteBinding, readBmdPaletteBindings } from './bmd-palette.js';

/**
 * Extracts the readable `[jobgraphics]` records (`.../animals/jobgraphics.ini`, the one binding file
 * shipped as plain `.ini`): `gfxbobmanagerbody "<body>.bmd" ["<shadow>.bmd"]` plus
 * `gfxpalettebody "<editname>"`.
 */
export function extractGraphicsBindings(sections: readonly RuleSection[]): BmdPaletteBinding[] {
  return sections.flatMap((sec) =>
    sec.name === 'jobgraphics' ? readBmdPaletteBindings(sec, 'gfxbobmanagerbody', 'gfxpalettebody') : [],
  );
}

export interface IndexedBobManager {
  /** The leading int slot index (`gfxbobmanagerbody 0 ...`); head bobs come in numbered variant slots. */
  readonly index: number;
  /** The bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set, same normalization; head bobs never carry one. */
  readonly shadowBmd: string | undefined;
}

/**
 * One human's full graphics binding from a `[jobbasegraphics]` record: a body bob plus zero-or-more
 * numbered head bobs, each a `gfxbobmanagerbody/head <index> "<bmd>" ["<shadow>"]` line whose leading
 * int shifts the `.bmd` path off `values[0]`. Palettes split three ways: `gfxpalettebasebody` and
 * `gfxpalettebasehead` colour the two bob sets, `gfxpaletterandom` is the per-settler random tint range.
 */
export interface JobBaseGraphicsBinding {
  /** The record's `logictribe` id, when it carries the key. */
  readonly tribeId: number | undefined;
  /** The record's `logicjob` id, when it carries the key. */
  readonly jobId: number | undefined;
  /** The `gfxbobmanagerbody` slots in file order; a record with none is skipped. */
  readonly body: readonly IndexedBobManager[];
  /** The `gfxbobmanagerhead` slots in file order; empty for the body-only creatures. */
  readonly head: readonly IndexedBobManager[];
  /** The `gfxpalettebasebody` `editname`, lower-cased. */
  readonly bodyPalette: string | undefined;
  /** The `gfxpalettebasehead` `editname`, lower-cased. */
  readonly headPalette: string | undefined;
  /** The `gfxpaletterandom` `editname`, lower-cased. */
  readonly randomPalette: string | undefined;
}

/**
 * Parses an indexed bob-manager line, `gfxbobmanagerbody 0 "<bmd>" ["<shadow>"]`. A non-numeric or
 * absent index falls back to 0 so a slightly malformed slot still binds its `.bmd`.
 */
function parseIndexedBobManager(prop: RuleProp): IndexedBobManager | undefined {
  const index = Number.parseInt(prop.values[0] ?? '', 10);
  const bmd = prop.values[1];
  if (bmd === undefined || bmd.trim() === '') return undefined;
  const shadow = prop.values[2];
  return {
    index: Number.isNaN(index) ? 0 : index,
    bmd: normalizeAssetPath(bmd),
    shadowBmd: normalizeOptionalPath(shadow),
  };
}

/**
 * Reduces every section named `sectionName` to a {@link JobBaseGraphicsBinding}: `[jobbasegraphics]` and
 * `[jobchangegraphics]` differ only in section name and intent, not grammar. A record with no usable
 * body bob is skipped.
 */
function extractIndexedGraphics(
  sections: readonly RuleSection[],
  sectionName: string,
): JobBaseGraphicsBinding[] {
  const bindings: JobBaseGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== sectionName) continue;
    const body: IndexedBobManager[] = [];
    for (const p of findProps(sec, 'gfxbobmanagerbody')) {
      const slot = parseIndexedBobManager(p);
      if (slot !== undefined) body.push(slot);
    }
    if (body.length === 0) continue;
    const head: IndexedBobManager[] = [];
    for (const p of findProps(sec, 'gfxbobmanagerhead')) {
      const slot = parseIndexedBobManager(p);
      if (slot !== undefined) head.push(slot);
    }
    bindings.push({
      tribeId: getInt(sec, 'logictribe'),
      jobId: getInt(sec, 'logicjob'),
      body,
      head,
      bodyPalette: getPaletteName(sec, 'gfxpalettebasebody'),
      headPalette: getPaletteName(sec, 'gfxpalettebasehead'),
      randomPalette: getPaletteName(sec, 'gfxpaletterandom'),
    });
  }
  return bindings;
}

/**
 * Extracts the `[jobbasegraphics]` base-appearance records from the mod's
 * `DataCnmd/types/humanstype/jobgraphics.ini` or the base game's `humans/jobgraphics.cif`.
 */
export function extractJobBaseGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobbasegraphics');
}

/**
 * Extracts the `[jobchangegraphics]` records from the same files: the equipment/job skin that reskins a
 * human for a specific `(logictribe, logicjob)` over the base appearance.
 */
export function extractJobChangeGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobchangegraphics');
}
