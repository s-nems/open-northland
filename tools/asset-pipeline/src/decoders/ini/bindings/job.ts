/**
 * Human/creature job graphics bindings — the `.bmd`→palette pairings for animated actors, in both the
 * flat `[jobgraphics]` schema and the richer indexed `[jobbasegraphics]`/`[jobchangegraphics]` one.
 */

import {
  findProp,
  findProps,
  getInt,
  getStr,
  normalizeAssetPath,
  normalizeOptionalPath,
  normalizePaletteName,
  type RuleProp,
  type RuleSection,
} from '../grammar.js';

/**
 * One bob set's palette pairing: a `.bmd` body (and its optional shadow `.bmd`) bound to the palette
 * `editname` its `[jobgraphics]` record names — the **second leg** of the `.bmd`→palette graph.
 * The first leg ({@link import('./palette.js').extractPaletteIndex}) resolves `paletteName` to a
 * `.pcx` trailer palette; together they answer "which 256 colours colour this `.bmd`". The `.bmd`
 * paths are normalized (forward-slash, lower-case) so a lookup against the unpacked `--out` tree is
 * host-OS/case-independent, matching {@link import('./palette.js').PaletteAlias.gfxFile}.
 */
export interface BmdPaletteBinding {
  /** The body bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set, same normalization, or `undefined` when the record has no shadow `.bmd`. */
  readonly shadowBmd: string | undefined;
  /**
   * The palette `editname` the record references, **lower-cased** ({@link normalizePaletteName}) so it
   * joins case-insensitively onto the palette alias `name` (the two legs disagree on case in the real
   * data).
   */
  readonly paletteName: string;
  /** The `logictribe` id the record applies to, when present (a cross-reference, not required). */
  readonly tribeId: number | undefined;
  /** The `logicjob` id the record applies to, when present (a cross-reference, not required). */
  readonly jobId: number | undefined;
}

/**
 * Extracts the readable `[jobgraphics]` records (`Data/engine2d/inis/animals/jobgraphics.ini` — the
 * one graphics binding file that ships as plain `.ini`, the rest being `.cif`) into `.bmd`→palette
 * bindings. Each record carries a `gfxbobmanagerbody "<body>.bmd" "<shadow>.bmd"` (the shadow value is
 * optional) and a `gfxpalettebody "<editname>"`; the `editname` resolves to a `.pcx` trailer palette
 * via {@link import('./palette.js').extractPaletteIndex}, completing the pairing the `.bmd` container
 * itself doesn't carry.
 *
 * A record missing the body `.bmd` (nothing to colour) or the palette name (unbindable) is skipped
 * rather than throwing — this is an index over many records and one malformed entry must not abort the
 * offline batch. Paths are normalized via {@link normalizeAssetPath}. The richer mod
 * `[jobbasegraphics]` variant (indexed body/head bobs + `gfxpalettebasebody`/`gfxpalettebasehead`/
 * `gfxpaletterandom`) is a separate extractor ({@link extractJobBaseGraphics}); this one covers only
 * the flat `[jobgraphics]` schema.
 */
export function extractGraphicsBindings(sections: readonly RuleSection[]): BmdPaletteBinding[] {
  const bindings: BmdPaletteBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'jobgraphics') continue;
    const body = findProp(sec, 'gfxbobmanagerbody');
    const bmd = body?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteName = getStr(sec, 'gfxpalettebody');
    if (paletteName === undefined || paletteName.trim() === '') continue;
    const shadow = body?.values[1];
    bindings.push({
      bmd: normalizeAssetPath(bmd),
      shadowBmd: normalizeOptionalPath(shadow),
      paletteName: normalizePaletteName(paletteName),
      tribeId: getInt(sec, 'logictribe'),
      jobId: getInt(sec, 'logicjob'),
    });
  }
  return bindings;
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
 * One human's full graphics binding from a mod `[jobbasegraphics]` record — the **richer variant** of
 * {@link BmdPaletteBinding}. Unlike the flat `[jobgraphics]` schema (one body
 * `.bmd` + one palette), a human draws as a **body** bob plus zero-or-more numbered **head** bobs, each
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

/** First value of the first matching property as a lower-cased palette `editname`, or `undefined` if absent/empty. */
function getPaletteName(sec: RuleSection, key: string): string | undefined {
  const name = getStr(sec, key);
  return name !== undefined && name.trim() !== '' ? normalizePaletteName(name) : undefined;
}

/**
 * Reduces every section named `sectionName` to a {@link JobBaseGraphicsBinding}. The
 * `[jobbasegraphics]` (base appearance) and `[jobchangegraphics]` (equipment/job skin) records share
 * the **same grammar** — indexed `gfxbobmanagerbody/head` bob slots (the `.bmd` path on `values[1]`,
 * the leading int slot index on `values[0]`) + the three optional palette keys (`gfxpalettebasebody`/
 * `gfxpalettebasehead`/`gfxpaletterandom`, lower-cased to join onto the palette alias `name`
 * case-insensitively) — differing only in their section name and intent, so both public extractors
 * delegate here. A record with no usable body bob is skipped (nothing to colour) rather than throwing —
 * an index over many records must not abort the offline batch on one malformed entry, matching
 * {@link extractGraphicsBindings}. Head bobs and every palette are optional and simply omitted when
 * absent; the consumer resolves whichever palettes are present against the unpacked `--out` tree.
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
 * Extracts the `[jobbasegraphics]` records (the **base appearance** layer) from the mod's richer human
 * skin (`DataCnmd/types/humanstype/jobgraphics.ini`) or the base game's `humans/jobgraphics.cif` — the
 * second binding skin alongside the flat {@link extractGraphicsBindings} `[jobgraphics]` one. See
 * {@link extractIndexedGraphics} for the shared grammar; {@link extractJobChangeGraphics} is its
 * equipment-skin sibling.
 */
export function extractJobBaseGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobbasegraphics');
}

/**
 * Extracts the `[jobchangegraphics]` records (the **equipment/job skin** layer) — the sibling of
 * {@link extractJobBaseGraphics}'s `[jobbasegraphics]` base-appearance layer. Both legs ship in the same
 * files: the base game's `Data/engine2d/inis/humans/jobgraphics.cif` and, preferred per golden rule #4,
 * the mod's `DataCnmd/types/humanstype/jobgraphics.ini`. A `[jobchangegraphics]` record reskins a human
 * for a specific `(logictribe, logicjob)` — e.g. swapping in a job's head/equipment bob set over the
 * shared body geometry — using the **identical grammar** as `[jobbasegraphics]` (indexed
 * `gfxbobmanagerbody/head` slots + `gfxpalettebasebody`/`gfxpalettebasehead`/`gfxpaletterandom`), so it
 * yields the same {@link JobBaseGraphicsBinding} shape and flattens via the same
 * `jobBaseGraphicsToBindings` path. A record with no usable body bob is skipped, matching the base leg.
 */
export function extractJobChangeGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobchangegraphics');
}
