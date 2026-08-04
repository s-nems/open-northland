import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { decodePcx, expandToRgba } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import type { StageItemReporter } from '../progress.js';
import { collectSourceFiles, type SourceRoots } from '../roots.js';
import { servedRelPath, TEXTURES_DIR } from './content-tree.js';
import { readSourceFile } from './source-files.js';

/** A transition overlay's two source pictures: the RGB texture + its separate alpha-mask `.pcx`. */
export interface MaskedTexturePair {
  /** Normalized `data/.../tran_*.pcx` path of the RGB texture (relative to the game root). */
  readonly texture: string;
  /** Normalized `data/.../tran_*_a.pcx` path of the alpha mask (relative to the game root). */
  readonly textureAlpha: string;
}

/**
 * `.pcx` bytes to `.png` bytes. Throws a `pcx:`/`png:`-prefixed error for a malformed or palette-less
 * picture.
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
 * Composes each transition overlay's RGB texture and alpha-mask `.pcx` pair into one RGBA
 * `<stem>.masked.png` under {@link TEXTURES_DIR}. The mask picture's raw palette-index byte is the
 * coverage value and becomes the alpha channel directly (format oracle in docs/SOURCES.md).
 *
 * Sources resolve by basename under the real-cased {@link TEXTURES_DIR} because the IR's normalized
 * paths are lowercased; every real `[transition]` record lives in that one directory. Pairs are deduped
 * by texture path, and a missing or undecodable picture is logged and skipped.
 */
export async function composeMaskedTransitionPages(
  roots: SourceRoots,
  outDir: string,
  pairs: readonly MaskedTexturePair[],
): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  const seen = new Set<string>();
  const readTexturePcx = (normalizedPath: string): Promise<Uint8Array> =>
    readSourceFile(roots, join(TEXTURES_DIR, basename(normalizedPath)));
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
 * Converts every `.pcx` under the source `roots` to a `.png` under `outDir`, one per relative path
 * (decoded from the layer that wins it) and canonicalized for the served subtrees
 * ({@link servedRelPath}). A picture that fails to read or decode is logged and skipped; an output-write
 * failure or an unreadable game root propagates as an environmental error.
 */
export async function convertPcxTree(
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  for (const { rel: input, path } of await collectSourceFiles(roots, (rel) => rel.endsWith('.pcx'))) {
    const output = servedRelPath(input.replace(/\.pcx$/i, '.png'));
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
