#!/usr/bin/env node
/**
 * Asset pipeline CLI — offline conversion of an OWNED original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
 *
 * This is run by a human/agent, not shipped. It writes NO copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 *
 * Phase 1 lands the stages one decoder at a time. Implemented now: `.lib` archives unpacked to loose
 * files under `--out` (the embedded `.pcx`/`.bmd`/`.cif` the later stages read), `.pcx` pictures -> PNG
 * (the loose-file pass over the `--game` tree), `.bmd` bob sets -> atlas PNG + manifest JSON for the
 * readable palette bindings (base animals `[jobgraphics]` + the mod's human `[jobbasegraphics]` skin),
 * and readable `.ini` rules -> a validated `content/ir.json`
 * (goods/jobs/landscape from base `Data/logic`, tribes + atomic animations from the mod's `DataCnmd`,
 * preferring the mod per CLAUDE.md), the declarative logic-header metadata of every `map.cif`
 * (dimensions/GUID/type/name ids), and the per-cell landscape grid of every `map.dat` -> a
 * `maps/<id>.json` `TerrainMap` (the sim's nav-graph input). The remaining stages (standalone
 * palettes, the `.cif`-only type tables, the map's `MissionData`/`StaticObjects` mission scripting,
 * and the oracle pixel-diff) are still TODO; see docs/ROADMAP.md.
 */

import { realpathSync } from 'node:fs';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ContentSet, IR_VERSION, type MapInfo, parseContentSet } from '@vinland/data';
import { type BobAtlas, packBobAtlas } from './decoders/atlas.js';
import { decodeBmd } from './decoders/bmd.js';
import { decodeCifStringArray } from './decoders/cif.js';
import {
  type BmdPaletteBinding,
  type JobBaseGraphicsBinding,
  type PaletteAlias,
  type RuleSection,
  type SourceRef,
  cifLinesToSections,
  decodeIni,
  extractAtomicAnimations,
  extractBuildings,
  extractGoods,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractJobs,
  extractLandscape,
  extractMapInfo,
  extractPaletteIndex,
  extractTribes,
  extractWeapons,
  fillBuildingRecipes,
  parseIniSections,
} from './decoders/ini.js';
import { decodeLib } from './decoders/lib.js';
import {
  type MapDatTerrainMap,
  decodeMapDat,
  decodeMapSize,
  findChunk,
  lmltToTerrainMap,
  unpackMapLayer,
} from './decoders/mapdat.js';
import { decodePcx, expandToRgba } from './decoders/pcx.js';
import { encodePng } from './decoders/png.js';

export interface Args {
  game: string;
  mod: string | undefined;
  out: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = get('--game');
  if (game === undefined) {
    throw new Error('usage: pipeline --game <dir> [--mod <subdir>] [--out <dir>]');
  }
  return { game, mod: get('--mod'), out: get('--out') ?? 'content' };
}

/**
 * Resolves the filesystem args (`game`, `out`) against `baseDir`, leaving absolute paths untouched.
 * The entry point passes `process.env.INIT_CWD` — the directory `npm run` was invoked from. npm runs
 * a workspace script with cwd set to the *workspace package* dir (`tools/asset-pipeline/`), so a
 * relative `--game ../Cultures 8th Wonder` would otherwise resolve there instead of where the user
 * typed it. Resolving against `INIT_CWD` makes the documented repo-root command work. `mod` stays a
 * bare subdir — it is always joined onto the resolved `game` ({@link resolveIniSources}).
 */
export function resolveArgs(args: Args, baseDir: string): Args {
  return { ...args, game: resolve(baseDir, args.game), out: resolve(baseDir, args.out) };
}

/**
 * Pure composition: `.pcx` bytes -> `.png` bytes (indexed RLE -> palette-expanded RGBA -> PNG
 * container). The three decoders stay pure; this is the only wiring between them. Throws a
 * `pcx:`/`png:`-prefixed error for a malformed or palette-less picture — {@link convertPcxTree}
 * catches it per-file so one bad image can't abort the batch.
 */
export function pcxToPng(bytes: Uint8Array): Uint8Array {
  return encodePng(expandToRgba(decodePcx(bytes)));
}

/**
 * Pure composition: `.bmd` bytes + a 768-byte RGB palette -> a packed bob atlas (the RGBA sheet to
 * PNG-encode + the JSON manifest of per-bob frame rects/metadata). Mirrors {@link pcxToPng}: the
 * decoders stay pure, this is the only wiring between them. The atlas PNG is `encodePng(atlas.image)`;
 * the manifest serializes straight to JSON. Throws a `bmd:`/`atlas:`-prefixed error for a malformed
 * container or a wrong-sized palette — the batch tree-walk (a later step) catches it per-file. The
 * **palette source** for a given `.bmd` (which `palettes.ini` entry / `.pcx` trailer pairs with it) is
 * the open question that gates the full tree-walk, so this seam takes the palette as a parameter today.
 */
export function bmdToAtlas(bmdBytes: Uint8Array, palette: Uint8Array): BobAtlas {
  return packBobAtlas(decodeBmd(bmdBytes), palette);
}

/**
 * Pure composition: one `map.cif`'s bytes + a slug id -> its validated {@link MapInfo} logic header.
 * Decodes the encrypted `CStringArray` root ({@link decodeCifStringArray}), folds its level-tagged
 * lines into {@link RuleSection}s ({@link cifLinesToSections}), and runs {@link extractMapInfo}. Like
 * {@link pcxToPng}/{@link bmdToAtlas} the decoders stay pure; this is the only wiring. Throws an
 * `ini:`/`cif:`-prefixed error for a non-map or header-less `.cif`; {@link decodeMapTree} catches it
 * per-file so one bad map can't abort the batch.
 */
export function mapCifToInfo(bytes: Uint8Array, id: string, src: SourceRef): MapInfo {
  const sections = cifLinesToSections(decodeCifStringArray(bytes).lines);
  return extractMapInfo(sections, id, src);
}

/**
 * Pure composition: one `map.dat`'s bytes -> the per-cell landscape-typeId grid the sim's
 * `buildTerrainGraph` consumes. Decodes the `hoix` container ({@link decodeMapDat}), reads the `lsiz`
 * grid dims ({@link decodeMapSize}), unpacks the `lmlt` landscape-type layer ({@link unpackMapLayer}),
 * and collapses its four per-corner typeIds per cell to one ({@link lmltToTerrainMap}) — the
 * `{ width, height, typeIds }` shape (`MapDatTerrainMap`, structurally a sim `TerrainMap`; the build
 * tool never imports `sim`). Like {@link mapCifToInfo} the decoders stay pure; this is the only
 * wiring. Throws a `mapdat:`-prefixed error for a non-container, a missing `lsiz`/`lmlt`, an
 * unsupported codec, or a dims/length mismatch; {@link convertMapDatTree} catches it per-file so one
 * bad map can't abort the batch. The `lmhe` height + `eatd`/`eald` object layers are out of scope here
 * (the nav graph only needs the landscape type).
 */
export function mapDatToTerrain(bytes: Uint8Array): MapDatTerrainMap {
  const map = decodeMapDat(bytes);
  const size = decodeMapSize(map);
  const lmlt = findChunk(map, 'lmlt');
  if (lmlt === undefined) {
    throw new Error('mapdat: no lmlt landscape-type chunk (cannot build the terrain grid)');
  }
  return lmltToTerrainMap(unpackMapLayer(lmlt), size);
}

/** Recursively yields every regular file under `dir` (absolute paths), in directory-entry order. */
async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Maps a `.lib` member name (a backslash path like `data\engine2d\bin\bobs\ls_bridge.bmd`) to a
 * safe path **relative** to the extraction root, or `undefined` if it would escape it. Archive names
 * use Windows backslashes regardless of host OS, so they are rewritten to the native separator before
 * normalizing. A normalized path that is absolute or still starts with `..` (i.e. climbs out of the
 * root) is rejected — defence against a malformed/hostile archive even though the real `data0001.lib`
 * has no such entries. An empty or all-separator name yields `undefined` (nothing to write).
 */
export function libMemberRelPath(name: string): string | undefined {
  const native = name.replace(/\\/g, sep);
  const norm = normalize(native);
  if (norm === '' || norm === '.') return undefined;
  if (isAbsolute(norm) || norm === '..' || norm.startsWith(`..${sep}`)) return undefined;
  return norm;
}

/** One extracted archive member: the source `.lib` and the member, both relative for a stable report. */
export interface LibExtraction {
  /** The `.lib` archive's path relative to `gameDir`. */
  readonly archive: string;
  /** The member's path relative to `outDir` (native separators). */
  readonly member: string;
}

/**
 * Unpacks every `.lib` archive under `gameDir`, writing each member to `outDir` under its (sanitized)
 * internal path — the documented stage-1 unpack that feeds the loose-file decoders (`.pcx`/`.bmd`/
 * `.cif` embedded in `data0001.lib`). Member names use backslash paths; {@link libMemberRelPath}
 * rewrites them to native separators and drops any that would escape `outDir`.
 *
 * A `.lib` that fails to decode is logged and skipped — a batch pipeline must not abort on one corrupt
 * archive — as is an individual member with an unsafe name (warned, not written). An output-write
 * failure (and a missing/unreadable `gameDir`) propagates: that's an environmental error, not a
 * per-file boundary failure. The whole archive is read into memory; `decodeLib` returns zero-copy
 * payload views, so members are sliced from that single buffer rather than re-read.
 */
export async function unpackLibTree(gameDir: string, outDir: string): Promise<LibExtraction[]> {
  const done: LibExtraction[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (!file.toLowerCase().endsWith('.lib')) continue;
    const archive = relative(gameDir, file);
    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await readFile(file);
    } catch (err) {
      console.warn(`[pipeline] skipped archive ${archive}: ${(err as Error).message}`);
      continue;
    }
    let files: ReturnType<typeof decodeLib>['files'];
    try {
      files = decodeLib(archiveBytes).files;
    } catch (err) {
      console.warn(`[pipeline] skipped archive ${archive}: ${(err as Error).message}`);
      continue;
    }
    for (const member of files) {
      const rel = libMemberRelPath(member.name);
      if (rel === undefined) {
        console.warn(`[pipeline] skipped unsafe member "${member.name}" in ${archive}`);
        continue;
      }
      const outPath = join(outDir, rel);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, member.data);
      done.push({ archive, member: rel });
    }
  }
  return done;
}

/** One converted picture: paths are relative to `gameDir`/`outDir` so the report is location-agnostic. */
export interface PcxConversion {
  readonly input: string;
  readonly output: string;
}

/**
 * Converts every `.pcx` under `gameDir` to a `.png` under `outDir`, mirroring the relative path.
 * Returns the conversions performed (input/output relative paths). A picture that fails to read or
 * decode is logged and skipped — a batch pipeline must not abort on one malformed/palette-less image.
 * An output-write failure (and a missing/unreadable `gameDir`) propagates instead: that's an
 * environmental error, not a per-file boundary failure, and should fail loudly rather than be lost.
 */
export async function convertPcxTree(gameDir: string, outDir: string): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (!file.toLowerCase().endsWith('.pcx')) continue;
    const input = relative(gameDir, file);
    const output = input.replace(/\.pcx$/i, '.png');
    const outPath = join(outDir, output);
    let png: Uint8Array;
    try {
      png = pcxToPng(await readFile(file));
    } catch (err) {
      console.warn(`[pipeline] skipped ${input}: ${(err as Error).message}`);
      continue;
    }
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, png);
    done.push({ input, output });
  }
  return done;
}

/**
 * Builds a case-insensitive index of the unpacked tree: `normalizeAssetPath(rel)` -> the real on-disk
 * relative path (native separators). The binding extractors lower-case + forward-slash their `.bmd`/
 * `.pcx` references, but the unpacked `.lib` members keep the archive's original (mixed) case, so a
 * direct `join(out, ref)` would miss on a case-sensitive filesystem. This map bridges the two: look a
 * normalized reference up to get the real path under `outDir`. Built once per run and shared by every
 * binding. Mirrors the `normalizeAssetPath` the extractors use (forward slashes, lower-case).
 */
async function indexOutTree(outDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for await (const file of walkFiles(outDir)) {
    const rel = relative(outDir, file);
    index.set(rel.replace(/\\/g, '/').toLowerCase(), rel);
  }
  return index;
}

/** One emitted bob atlas: the binding it came from plus the relative atlas PNG / manifest JSON paths. */
export interface BmdConversion {
  /** The body `.bmd`'s path under `outDir`, normalized (forward slashes, lower-case) — the binding key. */
  readonly bmd: string;
  /** The palette `editname` this atlas was recoloured with — the per-creature differentiator. */
  readonly paletteName: string;
  /** The atlas PNG's path relative to `outDir` (native separators). */
  readonly png: string;
  /** The atlas manifest JSON's path relative to `outDir` (native separators). */
  readonly manifest: string;
}

/**
 * Filesystem-safe slug of a palette `editname` for use as an output-filename component. Palette names
 * are already lower-cased ({@link normalizePaletteName}) and in the real data are bare identifiers like
 * `bear01`/`vik_man_base`/`test_human_00`, but a stray space or punctuation would otherwise leak into a
 * path — collapse every non-`[a-z0-9_]` run to a single `_` so the atlas name stays portable and stable.
 */
function paletteSlug(name: string): string {
  return name.replace(/[^a-z0-9_]+/g, '_');
}

/**
 * Flattens the mod's richer `[jobbasegraphics]` records ({@link JobBaseGraphicsBinding}) into the flat
 * {@link BmdPaletteBinding} shape {@link convertBmdTree} already consumes — so the human body/head bob
 * sets reuse the exact same resolve→decode→atlas path as the readable `[jobgraphics]` animals leg, with
 * no second copy of the conversion logic. A human draws from a **body** bob (coloured by
 * `gfxpalettebasebody`) plus numbered **head** bobs (coloured by `gfxpalettebasehead`), so each indexed
 * slot becomes one binding paired with the matching palette. A slot whose palette `editname` is absent
 * is dropped here (there is nothing to resolve it against — not even a name {@link convertBmdTree} could
 * warn about); the `gfxpaletterandom` tint is a per-settler runtime range, not a bob palette, so it is
 * not emitted. The `logictribe`/`logicjob` cross-refs ride along on each binding. Head bobs carry no
 * shadow `.bmd` (the extractor never sets one); body shadows are left for the later shadow-palette step,
 * exactly as the `[jobgraphics]` leg leaves `shadowBmd` unconverted today.
 */
export function jobBaseGraphicsToBindings(records: readonly JobBaseGraphicsBinding[]): BmdPaletteBinding[] {
  const bindings: BmdPaletteBinding[] = [];
  for (const rec of records) {
    for (const slot of rec.body) {
      if (rec.bodyPalette === undefined) continue;
      bindings.push({
        bmd: slot.bmd,
        shadowBmd: slot.shadowBmd,
        paletteName: rec.bodyPalette,
        tribeId: rec.tribeId,
        jobId: rec.jobId,
      });
    }
    for (const slot of rec.head) {
      if (rec.headPalette === undefined) continue;
      bindings.push({
        bmd: slot.bmd,
        shadowBmd: slot.shadowBmd,
        paletteName: rec.headPalette,
        tribeId: rec.tribeId,
        jobId: rec.jobId,
      });
    }
  }
  return bindings;
}

/**
 * Converts the body `.bmd` of every readable `[jobgraphics]` binding into a packed atlas PNG + a
 * manifest JSON, written as siblings of the `.bmd` under `outDir`. This wires the `.bmd`→palette
 * pairing graph end-to-end: {@link extractGraphicsBindings} names each `.bmd`'s palette `editname`,
 * {@link extractPaletteIndex} resolves that name to a palette `.pcx`, and the `.pcx` trailer palette
 * colours the bob frames via {@link bmdToAtlas}. Both the `.bmd` and the palette `.pcx` are read from
 * the unpacked `--out` tree (the `.lib` unpack stage extracted them there); {@link indexOutTree}
 * resolves the extractors' lower-cased references to the real (mixed-case) on-disk paths.
 *
 * Per-binding boundary failures are warned-and-skipped, never fatal — an unresolvable palette name, a
 * `.pcx`/`.bmd` missing from `--out`, a palette-less `.pcx`, or a malformed `.bmd` only drops that one
 * atlas, matching the other tree-walk stages. Each binding emits `<bmd>.<palette>.png` (the atlas sheet)
 * and `<bmd>.<palette>.atlas.json` (the per-bob frame manifest), keyed by the palette `editname`: many
 * bindings share one body `.bmd` recoloured per creature (the animals are a single geometry, the humans
 * one body re-tinted per tribe/job), so naming on the `.bmd` alone would collapse them onto one file
 * (last-palette-wins). The palette name is the only per-creature differentiator, so it goes in the
 * filename — `(bmd, palette)` now names a distinct atlas. The shadow `.bmd` is left for a later step
 * (shadows use a separate, single-colour palette path).
 */
export async function convertBmdTree(
  bindings: readonly BmdPaletteBinding[],
  palettes: readonly PaletteAlias[],
  outDir: string,
): Promise<BmdConversion[]> {
  const done: BmdConversion[] = [];
  const paletteByName = new Map<string, string>();
  for (const alias of palettes) {
    // First alias wins on a duplicate name; the real palettes.ini has none, but stay deterministic.
    if (!paletteByName.has(alias.name)) paletteByName.set(alias.name, alias.gfxFile);
  }
  const tree = await indexOutTree(outDir);
  for (const binding of bindings) {
    const pcxRel = paletteByName.get(binding.paletteName);
    if (pcxRel === undefined) {
      console.warn(`[pipeline] skipped ${binding.bmd}: unknown palette "${binding.paletteName}"`);
      continue;
    }
    const pcxOnDisk = tree.get(pcxRel);
    const bmdOnDisk = tree.get(binding.bmd);
    if (pcxOnDisk === undefined || bmdOnDisk === undefined) {
      const missing = pcxOnDisk === undefined ? `palette ${pcxRel}` : `bmd ${binding.bmd}`;
      console.warn(`[pipeline] skipped ${binding.bmd}: ${missing} not found under out`);
      continue;
    }
    let atlas: BobAtlas;
    try {
      const palette = decodePcx(await readFile(join(outDir, pcxOnDisk))).palette;
      if (palette === undefined) {
        console.warn(`[pipeline] skipped ${binding.bmd}: palette ${pcxRel} has no trailer`);
        continue;
      }
      atlas = bmdToAtlas(await readFile(join(outDir, bmdOnDisk)), palette);
    } catch (err) {
      console.warn(`[pipeline] skipped ${binding.bmd}: ${(err as Error).message}`);
      continue;
    }
    if (!/\.bmd$/i.test(bmdOnDisk)) {
      // A `.bmd`-less name would make the output paths collide with the source — skip rather than
      // clobber the input bytes. The extractor only emits `gfxbobmanagerbody` `.bmd` paths, so this is
      // a defensive guard, not an expected case.
      console.warn(`[pipeline] skipped ${binding.bmd}: source has no .bmd extension`);
      continue;
    }
    // Name on (bmd, palette), not the .bmd alone: many bindings share one body bob recoloured per
    // creature, so `<bmd>.png` would collapse them last-palette-wins. The palette editname is the only
    // per-creature differentiator, so it rides in the filename — `<bmd-stem>.<palette>.png`.
    const suffix = paletteSlug(binding.paletteName);
    const pngRel = bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.png`);
    const manifestRel = bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.atlas.json`);
    await writeFile(join(outDir, pngRel), encodePng(atlas.image));
    await writeFile(join(outDir, manifestRel), `${JSON.stringify(atlas.manifest, null, 2)}\n`);
    done.push({ bmd: binding.bmd, paletteName: binding.paletteName, png: pngRel, manifest: manifestRel });
  }
  return done;
}

/**
 * One readable `.ini` rule source to parse, with where it came from (`base` = `Data/logic`,
 * `mod` = `DataCnmd`). The extractor selects which `[section]`s it cares about, so a file with no
 * matching sections contributes nothing rather than erroring.
 */
export interface IniSource {
  /** Absolute path of the `.ini` file to read. */
  readonly path: string;
  /** Path stamped onto each record's `source.file` — relative so the IR is location-agnostic. */
  readonly file: string;
  readonly layer: 'base' | 'mod';
}

/**
 * Resolves the readable `.ini` sources for the type tables we can extract today, **preferring the
 * mod's readable `.ini` over the base game** (CLAUDE.md golden rule #4): tribes + atomic animations +
 * weapons + buildings live only under `DataCnmd/types/` (the base game's twins are encrypted `.cif`),
 * while goods/jobs/landscape are base `Data/logic/*.ini`. A source whose file is missing on disk is
 * dropped with a warning — a partial install (or no mod) still produces an IR from whatever is present,
 * rather than aborting the whole batch.
 */
export async function resolveIniSources(gameDir: string, mod: string | undefined): Promise<IniSource[]> {
  const base: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: join('Data', 'logic', 'goodtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'jobtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'landscapetypes.ini'), layer: 'base' },
  ];
  if (mod !== undefined) {
    base.push(
      { rel: join(mod, 'tribetypes12', 'tribetypes.ini'), layer: 'mod' },
      { rel: join(mod, 'atomicanimations12', 'atomicanimations.ini'), layer: 'mod' },
      { rel: join(mod, 'types', 'weapons.ini'), layer: 'mod' },
      { rel: join(mod, 'types', 'houses.ini'), layer: 'mod' },
    );
  }
  const sources: IniSource[] = [];
  for (const { rel, layer } of base) {
    const path = join(gameDir, rel);
    try {
      await access(path);
    } catch {
      console.warn(`[pipeline] ini source not found, skipping: ${rel}`);
      continue;
    }
    sources.push({ path, file: rel, layer });
  }
  return sources;
}

/**
 * Slugs a map's containing-folder name into its {@link MapInfo} `id`: lower-cased, non-alphanumerics
 * collapsed to `_`. Maps live one-per-folder (`CnModMaps/<name>/map.cif`), and the `.cif` logic header
 * carries no human-readable id, so the folder name is the stable cross-reference key. Mirrors the `slug`
 * the `.ini` extractors use for type ids.
 */
export function mapIdFromPath(mapCifRelPath: string): string {
  const folder = dirname(mapCifRelPath).split(/[\\/]/).pop() ?? mapCifRelPath;
  return folder
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Decodes the logic header of every `map.cif` under `gameDir` into a validated {@link MapInfo}, in a
 * stable order (the maps are sorted by their relative path so the IR is reproducible regardless of
 * directory-entry order). Each map's `id` comes from its containing folder ({@link mapIdFromPath}).
 * A `.cif` that fails to read or decode (not a map, missing `mapsize`/`mapguid`, corrupt container) is
 * logged and skipped — a batch over many maps must not abort on one bad file, matching the other
 * tree-walk stages. Only the declarative header metadata is extracted; the binary tile grid and the
 * `MissionData`/`StaticObjects` scripting are out of scope here (see {@link extractMapInfo}).
 */
export async function decodeMapTree(gameDir: string): Promise<MapInfo[]> {
  const found: string[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (file.toLowerCase().endsWith(`${sep}map.cif`) || file.toLowerCase().endsWith('/map.cif')) {
      found.push(relative(gameDir, file));
    }
  }
  found.sort();
  const maps: MapInfo[] = [];
  for (const rel of found) {
    try {
      const bytes = await readFile(join(gameDir, rel));
      maps.push(mapCifToInfo(bytes, mapIdFromPath(rel), { file: rel, layer: 'base' }));
    } catch (err) {
      console.warn(`[pipeline] skipped map ${rel}: ${(err as Error).message}`);
    }
  }
  return maps;
}

/** One emitted map terrain artifact: its slug id + the relative `maps/<id>.json` path under `outDir`. */
export interface MapDatConversion {
  /** The map's slug id ({@link mapIdFromPath}) — the same key as its `map.cif` {@link MapInfo}. */
  readonly id: string;
  /** Grid width/height (cells = width × height) — surfaced so a batch can report sane dims. */
  readonly width: number;
  readonly height: number;
  /** The terrain JSON's path relative to `outDir` (native separators). */
  readonly output: string;
}

/**
 * Decodes every `map.dat` under `gameDir` into a per-cell landscape-typeId grid (the sim's
 * `TerrainMap` shape) and writes it to `<outDir>/maps/<id>.json` — closing the
 * `map.dat` → `lmltToTerrainMap` → `buildTerrainGraph` chain into the pipeline so the sim loads a real
 * map's grid instead of a synthetic scenario one. Each map's `id` comes from its containing folder
 * ({@link mapIdFromPath}), so the artifact joins onto the same-folder `map.cif`'s {@link MapInfo} `id`.
 * Maps are visited in a stable (path-sorted) order so a re-run is reproducible.
 *
 * A `map.dat` that fails to read or decode (not a container, missing `lsiz`/`lmlt`, an `X6el`-only
 * grid, a dims/length mismatch, corrupt RLE) is logged and skipped — a batch over many maps must not
 * abort on one bad file, matching the other tree-walk stages. An output-write failure (and a missing
 * `gameDir`) propagates: that's an environmental error, not a per-file boundary failure.
 *
 * KNOWN: ids collapse on the folder name, so two maps in same-named folders under different roots
 * (e.g. `Data/maps/oasis_o_plenty` vs `CnModMaps/oasis_o_plenty`) write the same `<id>.json`
 * last-write-wins (on the real game, 130 `map.dat` → 125 files). This is *deliberately* the same
 * `mapIdFromPath` collapse {@link decodeMapTree} applies to `map.cif`, so the terrain artifact and its
 * `MapInfo` agree on the id and stay joinable — a path-scoped unique id would have to change both legs
 * together. (A localization sub-folder like `WICHRY_ZIMY/text/map.dat` likewise slugs to `text`; that
 * too matches the existing `map.cif` behavior.)
 */
export async function convertMapDatTree(gameDir: string, outDir: string): Promise<MapDatConversion[]> {
  const found: string[] = [];
  for await (const file of walkFiles(gameDir)) {
    const lower = file.toLowerCase();
    if (lower.endsWith(`${sep}map.dat`) || lower.endsWith('/map.dat')) {
      found.push(relative(gameDir, file));
    }
  }
  found.sort();
  const done: MapDatConversion[] = [];
  for (const rel of found) {
    const id = mapIdFromPath(rel);
    let terrain: MapDatTerrainMap;
    try {
      terrain = mapDatToTerrain(await readFile(join(gameDir, rel)));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${(err as Error).message}`);
      continue;
    }
    const output = join('maps', `${id}.json`);
    const outPath = join(outDir, output);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(terrain, null, 2)}\n`);
    done.push({ id, width: terrain.width, height: terrain.height, output });
  }
  return done;
}

/**
 * Reads + parses every resolved `.ini` source and runs the typed extractors, then assembles and
 * **validates** a {@link ContentSet} via `parseContentSet` (zod + cross-reference checks). Decoding
 * stays pure (`decodeIni`/`parseIniSections`/`extract*` take bytes/text, not the filesystem); the
 * only I/O here is reading the resolved files. Each extractor pulls only its own `[section]`s from a
 * file, so passing every file's sections to every extractor is correct and order-independent.
 *
 * `animals`/`vehicles` are left empty until their extractors land — the schema defaults cover those
 * optional arrays.
 */
export async function buildIr(args: Args): Promise<ContentSet> {
  const sources = await resolveIniSources(args.game, args.mod);
  const goods = [];
  const jobs = [];
  const buildings = [];
  const landscape = [];
  const tribes = [];
  const atomicAnimations = [];
  const weapons = [];
  for (const { path, file, layer } of sources) {
    const sections = parseIniSections(decodeIni(await readFile(path)));
    const src: SourceRef = { file, layer };
    goods.push(...extractGoods(sections, src));
    jobs.push(...extractJobs(sections, src));
    buildings.push(...extractBuildings(sections, src));
    landscape.push(...extractLandscape(sections, src));
    tribes.push(...extractTribes(sections, src));
    atomicAnimations.push(...extractAtomicAnimations(sections, src));
    weapons.push(...extractWeapons(sections, src));
  }
  const maps = await decodeMapTree(args.game);
  // Output-side recipe join: a workplace's `produces` output good -> that good's `productionInputs`
  // materializes each producing building's `recipe` (cross-table, so after both tables are built).
  const buildingsWithRecipes = fillBuildingRecipes(buildings, goods);
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: args.game, mod: args.mod },
    },
    goods,
    jobs,
    buildings: buildingsWithRecipes,
    weapons,
    landscape,
    tribes,
    atomicAnimations,
    maps,
  });
}

/**
 * Builds the validated IR and writes it to `<out>/ir.json` (pretty-printed for diff-legibility).
 * Returns the assembled set so the caller can report record counts. The write target lives under the
 * gitignored `content/` — no copyrighted bytes enter the repo source.
 */
async function writeIr(args: Args): Promise<ContentSet> {
  const set = await buildIr(args);
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'ir.json'), `${JSON.stringify(set, null, 2)}\n`);
  return set;
}

/**
 * Reads the graphics-binding sources and extracts the `.bmd`→palette pairing from every binding skin:
 *
 *  - the base `Data/engine2d/inis/animals/jobgraphics.ini` `[jobgraphics]` records (the one animals
 *    binding file shipped as plain `.ini`);
 *  - the base `Data/engine2d/inis/vehicles/jobgraphics.cif` `[jobgraphics]` records (carts/ships) — the
 *    **same flat grammar** as the animals `.ini` (`gfxbobmanagerbody`/`gfxpalettebody`), differing only
 *    in the cross-ref key (`logicvehicle` instead of `logicjob`, which is simply left `undefined`), so it
 *    reuses {@link extractGraphicsBindings} verbatim; it ships *only* as encrypted `.cif`;
 *  - the base `Data/engine2d/inis/humans/jobgraphics.cif` `[jobbasegraphics]` (base appearance) **and**
 *    `[jobchangegraphics]` (per-job equipment skin) records — the **base-game human body/head bob
 *    sets**, which ship *only* as encrypted `.cif` (no readable `.ini` twin, so this is the `.cif`-only
 *    graphics binding leg), decoded via {@link decodeCifStringArray} → {@link cifLinesToSections} into
 *    the same {@link RuleSection} model the `.ini` parser yields;
 *  - and, when a `--mod` is given, the mod's `<mod>/types/humanstype/jobgraphics.ini`
 *    `[jobbasegraphics]` + `[jobchangegraphics]` records (the readable mod human skin, golden rule #4 —
 *    overlays the base-game humans above).
 *
 * Both the base-appearance (`[jobbasegraphics]`) and equipment-skin (`[jobchangegraphics]`) layers share
 * the same grammar, so all four sources flatten via {@link jobBaseGraphicsToBindings} into the same flat
 * shape as the `[jobgraphics]` animals. The palette index comes from
 * `Data/engine2d/inis/palettes/palettes.ini`. The `.ini` sources are decoded as CP1250 (display names
 * carry Polish glyphs) via {@link decodeIni}, like every other rule source; the `.cif` text is latin1
 * (structural keywords are ASCII). A missing/corrupt file contributes nothing (with a warning) — a
 * partial install (or no mod) still runs the rest of the pipeline rather than aborting.
 *
 * Returns the merged bindings + the `palettes.ini` name→`.pcx` index, ready to hand to
 * {@link convertBmdTree}. The goods graphics table (`goods/goodgraphics.cif`) is intentionally *not*
 * read here: its `[goodgraphics]` records carry only a `graphicshumanrandompalette` runtime-tint name
 * and **no `gfxbobmanagerbody`** — there is no bob set to colour into an atlas, so it contributes zero
 * bindings (the carried-good sprites live in the human/vehicle bob sheets, tinted at runtime).
 */
export async function resolveGraphicsBindings(
  gameDir: string,
  mod: string | undefined,
): Promise<{ bindings: BmdPaletteBinding[]; palettes: PaletteAlias[] }> {
  const readIni = async (rel: string): Promise<RuleSection[] | undefined> => {
    const path = join(gameDir, rel);
    try {
      return parseIniSections(decodeIni(await readFile(path)));
    } catch {
      console.warn(`[pipeline] graphics binding source not found, skipping: ${rel}`);
      return undefined;
    }
  };
  const readCif = async (rel: string): Promise<RuleSection[] | undefined> => {
    const path = join(gameDir, rel);
    try {
      return cifLinesToSections(decodeCifStringArray(await readFile(path)).lines);
    } catch {
      console.warn(`[pipeline] graphics binding source not found or corrupt, skipping: ${rel}`);
      return undefined;
    }
  };
  const jobgraphics = await readIni(join('Data', 'engine2d', 'inis', 'animals', 'jobgraphics.ini'));
  const vehiclesCif = await readCif(join('Data', 'engine2d', 'inis', 'vehicles', 'jobgraphics.cif'));
  const humansCif = await readCif(join('Data', 'engine2d', 'inis', 'humans', 'jobgraphics.cif'));
  const palettesIni = await readIni(join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini'));
  const bindings: BmdPaletteBinding[] = jobgraphics ? extractGraphicsBindings(jobgraphics) : [];
  // Vehicles use the identical flat [jobgraphics] grammar as the animals .ini (carts/ships), so the
  // same extractor applies; only the cross-ref differs (logicvehicle, left undefined as jobId).
  if (vehiclesCif) bindings.push(...extractGraphicsBindings(vehiclesCif));
  if (humansCif) {
    // The base humans .cif carries both layers: [jobbasegraphics] (base appearance) and
    // [jobchangegraphics] (per-job equipment skins). Both flatten through the same path.
    bindings.push(...jobBaseGraphicsToBindings(extractJobBaseGraphics(humansCif)));
    bindings.push(...jobBaseGraphicsToBindings(extractJobChangeGraphics(humansCif)));
  }
  if (mod !== undefined) {
    const humanGraphics = await readIni(join(mod, 'types', 'humanstype', 'jobgraphics.ini'));
    if (humanGraphics) {
      bindings.push(...jobBaseGraphicsToBindings(extractJobBaseGraphics(humanGraphics)));
      bindings.push(...jobBaseGraphicsToBindings(extractJobChangeGraphics(humanGraphics)));
    }
  }
  return {
    bindings,
    palettes: palettesIni ? extractPaletteIndex(palettesIni) : [],
  };
}

async function run(args: Args): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stage order (see docs/SOURCES.md). Prefer the mod's readable .ini sources over base .cif.
  // > 1. Unpack .lib archives                  -> decoders/lib.ts (this stage)
  //   2. Decode palettes + .hlt remap tables   -> ref CPalette.cs, CRemapTable.cs (TODO)
  // > 3. Decode .pcx pictures -> PNG            -> decoders/pcx.ts + png.ts  (this stage)
  // > 4. Decode .bmd bobs -> atlas + anim JSON  -> decoders/bmd.ts + atlas.ts (this stage; readable bindings)
  // > 5. Parse .ini rules -> typed IR           -> decoders/ini.ts (this stage; mod .ini preferred)
  // > 6. Decode map logic headers -> map IR     -> decoders/cif.ts + ini.ts (this stage; metadata only)
  // > 7. Write content/ir.json + validate with parseContentSet()  (this stage)
  // > 8. Decode map.dat terrain grids -> maps/  -> decoders/mapdat.ts (this stage; the nav-graph grid)
  //
  // The unpack extracts loose copies of the embedded .pcx/.bmd/.cif into <out> (gitignored).
  const extracted = await unpackLibTree(args.game, args.out);
  console.log(`[pipeline] lib unpack: extracted ${extracted.length} member(s) into ${args.out}`);

  // Convert .pcx -> .png from BOTH trees: the original --game tree (loose pictures shipped as files)
  // mirrored into <out>, and the unpacked <out> tree itself (the .pcx the unpack stage just extracted
  // from data0001.lib, converted in place to a .png sibling). The two roots are disjoint sources, so a
  // picture is converted exactly once per location it exists; <game>==<out> is not a supported invocation.
  const loosePictures = await convertPcxTree(args.game, args.out);
  const embeddedPictures = await convertPcxTree(args.out, args.out);
  const pictures = loosePictures.length + embeddedPictures.length;
  console.log(
    `[pipeline] pcx -> png: converted ${pictures} picture(s) into ${args.out} ` +
      `(${loosePictures.length} loose, ${embeddedPictures.length} embedded)`,
  );

  // Convert .bmd bob sets -> atlas PNG + manifest JSON for every binding: the base animals
  // [jobgraphics] records, the base vehicles/jobgraphics.cif [jobgraphics] cart/ship records, the base
  // humans/jobgraphics.cif [jobbasegraphics] base-appearance + [jobchangegraphics] equipment-skin
  // records (the .cif-only legs), plus, with a --mod, the mod's [jobbasegraphics]/[jobchangegraphics]
  // human body/head bobs. Each binding
  // names its palette by editname; palettes.ini resolves it to a .pcx, whose trailer palette colours
  // the bobs. Both the .bmd and the .pcx are read from the just-unpacked <out> tree.
  const { bindings, palettes } = await resolveGraphicsBindings(args.game, args.mod);
  const atlases = await convertBmdTree(bindings, palettes, args.out);
  // Atlases are now named per (bmd, palette), so each per-creature recolour is its own file rather than
  // collapsing onto one body bob last-palette-wins. Report both the distinct atlas files and the distinct
  // body .bmd geometries behind them — the gap is the per-creature recolour fan-out.
  const distinct = new Set(atlases.map((a) => a.png)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  const ir = await writeIr(args);
  console.log(
    `[pipeline] ini -> ir: ${ir.goods.length} goods, ${ir.jobs.length} jobs, ${ir.buildings.length} buildings, ` +
      `${ir.weapons.length} weapons, ${ir.landscape.length} landscape, ${ir.tribes.length} tribes, ` +
      `${ir.atomicAnimations.length} atomic animations, ${ir.maps.length} maps -> ${join(args.out, 'ir.json')}`,
  );

  // Decode each map's binary terrain grid (map.dat hoix container -> lmlt landscape-type layer -> one
  // per-cell typeId) into maps/<id>.json — the TerrainMap the sim's buildTerrainGraph consumes, so the
  // sim loads a real map's grid instead of a synthetic scenario one. Joins onto the same-folder
  // map.cif's MapInfo id.
  const terrains = await convertMapDatTree(args.game, args.out);
  const totalCells = terrains.reduce((sum, t) => sum + t.width * t.height, 0);
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total) into ${join(args.out, 'maps')}`,
  );
}

// Auto-run only when invoked as the entry point (node src/cli.ts / the dist bin), not when a test
// imports this module for parseArgs/pcxToPng/convertPcxTree.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Resolve relative --game/--out against where `npm run` was invoked (repo root), not the workspace
  // package dir npm sets as cwd — see resolveArgs. Fall back to cwd for a bare `node dist/cli.js`.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  run(resolveArgs(parseArgs(process.argv.slice(2)), baseDir)).catch((err: unknown) => {
    console.error('[pipeline] failed:', err);
    process.exitCode = 1;
  });
}
