/**
 * Asset pipeline CLI — offline conversion of an OWNED original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
 *
 * This is run by a human/agent, not shipped. It writes NO copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 *
 * Phase 1 lands the stages one decoder at a time. Implemented now: `.pcx` pictures -> PNG (the
 * loose-file pass — `.lib`-embedded pictures arrive once the unpack stage feeds this). The remaining
 * stages (palettes, `.bmd` bobs, `.ini`/`.cif` rules, maps) are still TODO; see docs/ROADMAP.md.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
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
 * Returns the conversions performed (input/output relative paths). A per-file decode/encode failure
 * is logged and skipped — a batch pipeline must not abort on one malformed or palette-less picture.
 * A missing/unreadable `gameDir` throws (a real argument error, not a per-file boundary failure).
 */
export async function convertPcxTree(gameDir: string, outDir: string): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (!file.toLowerCase().endsWith('.pcx')) continue;
    const input = relative(gameDir, file);
    const output = input.replace(/\.pcx$/i, '.png');
    const outPath = join(outDir, output);
    try {
      const png = pcxToPng(await readFile(file));
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, png);
      done.push({ input, output });
    } catch (err) {
      console.warn(`[pipeline] skipped ${input}: ${(err as Error).message}`);
    }
  }
  return done;
}

async function run(args: Args): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stage order (see docs/SOURCES.md). Prefer the mod's readable .ini sources over base .cif.
  //   1. Unpack .lib archives                  -> decoders/lib.ts (done; wiring pending)
  //   2. Decode palettes + .hlt remap tables   -> ref CPalette.cs, CRemapTable.cs (TODO)
  // > 3. Decode .pcx pictures -> PNG            -> decoders/pcx.ts + png.ts  (this stage)
  //   4. Decode .bmd bobs -> atlas + anim JSON  -> ref CBobManager.cs, CBitmap.cs (hardest, TODO)
  //   5. Parse .ini rules -> typed IR           -> decoders/ini.ts (extractors done; wiring pending)
  //   6. Decode one map -> map IR               -> decoders/cif.ts (done; wiring pending)
  //   7. Write content/ir.json + validate with parseContentSet()
  const pictures = await convertPcxTree(args.game, args.out);
  console.log(`[pipeline] pcx -> png: converted ${pictures.length} picture(s) into ${args.out}`);
}

// Auto-run only when invoked as the entry point (node src/cli.ts / the dist bin), not when a test
// imports this module for parseArgs/pcxToPng/convertPcxTree.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
    console.error('[pipeline] failed:', err);
    process.exitCode = 1;
  });
}
