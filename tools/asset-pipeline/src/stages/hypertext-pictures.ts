import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HypertextPicture } from '@open-northland/data';
import { type IncludeResolver, type PictureResolver, renderHypertext } from '../decoders/hypertext.js';
import { assertPaletteBytes, paletteToRgba } from '../decoders/image.js';
import { decodePcx } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import { writeFileWithParents } from '../files.js';
import { HYPERTEXT_PICTURES_DIR } from './gui/paths.js';

/** The dir a page's `$local$\graphics\<file>` argument resolves against, beside its text files. */
export const HYPERTEXT_GRAPHICS_DIR = 'graphics';
/** Pictures are content-addressed: the corpus repeats the same portraits across map folders and
 *  languages, so equal bytes converge on one file name. */
const NAME_DIGEST_CHARS = 16;
/** Observation over the corpus: a page picture surrounds its subject with palette index 0, whose
 *  entry is the key colour (magenta or blue), so that index draws as nothing. */
const COLOR_KEY_INDEX = 0;

/** Locates one picture by its lower-cased file name, in whatever folder layout the caller reads. */
export type PictureLookup = (name: string) => Promise<string | undefined>;

/**
 * Emits every picture `pages` names into `content/gui/hypertext/` and returns the resolver a second
 * render looks them up through; the first render collects the names through the same includes. An
 * absent or undecodable picture warns and is left out, so its page renders without it.
 */
export async function resolvePagePictures(
  outDir: string,
  find: PictureLookup,
  pages: Iterable<string>,
  include: IncludeResolver,
  label: string,
): Promise<PictureResolver> {
  const wanted = new Set<string>();
  const collect: PictureResolver = (name) => {
    wanted.add(name);
    return undefined;
  };
  for (const page of pages) renderHypertext(page, { include, picture: collect });
  const pictures = new Map<string, HypertextPicture>();
  for (const name of wanted) {
    const path = await find(name);
    if (path === undefined) {
      console.warn(`[pipeline] ${label}: picture ${name} not found`);
      continue;
    }
    try {
      pictures.set(name, await emitPicture(outDir, await readFile(path)));
    } catch (err) {
      console.warn(`[pipeline] ${label}: picture ${name} undecodable: ${errorMessage(err)}`);
    }
  }
  return (name) => pictures.get(name);
}

async function emitPicture(outDir: string, bytes: Uint8Array): Promise<HypertextPicture> {
  const { width, height, pixels, palette } = decodePcx(bytes);
  if (palette === undefined) throw new Error('picture has no palette');
  assertPaletteBytes(palette, 'hypertext picture');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  const name = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const file = `${name.slice(0, NAME_DIGEST_CHARS)}.png`;
  const rgba = paletteToRgba(pixels, palette, (i) => (pixels[i] === COLOR_KEY_INDEX ? 0 : 0xff));
  await writeFileWithParents(
    join(outDir, HYPERTEXT_PICTURES_DIR, file),
    await encodePng({ width, height, rgba }),
  );
  return { kind: 'picture', file, width, height };
}
