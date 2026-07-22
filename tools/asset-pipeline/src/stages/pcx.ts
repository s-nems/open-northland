import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { decodePcx, expandToRgba } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import type { StageItemReporter } from '../progress.js';
import { archiveRoots, collectSourceFiles, type SourceRoots } from '../roots.js';
import { TEXTURES_DIR } from './content-tree.js';
import { readSourceFile } from './source-files.js';

/** A transition overlay's two source pictures: the RGB texture + its separate alpha-mask `.pcx`. */
export interface MaskedTexturePair {
  /** Normalized `data/.../tran_*.pcx` path of the RGB texture (relative to the game root). */
  readonly texture: string;
  /** Normalized `data/.../tran_*_a.pcx` path of the alpha mask (relative to the game root). */
  readonly textureAlpha: string;
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

/** One converted picture: paths are relative to `gameDir`/`outDir` so the report is location-agnostic. */
export interface PcxConversion {
  readonly input: string;
  readonly output: string;
}

/**
 * Composes each transition overlay's RGB texture + alpha-mask `.pcx` pair into one RGBA
 * `<stem>.masked.png` under {@link TEXTURES_DIR} (the `/textures/` serving contract). The mask's
 * raw palette-index bytes become the alpha channel directly (the engine's convention — the mask
 * picture's index is the coverage value; format oracle in docs/SOURCES.md), which the plain
 * palette-expanding conversion cannot represent.
 *
 * Sources resolve by basename under the real-cased {@link TEXTURES_DIR} — the IR's normalized
 * paths are lowercased, so joining them verbatim would miss on a case-sensitive filesystem; every
 * real `[transition]` record lives in that one directory, and a record pointing elsewhere degrades
 * to the warn-and-skip below. The source `roots` are tried first (loose files, overlay-first), then
 * `outDir` (pictures the lib unpack extracted). Pairs are deduped by texture path (several records
 * share one page); a missing/undecodable picture is logged and skipped like {@link convertPcxTree}'s
 * per-file boundary.
 */
export async function composeMaskedTransitionPages(
  roots: SourceRoots,
  outDir: string,
  pairs: readonly MaskedTexturePair[],
): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  const seen = new Set<string>();
  const readTexturePcx = async (normalizedPath: string): Promise<Uint8Array> => {
    const rel = join(TEXTURES_DIR, basename(normalizedPath));
    try {
      return await readSourceFile(roots, rel);
    } catch {
      return await readSourceFile(archiveRoots(outDir), rel);
    }
  };
  for (const pair of pairs) {
    if (seen.has(pair.texture)) continue;
    seen.add(pair.texture);
    const outputName = basename(pair.texture).replace(/\.pcx$/i, '.masked.png');
    const output = join(TEXTURES_DIR, outputName);
    try {
      const colour = expandToRgba(decodePcx(await readTexturePcx(pair.texture)));
      const mask = decodePcx(await readTexturePcx(pair.textureAlpha));
      if (mask.width !== colour.width || mask.height !== colour.height) {
        throw new Error(
          `mask ${pair.textureAlpha} is ${mask.width}×${mask.height}, texture is ${colour.width}×${colour.height}`,
        );
      }
      for (let i = 0; i < mask.pixels.length; i++) {
        colour.rgba[4 * i + 3] = mask.pixels[i] ?? 0;
      }
      const outPath = join(outDir, output);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, encodePng(colour));
      done.push({ input: pair.texture, output });
    } catch (err) {
      console.warn(`[pipeline] skipped masked page ${pair.texture}: ${errorMessage(err)}`);
    }
  }
  return done;
}

/**
 * Converts every `.pcx` under the source `roots` (overlay-first union) to a `.png` under `outDir`,
 * mirroring the relative path. Returns the conversions performed (input/output relative paths). A
 * picture that fails to read or decode is logged and skipped — a batch pipeline must not abort on one
 * malformed/palette-less image. An output-write failure (and a missing/unreadable game root)
 * propagates instead: that's an environmental error, not a per-file boundary failure, and should
 * fail loudly rather than be lost.
 */
export async function convertPcxTree(
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  for (const { rel: input, path } of await collectSourceFiles(roots, (rel) => rel.endsWith('.pcx'))) {
    const output = input.replace(/\.pcx$/i, '.png');
    const outPath = join(outDir, output);
    let png: Uint8Array;
    try {
      png = pcxToPng(await readFile(path));
    } catch (err) {
      console.warn(`[pipeline] skipped ${input}: ${errorMessage(err)}`);
      continue;
    }
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, png);
    done.push({ input, output });
    onItem?.(done.length);
  }
  return done;
}
