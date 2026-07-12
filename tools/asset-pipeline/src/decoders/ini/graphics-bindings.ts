/**
 * Palette/BMD graphics bindings, landscape graphics, indexed human-graphics managers, bob sequences, and atomic-animation frame bindings.
 */
import { BobSequenceSet, GfxAnimAtomic } from '@vinland/data';
import { decodeCifStringArray } from '../cif.js';
import {
  cifLinesToSections,
  findProp,
  findProps,
  getInt,
  getStr,
  normalizeAssetPath,
  normalizeOptionalPath,
  normalizePaletteName,
  type RuleProp,
  type RuleSection,
  type SourceRef,
} from './grammar.js';

/**
 * One resolved palette alias: a name a graphics record references (via `gfxpalettebody "<name>"`)
 * mapped to the `.pcx` whose trailer palette holds the actual 256 colours. The path is normalized to
 * a forward-slash, lower-cased, relative path so a lookup is host-OS- and case-independent (archive
 * names use Windows backslashes and mixed case, e.g. `data\Engine2D\Bin\palettes\landscapes\tree01.pcx`).
 */
export interface PaletteAlias {
  /**
   * The `editname` a graphics record references, **lower-cased** ({@link normalizePaletteName}): the
   * original engine looks `editname`s up case-insensitively, and the real data mixes case across the
   * two legs (e.g. `palettes.ini` declares `Lion01`/`Chicken01` while `jobgraphics.ini` references
   * `LION01`/`chicken01`). Lower-casing the join key on both sides makes the pairing resolve. One
   * record may expose several aliases for one file.
   */
  readonly name: string;
  /** The palette source `.pcx`, as a normalized `data/.../foo.pcx` relative path (forward slashes, lower-case). */
  readonly gfxFile: string;
}

/**
 * Extracts the `palettes.ini` (`Data/engine2d/inis/palettes/palettes.ini`) `[GfxPalette256]` records
 * into name→`.pcx` palette aliases. This is the first leg of the `.bmd` palette-pairing graph:
 * a graphics record names a bob set's palette by `editname`
 * (`gfxpalettebody "tree01"`), `palettes.ini` resolves that name to a `gfxfile` `.pcx`, and the
 * `.pcx` trailer palette is the colour table {@link import('./pcx.js').decodePcx} already returns.
 *
 * Each record carries exactly one `gfxfile` but the grammar allows **several** `editname` aliases —
 * every alias is emitted as its own entry pointing at the shared file, so a consumer builds one flat
 * `name -> .pcx` map (the real file has 143 `[GfxPalette256]` records; it also holds 108
 * `[GfxPalette16]` 16-colour sub-palettes built via `gfxcolorrange` with no `.pcx`, which the
 * section-name guard skips). A record missing its `gfxfile` (nothing to resolve to) or with no
 * `editname` (unreferenceable) is skipped rather than throwing: this is an index over many records
 * and one malformed entry must not abort the offline batch. Paths are normalized via
 * {@link normalizeAssetPath} for host-OS/case-independent lookup against the unpacked `--out` tree.
 * The other binding leg (which `.bmd` uses which `editname`) lives mostly in graphics `.cif` records
 * (only `animals/jobgraphics.ini` is readable) and is wired in a later step.
 */
export function extractPaletteIndex(sections: readonly RuleSection[]): PaletteAlias[] {
  const aliases: PaletteAlias[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxPalette256') continue;
    const gfxFile = getStr(sec, 'gfxfile');
    if (gfxFile === undefined || gfxFile.trim() === '') continue;
    const normalized = normalizeAssetPath(gfxFile);
    for (const p of findProps(sec, 'editname')) {
      const name = p.values[0];
      if (name === undefined || name.trim() === '') continue;
      aliases.push({ name: normalizePaletteName(name), gfxFile: normalized });
    }
  }
  return aliases;
}

/**
 * One bob set's palette pairing: a `.bmd` body (and its optional shadow `.bmd`) bound to the palette
 * `editname` its `[jobgraphics]` record names — the **second leg** of the `.bmd`→palette graph.
 * The first leg ({@link extractPaletteIndex}) resolves `paletteName` to a
 * `.pcx` trailer palette; together they answer "which 256 colours colour this `.bmd`". The `.bmd`
 * paths are normalized (forward-slash, lower-case) so a lookup against the unpacked `--out` tree is
 * host-OS/case-independent, matching {@link PaletteAlias.gfxFile}.
 */
export interface BmdPaletteBinding {
  /** The body bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set, same normalization, or `undefined` when the record has no shadow `.bmd`. */
  readonly shadowBmd: string | undefined;
  /**
   * The palette `editname` the record references, **lower-cased** ({@link normalizePaletteName}) so it
   * joins case-insensitively onto {@link PaletteAlias.name} (the two legs disagree on case in the real
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
 * via {@link extractPaletteIndex}, completing the pairing the `.bmd` container itself doesn't carry.
 *
 * A record missing the body `.bmd` (nothing to colour) or the palette name (unbindable) is skipped
 * rather than throwing — this is an index over many records and one malformed entry must not abort the
 * offline batch, matching {@link extractPaletteIndex}. Paths are normalized via
 * {@link normalizeAssetPath}. The richer mod `[jobbasegraphics]` variant (indexed body/head bobs +
 * `gfxpalettebasebody`/`gfxpalettebasehead`/`gfxpaletterandom`) is a separate, later extractor; this
 * one covers only the flat `[jobgraphics]` schema.
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

/**
 * One landscape-object graphics binding: a {@link BmdPaletteBinding} (`.bmd` body + shadow + palette
 * editname) plus the record's `EditName`. The name is provenance and a **species handle** — a render
 * binding picks "yew 01" vs "fir 01" by it without re-reading the `.cif`, and many records share one
 * body bob recoloured per palette, so the name is the only thing distinguishing them at the IR layer.
 */
export interface LandscapeGraphicsBinding extends BmdPaletteBinding {
  /** The record's `EditName` (e.g. `"yew 01"`), or undefined when the record omits it. */
  readonly editName: string | undefined;
}

/**
 * Extracts the `[GfxLandscape]` records from `Data/engine2d/inis/landscapes/landscapes.cif` — the
 * **landscape-object** graphics binding (trees, bushes, signs, wonders, harbours, …): the map's
 * pre-placed decor, the exact analog of the `[jobgraphics]` creature binding but for static objects.
 * Each record names a body + shadow bob set (`GfxBobLibs "<body>.bmd" "<shadow>.bmd"`) and the palette
 * `editname` (`GfxPalette "tree_yew01"`) that recolours it — the same `(bmd, palette)` pairing
 * {@link convertBmdTree} consumes, completing what the `.bmd` container itself lacks. This is the
 * missing leg that lets `ls_trees.bmd` (and the other `ls_*.bmd` decor sets) become atlases: it ships
 * **`.cif`-only** (no readable `.ini` twin), so it is decoded via {@link decodeCifStringArray} →
 * {@link cifLinesToSections} like the base humans graphics. Unlike the lower-cased `.ini` graphics
 * keys, the editor serializes these records with **CamelCase** keys (`GfxBobLibs`/`GfxPalette`/
 * `EditName`) and a CamelCase section header (`GfxLandscape`), so the lookups match that casing.
 *
 * A record without a body bob (some decor is texture-only / a logic marker) or without a palette name
 * (unbindable) is skipped, never thrown — this indexes hundreds of records and one malformed entry must
 * not abort the offline batch (matching {@link extractGraphicsBindings}). `tribeId`/`jobId` are always
 * undefined (a landscape object has neither cross-ref). Repeated `(bmd, palette)` pairs (the ~99 tree
 * species share a dozen palettes) are **not** deduped here — the atlas filename keys on `(bmd, palette)`
 * so a duplicate only re-emits identical bytes; deduping is the caller's concern.
 */
export function extractLandscapeGraphics(sections: readonly RuleSection[]): LandscapeGraphicsBinding[] {
  const bindings: LandscapeGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteName = getStr(sec, 'GfxPalette');
    if (paletteName === undefined || paletteName.trim() === '') continue;
    const shadow = libs?.values[1];
    bindings.push({
      bmd: normalizeAssetPath(bmd),
      shadowBmd: normalizeOptionalPath(shadow),
      paletteName: normalizePaletteName(paletteName),
      tribeId: undefined,
      jobId: undefined,
      editName: getStr(sec, 'EditName'),
    });
  }
  return bindings;
}

/**
 * Extracts the `[bobseq]` records from `animations.ini` (the mod's
 * `animation/mapmoveableanimations/animations.ini`) into one {@link BobSequenceSet} per bob set — the
 * named animation ranges (`seq "<name>" <start> <length>`) the renderer previously hard-coded as magic
 * frame constants (`WALK` start 1988, `CHOP` 5106, …). Each record names its `imagelib` `.bmd` (the bob
 * set the ids index into) plus an optional `shadowlib`, and lists every sequence as a `seq` line whose
 * three values are the quoted name, the first bob id, and the total frame count across all directions.
 *
 * The render builds a directional cycle from each: `start` + `length` (with `dirs` = 8 for these
 * sprites, so the per-direction stride is `length / dirs`). The same sequence name recurs across several
 * bob sets that share a layout (`human_man_generic_walk` is 1988/96 in `CR_Hum_Body_00`, `_05`, `_10`,
 * …); each set is emitted independently so a consumer resolves by `(imagelib, name)`. `imagelib`/
 * `shadowlib` are normalized (lower-cased; they are bare `.bmd` filenames) to join case-insensitively
 * onto the decoded atlas stems. A record with no `imagelib` (nothing to index) or a `seq` line missing
 * its start/length (non-numeric) is skipped, never thrown — one malformed line must not abort the batch.
 */
export function extractBobSequences(sections: readonly RuleSection[], src: SourceRef): BobSequenceSet[] {
  const sets: BobSequenceSet[] = [];
  for (const sec of sections) {
    if (sec.name !== 'bobseq') continue;
    const imagelib = getStr(sec, 'imagelib');
    if (imagelib === undefined || imagelib.trim() === '') continue;
    const shadowlib = getStr(sec, 'shadowlib');
    const sequences: { name: string; start: number; length: number }[] = [];
    for (const p of findProps(sec, 'seq')) {
      const name = p.values[0];
      const start = Number.parseInt(p.values[1] ?? '', 10);
      const length = Number.parseInt(p.values[2] ?? '', 10);
      if (name === undefined || name.trim() === '' || Number.isNaN(start) || Number.isNaN(length)) continue;
      sequences.push({ name, start, length });
    }
    sets.push(
      BobSequenceSet.parse({
        imagelib: normalizeAssetPath(imagelib),
        shadowlib: normalizeOptionalPath(shadowlib),
        sequences,
        source: { file: src.file, block: 'bobseq', layer: src.layer ?? 'base' },
      }),
    );
  }
  return sets;
}

/**
 * Extracts the `[gfxanimatomic]` records from `mapmoveableanimations/animations.ini` into
 * {@link GfxAnimAtomic} rows — the atomic-action → directional body-animation binding the renderer needs
 * to play an ACTION (an attack swing, a work stroke) FACING its target. Unlike {@link extractBobSequences}
 * (which reads only the `[bobseq]` frame ranges), this reads the `gfxanimframelistdir <dir> <idx…>` lines
 * that lay an animation out per facing — the layout a bare `start`/`length` cannot encode (a melee swing
 * pool is not `length / 8` and authors per-facing holds/reuse; see {@link GfxAnimAtomic}).
 *
 * Each `gfxanimframelistdir` is placed at its leading `<dir>` slot so `dirFrames[d]` is facing `d`
 * regardless of file order; a record with a single non-directional `gfxanimframelist` yields one
 * facing-locked list. A record missing its tribe/job/action/body-seq, or carrying no frame list at all, is
 * skipped (never thrown) — one malformed record must not abort the batch. The same `(job, action)` recurs
 * per tribe, and one job/action may have SEVERAL records (the unarmed soldier's four punch variants); all
 * are emitted, and a consumer resolves by `(tribe, job, action)` or by `bodySeq` name.
 */
export function extractGfxAnimAtomics(sections: readonly RuleSection[], src: SourceRef): GfxAnimAtomic[] {
  const out: GfxAnimAtomic[] = [];
  for (const sec of sections) {
    if (sec.name !== 'gfxanimatomic') continue;
    const tribe = getInt(sec, 'logictribe');
    const job = getInt(sec, 'logicjob');
    const action = getInt(sec, 'logicatomicaction');
    const bodySeq = getStr(sec, 'gfxbobseqbody');
    if (
      tribe === undefined ||
      job === undefined ||
      action === undefined ||
      bodySeq === undefined ||
      bodySeq.trim() === ''
    ) {
      continue;
    }
    const headSeq = getStr(sec, 'gfxbobseqhead');
    // Per-direction frame lists: place each `gfxanimframelistdir <dir> <idx…>` at its `<dir>` slot so the
    // outer index is the facing. A missing intermediate dir stays an empty list (playback holds frame 0).
    const dirProps = findProps(sec, 'gfxanimframelistdir');
    let dirFrames: number[][];
    if (dirProps.length > 0) {
      const byDir = new Map<number, number[]>();
      for (const p of dirProps) {
        const dir = Number.parseInt(p.values[0] ?? '', 10);
        if (Number.isNaN(dir) || dir < 0) continue;
        const ids = p.values
          .slice(1)
          .map((v) => Number.parseInt(v, 10))
          .filter((n) => !Number.isNaN(n) && n >= 0);
        byDir.set(dir, ids);
      }
      if (byDir.size === 0) continue;
      const maxDir = Math.max(...byDir.keys());
      dirFrames = [];
      for (let d = 0; d <= maxDir; d++) dirFrames.push(byDir.get(d) ?? []);
    } else {
      // A non-directional record: one facing-locked list (`gfxanimframelist <idx…>` — no leading dir).
      const single = findProps(sec, 'gfxanimframelist')[0];
      if (single === undefined) continue;
      const ids = single.values.map((v) => Number.parseInt(v, 10)).filter((n) => !Number.isNaN(n) && n >= 0);
      dirFrames = [ids];
    }
    if (dirFrames.every((list) => list.length === 0)) continue; // nothing to draw
    out.push(
      GfxAnimAtomic.parse({
        tribe,
        job,
        action,
        bodySeq,
        ...(headSeq !== undefined && headSeq.trim() !== '' ? { headSeq } : {}),
        dirFrames,
        source: { file: src.file, block: 'gfxanimatomic', layer: src.layer ?? 'base' },
      }),
    );
  }
  return out;
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
 * case-insensitively onto {@link PaletteAlias.name}.
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
 * `gfxpalettebasehead`/`gfxpaletterandom`, lower-cased to join onto {@link extractPaletteIndex}
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
