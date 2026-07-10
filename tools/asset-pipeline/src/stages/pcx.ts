import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { decodePcx, expandToRgba } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { walkFiles } from '../walk.js';

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
 * Composes each transition overlay's RGB texture + alpha-mask `.pcx` pair into ONE RGBA
 * `<stem>.masked.png` beside the plain conversion under `outDir`. The mask's RAW palette-index
 * bytes become the alpha channel directly (the engine's convention — the mask picture's index IS
 * the coverage value; format oracle in docs/SOURCES.md), which the plain palette-expanding
 * conversion cannot represent. Pairs are deduped by texture path (several `[transition]` records
 * share one page); a missing/undecodable picture is logged and skipped like {@link convertPcxTree}'s
 * per-file boundary. Sources resolve against `gameDir` first (loose files), then `outDir` (pictures
 * the lib unpack extracted).
 */
export async function composeMaskedTransitionPages(
  gameDir: string,
  outDir: string,
  pairs: readonly MaskedTexturePair[],
): Promise<PcxConversion[]> {
  const done: PcxConversion[] = [];
  const seen = new Set<string>();
  const readPcx = async (rel: string): Promise<Uint8Array> => {
    try {
      return await readFile(join(gameDir, rel));
    } catch {
      return await readFile(join(outDir, rel));
    }
  };
  for (const pair of pairs) {
    if (seen.has(pair.texture)) continue;
    seen.add(pair.texture);
    const output = pair.texture.replace(/\.pcx$/i, '.masked.png');
    try {
      const colour = expandToRgba(decodePcx(await readPcx(pair.texture)));
      const mask = decodePcx(await readPcx(pair.textureAlpha));
      if (mask.width !== colour.width || mask.height !== colour.height) {
        throw new Error(
          `mask ${pair.textureAlpha} is ${mask.width}×${mask.height}, texture is ${colour.width}×${colour.height}`,
        );
      }
      for (let i = 0; i < mask.pixels.length; i++) {
        colour.rgba[4 * i + 3] = mask.pixels[i] as number;
      }
      const outPath = join(outDir, output);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, encodePng(colour));
      done.push({ input: pair.texture, output });
    } catch (err) {
      console.warn(`[pipeline] skipped masked page ${pair.texture}: ${(err as Error).message}`);
    }
  }
  return done;
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
