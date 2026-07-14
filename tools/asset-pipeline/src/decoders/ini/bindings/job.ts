/**
 * Human/creature job graphics bindings — the `.bmd`→palette pairings for animated actors, in both the
 * flat `[jobgraphics]` schema and the richer indexed `[jobbasegraphics]`/`[jobchangegraphics]` one.
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
 * shipped as plain `.ini`) into `.bmd`→palette bindings via the shared {@link readBmdPaletteBindings}:
 * `gfxbobmanagerbody "<body>.bmd" ["<shadow>.bmd"]` + `gfxpalettebody "<editname>"`, the `editname`
 * resolving to a `.pcx` trailer palette ({@link import('./palette.js').extractPaletteIndex}). A record
 * missing its body bob or palette is skipped. The richer indexed `[jobbasegraphics]` variant is a
 * separate extractor ({@link extractJobBaseGraphics}).
 */
export function extractGraphicsBindings(sections: readonly RuleSection[]): BmdPaletteBinding[] {
  return sections.flatMap((sec) =>
    sec.name === 'jobgraphics' ? readBmdPaletteBindings(sec, 'gfxbobmanagerbody', 'gfxpalettebody') : [],
  );
}

/** One indexed bob-manager slot: a slot index + its body `.bmd` and (for body bobs) an optional shadow `.bmd`. */
export interface IndexedBobManager {
  /** The leading int slot index (`gfxbobmanagerbody 0 ...`, `gfxbobmanagerhead 3 ...`) — head bobs come in numbered variant slots (0..3). */
  readonly index: number;
  /** The bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set (body bobs only), same normalization, or `undefined` when absent (head bobs never carry one). */
  readonly shadowBmd: string | undefined;
}

/**
 * One human's full graphics binding from a mod `[jobbasegraphics]` record — the richer variant of
 * {@link BmdPaletteBinding}. Unlike the flat `[jobgraphics]` schema (one body
 * `.bmd` + one palette), a human draws as a body bob plus zero-or-more numbered head bobs, each
 * a `gfxbobmanagerbody/head <index> "<bmd>" ["<shadow>"]` line whose leading int index shifts the `.bmd`
 * path off `values[0]` (so it cannot reuse {@link extractGraphicsBindings}). Palettes split three ways:
 * `gfxpalettebasebody`/`gfxpalettebasehead` colour the two bob sets, and `gfxpaletterandom` is the
 * per-settler random tint range. Each palette name lower-cases ({@link normalizePaletteName}) to join
 * case-insensitively onto the palette alias `name`.
 */
export interface JobBaseGraphicsBinding {
  /** The `logictribe` id the record applies to, when present (a cross-reference, not required). */
  readonly tribeId: number | undefined;
  /** The `logicjob` id the record applies to, when present (a cross-reference, not required). */
  readonly jobId: number | undefined;
  /** The body bob slots (`gfxbobmanagerbody`), in file order — at least one (a record with none is skipped). */
  readonly body: readonly IndexedBobManager[];
  /** The head bob slots (`gfxbobmanagerhead`), in file order — may be empty (some creatures are body-only). */
  readonly head: readonly IndexedBobManager[];
  /** The body palette `editname`, lower-cased, or `undefined` when the record omits `gfxpalettebasebody`. */
  readonly bodyPalette: string | undefined;
  /** The head palette `editname`, lower-cased, or `undefined` when the record omits `gfxpalettebasehead`. */
  readonly headPalette: string | undefined;
  /** The random-tint palette `editname`, lower-cased, or `undefined` when the record omits `gfxpaletterandom`. */
  readonly randomPalette: string | undefined;
}

/**
 * Parses an indexed bob-manager line (`gfxbobmanagerbody 0 "<bmd>" ["<shadow>"]`) into an
 * {@link IndexedBobManager}, or `undefined` if it has no `.bmd` path. The leading token is the slot
 * index; the second is the body `.bmd`; the optional third (body lines only) is the shadow `.bmd`.
 * A non-numeric/absent index falls back to 0 so a slightly malformed slot still binds its `.bmd`.
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
 * Reduces every section named `sectionName` to a {@link JobBaseGraphicsBinding} — the shared reducer
 * both public extractors delegate to, since `[jobbasegraphics]` and `[jobchangegraphics]` differ only in
 * section name and intent, not grammar. A record with no usable body bob is skipped; head bobs and all
 * palettes are optional and omitted when absent.
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
 * Extracts the `[jobbasegraphics]` records (the base appearance layer) from the mod's richer human
 * skin (`DataCnmd/types/humanstype/jobgraphics.ini`) or the base game's `humans/jobgraphics.cif` — the
 * second binding skin alongside the flat {@link extractGraphicsBindings} `[jobgraphics]` one. See
 * {@link extractIndexedGraphics} for the shared grammar; {@link extractJobChangeGraphics} is its
 * equipment-skin sibling.
 */
export function extractJobBaseGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobbasegraphics');
}

/**
 * Extracts the `[jobchangegraphics]` records — the equipment/job-skin sibling of
 * {@link extractJobBaseGraphics}'s base-appearance layer, shipping in the same files. A record reskins a
 * human for a specific `(logictribe, logicjob)` (e.g. a job's head/equipment bob set over the shared
 * body), same grammar and {@link JobBaseGraphicsBinding} shape as the base leg.
 */
export function extractJobChangeGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobchangegraphics');
}
