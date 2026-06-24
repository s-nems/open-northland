#!/usr/bin/env node
/**
 * Asset pipeline CLI — offline conversion of an OWNED original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
 *
 * This is run by a human/agent, not shipped. It writes NO copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 *
 * Phase 1 lands the stages one decoder at a time. Implemented now: `.pcx` pictures -> PNG (the
 * loose-file pass — `.lib`-embedded pictures arrive once the unpack stage feeds this) and readable
 * `.ini` rules -> a validated `content/ir.json` (goods/jobs/landscape from base `Data/logic`, tribes +
 * atomic animations from the mod's `DataCnmd`, preferring the mod per CLAUDE.md). The remaining stages
 * (palettes, `.bmd` bobs, `.cif`-only type tables, maps) are still TODO; see docs/ROADMAP.md.
 */

import { realpathSync } from 'node:fs';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import {
  type SourceRef,
  decodeIni,
  extractAtomicAnimations,
  extractGoods,
  extractJobs,
  extractLandscape,
  extractTribes,
  parseIniSections,
} from './decoders/ini.js';
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

/** Recursively yields every regular file under `dir` (absolute paths), in directory-entry order. */
async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
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
 * mod's readable `.ini` over the base game** (CLAUDE.md golden rule #4): tribes + atomic animations
 * live only under `DataCnmd/`, while goods/jobs/landscape are base `Data/logic/*.ini`. A source whose
 * file is missing on disk is dropped with a warning — a partial install (or no mod) still produces an
 * IR from whatever is present, rather than aborting the whole batch. Buildings/weapons have no
 * extractor yet (the mod ships them as `DataCnmd/types/*`), so the IR's `buildings` stays empty until
 * those decoders land; see docs/ROADMAP.md Phase 1.
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
 * Reads + parses every resolved `.ini` source and runs the typed extractors, then assembles and
 * **validates** a {@link ContentSet} via `parseContentSet` (zod + cross-reference checks). Decoding
 * stays pure (`decodeIni`/`parseIniSections`/`extract*` take bytes/text, not the filesystem); the
 * only I/O here is reading the resolved files. Each extractor pulls only its own `[section]`s from a
 * file, so passing every file's sections to every extractor is correct and order-independent.
 *
 * `buildings`/`weapons`/`animals`/`vehicles` are left empty until their extractors land — the schema
 * defaults cover the optional arrays, and `buildings` (required) is explicitly empty for now.
 */
export async function buildIr(args: Args): Promise<ContentSet> {
  const sources = await resolveIniSources(args.game, args.mod);
  const goods = [];
  const jobs = [];
  const landscape = [];
  const tribes = [];
  const atomicAnimations = [];
  for (const { path, file, layer } of sources) {
    const sections = parseIniSections(decodeIni(await readFile(path)));
    const src: SourceRef = { file, layer };
    goods.push(...extractGoods(sections, src));
    jobs.push(...extractJobs(sections, src));
    landscape.push(...extractLandscape(sections, src));
    tribes.push(...extractTribes(sections, src));
    atomicAnimations.push(...extractAtomicAnimations(sections, src));
  }
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: args.game, mod: args.mod },
    },
    goods,
    jobs,
    buildings: [],
    landscape,
    tribes,
    atomicAnimations,
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

async function run(args: Args): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stage order (see docs/SOURCES.md). Prefer the mod's readable .ini sources over base .cif.
  //   1. Unpack .lib archives                  -> decoders/lib.ts (done; wiring pending)
  //   2. Decode palettes + .hlt remap tables   -> ref CPalette.cs, CRemapTable.cs (TODO)
  // > 3. Decode .pcx pictures -> PNG            -> decoders/pcx.ts + png.ts  (this stage)
  //   4. Decode .bmd bobs -> atlas + anim JSON  -> ref CBobManager.cs, CBitmap.cs (hardest, TODO)
  // > 5. Parse .ini rules -> typed IR           -> decoders/ini.ts (this stage; mod .ini preferred)
  //   6. Decode one map -> map IR               -> decoders/cif.ts (done; wiring pending)
  // > 7. Write content/ir.json + validate with parseContentSet()  (this stage)
  const pictures = await convertPcxTree(args.game, args.out);
  console.log(`[pipeline] pcx -> png: converted ${pictures.length} picture(s) into ${args.out}`);

  const ir = await writeIr(args);
  console.log(
    `[pipeline] ini -> ir: ${ir.goods.length} goods, ${ir.jobs.length} jobs, ` +
      `${ir.landscape.length} landscape, ${ir.tribes.length} tribes, ` +
      `${ir.atomicAnimations.length} atomic animations -> ${join(args.out, 'ir.json')}`,
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
