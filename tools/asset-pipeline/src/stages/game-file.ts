import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { BobAtlas } from '../decoders/atlas.js';
import { encodePng } from '../decoders/png.js';

/**
 * Small helpers shared by the loose-file extraction stages (`gui`, `fonts`): reading straight from an owned
 * game tree (rather than the unpacked `.lib` output), and writing a bob atlas into the `/bobs/` content
 * tree. Kept here so a stage never imports another stage just for a shared read/write helper.
 */

/** The `content/` subtree served at the app's `/bobs/` route (bob atlases + the player/GUI/font colour LUTs). */
export const BOBS_DIR = join('Data', 'engine2d', 'bin', 'bobs');

/** The `content/` subtree served at the app's `/textures/` route (ground pages + transition overlays),
 *  in the game tree's real casing — writes must land HERE or the vite route never serves them. */
export const TEXTURES_DIR = join('Data', 'engine2d', 'bin', 'textures');

/**
 * Reads a loose game file, tolerating a differently-cased leaf FILENAME (the shipped names are lower-case,
 * but a user's install could differ). Tries the exact path first, then a case-insensitive scan of the
 * parent directory for the basename — the directory components themselves must match case (they are
 * fixed-case in the shipped tree, so folding them too would be unused complexity). Throws if absent.
 */
export async function readGameFile(gameDir: string, relPath: string): Promise<Uint8Array> {
  try {
    return await readFile(join(gameDir, relPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const dir = join(gameDir, dirname(relPath));
  const want = basename(relPath).toLowerCase();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    throw new Error(`${relPath} not found under ${gameDir}`);
  }
  const match = names.find((n) => n.toLowerCase() === want);
  if (match === undefined) throw new Error(`${relPath} not found under ${gameDir}`);
  return readFile(join(dir, match));
}

/**
 * A neutral 256-colour grayscale palette (index i → (i,i,i)), used to keep a colour-LUT row stable when a
 * palette carrier is absent, so the LUT's row order (the app-side contract) stays fixed regardless of a
 * partial install.
 */
export function identityPalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.fill(i, i * 3, i * 3 + 3);
  return p;
}

/** Writes a packed bob atlas's `<stem>.png` + `<stem>.atlas.json` under {@link BOBS_DIR} (the `/bobs/` convention). */
export async function writeBobAtlas(outDir: string, stem: string, atlas: BobAtlas): Promise<void> {
  await mkdir(join(outDir, BOBS_DIR), { recursive: true });
  await writeFile(join(outDir, BOBS_DIR, `${stem}.png`), encodePng(atlas.image));
  await writeFile(
    join(outDir, BOBS_DIR, `${stem}.atlas.json`),
    `${JSON.stringify(atlas.manifest, null, 2)}\n`,
  );
}
