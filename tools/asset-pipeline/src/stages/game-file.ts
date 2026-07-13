import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
import type { Bmd } from '../decoders/bmd/index.js';
import { decodePcx } from '../decoders/pcx.js';
import { buildPlayerLutImage } from '../decoders/player-palette.js';
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

/** One palette-LUT carrier: a row name and the game-relative `.pcx` whose 256-colour trailer fills the row. */
export interface PaletteLutSource {
  readonly name: string;
  readonly file: string;
}

/** The emitted palette LUT plus the resolved palettes (for preview colouring + the manifest). */
export interface PaletteLutResult {
  /** `loadLayer`/`loadAtlasSource` stem of the `256 × N` LUT PNG under {@link BOBS_DIR}. */
  readonly stem: string;
  /** LUT row order (row index = array index) — the app mirrors this to pick a row. */
  readonly names: string[];
  /** name → 768-byte palette, for colouring the preview atlases. Absent palettes are identity-filled. */
  readonly byName: Map<string, Uint8Array>;
}

/**
 * Reads each `sources` carrier's 256-colour `.pcx` trailer, stacks them (in source order) into one
 * `256 × N` LUT PNG under {@link BOBS_DIR}, and returns the stem + row order + name→palette map. A
 * missing/palette-less carrier is warned (`[pipeline] ${label}: ${noun} <name> unreadable …`) and
 * replaced with an {@link identityPalette} row so the row order (the app-side contract) stays fixed
 * regardless of a partial install. Shared by the GUI-palette and font-colour LUT stages, which differ
 * only in their carrier list, stem, and log wording.
 */
export async function buildPaletteLut(
  gameDir: string,
  outDir: string,
  sources: readonly PaletteLutSource[],
  stem: string,
  label: string,
  noun: string,
): Promise<PaletteLutResult> {
  const ordered: Uint8Array[] = [];
  const byName = new Map<string, Uint8Array>();
  for (const src of sources) {
    let palette: Uint8Array | undefined;
    try {
      palette = decodePcx(await readGameFile(gameDir, src.file)).palette;
    } catch (err) {
      console.warn(
        `[pipeline] ${label}: ${noun} ${src.name} unreadable (${(err as Error).message}); using neutral row`,
      );
    }
    if (palette === undefined) palette = identityPalette();
    ordered.push(palette);
    byName.set(src.name, palette);
  }
  await writeLutPng(outDir, stem, ordered);
  return { stem, names: sources.map((s) => s.name), byName };
}

/**
 * Stacks `orderedPalettes` (one 768-byte RGB row per LUT slot, in row order) into a `256 × N` player-LUT
 * PNG at `<BOBS_DIR>/<stem>.png`. The single emit step every palette-LUT stage ends with — the row
 * *resolution* differs per stage (fixed carrier files vs the goods alias graph), the write does not.
 */
export async function writeLutPng(
  outDir: string,
  stem: string,
  orderedPalettes: readonly Uint8Array[],
): Promise<void> {
  await mkdir(join(outDir, BOBS_DIR), { recursive: true });
  await writeFile(join(outDir, BOBS_DIR, `${stem}.png`), encodePng(buildPlayerLutImage(orderedPalettes)));
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

/** The two `loadLayer` stems {@link emitIndexedAndPreviewAtlas} wrote, plus the atlas frame count. */
export interface IndexedAtlasStems {
  /** `<keyStem>.indexed` — the recolourable indexed atlas (palette index in red, mask in alpha). */
  readonly indexedStem: string;
  /** `<keyStem>.<previewSuffix>` — the default-coloured RGBA preview atlas. */
  readonly previewStem: string;
  readonly frames: number;
}

/**
 * Packs a decoded bob container into (a) an indexed atlas the app recolours at draw time and (b) an RGBA
 * preview coloured through `previewPalette`, writes both under {@link BOBS_DIR} as `<keyStem>.indexed` and
 * `<keyStem>.<previewSuffix>`, and returns the two stems + frame count. The shared emit path for the
 * goods/GUI/font indexed-atlas stages, which differ only in their key stem, preview suffix, and palette —
 * centralizing the `<stem>.indexed` / `<stem>.<colour>` naming the app-side loaders mirror.
 */
export async function emitIndexedAndPreviewAtlas(
  outDir: string,
  keyStem: string,
  bmd: Bmd,
  previewSuffix: string,
  previewPalette: Uint8Array,
): Promise<IndexedAtlasStems> {
  const indexed = packIndexedBobAtlas(bmd);
  const preview = packBobAtlas(bmd, previewPalette);
  const indexedStem = `${keyStem}.indexed`;
  const previewStem = `${keyStem}.${previewSuffix}`;
  await writeBobAtlas(outDir, indexedStem, indexed);
  await writeBobAtlas(outDir, previewStem, preview);
  return { indexedStem, previewStem, frames: indexed.manifest.frames.length };
}

/** The relative PNG + manifest paths {@link writeAtlasBeside} wrote (native separators, under `outDir`). */
export interface AtlasBesideResult {
  readonly png: string;
  readonly manifest: string;
}

/**
 * Writes a packed atlas as siblings of its source `.bmd` under `outDir` — `<bmd-stem>.<suffix>.png` +
 * `<bmd-stem>.<suffix>.atlas.json` — and returns the two relative paths. `bmdOnDisk` must end in `.bmd`
 * (the caller resolved the real cased path). The `<suffix>` distinguishes recolours of one shared body
 * bob (a palette slug, or `indexed` for the recolourable atlas) so variants don't clobber each other.
 * The bob-tree twin of {@link writeBobAtlas} (which writes to the fixed {@link BOBS_DIR} instead).
 */
export async function writeAtlasBeside(
  outDir: string,
  bmdOnDisk: string,
  suffix: string,
  atlas: BobAtlas,
): Promise<AtlasBesideResult> {
  const png = bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.png`);
  const manifest = bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.atlas.json`);
  await writeFile(join(outDir, png), encodePng(atlas.image));
  await writeFile(join(outDir, manifest), `${JSON.stringify(atlas.manifest, null, 2)}\n`);
  return { png, manifest };
}
