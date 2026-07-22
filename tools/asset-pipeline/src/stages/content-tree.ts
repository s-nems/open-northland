import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
import type { Bmd } from '../decoders/bmd/index.js';
import { encodePng } from '../decoders/png.js';

/** The canonical casing of the output's `Data/` tree: the exact spelling the content routes serve. */
export const DATA_DIR = 'Data';

/** The `content/` subtree served at the app's `/bobs/` route (bob atlases + the player/GUI/font colour LUTs). */
export const BOBS_DIR = join(DATA_DIR, 'engine2d', 'bin', 'bobs');

/** The `content/` subtree served at the app's `/textures/` route (ground pages + transition overlays),
 *  in the game tree's real casing — writes must land here or the vite route never serves them. */
export const TEXTURES_DIR = join(DATA_DIR, 'engine2d', 'bin', 'textures');

/**
 * Writes `value` as pretty-printed JSON (2-space indent, trailing newline) to `<outDir>/<relPath>`,
 * creating the parent directory. The single JSON-artifact writer the stage manifest/metrics emitters end with.
 */
export async function writeJsonFile(outDir: string, relPath: string, value: unknown): Promise<void> {
  const path = join(outDir, relPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Writes a packed bob atlas's `<stem>.png` + `<stem>.atlas.json` under {@link BOBS_DIR} (the `/bobs/` convention). */
async function writeBobAtlas(outDir: string, stem: string, atlas: BobAtlas): Promise<void> {
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
 * `<bmd-stem>.<suffix>.atlas.json` (+ `<bmd-stem>.<suffix>.build.png` for a `'build-time'` bake's time
 * sheet, announced by the manifest's `build` flag) — and returns the relative paths. `bmdOnDisk` must end
 * in `.bmd` (the caller resolved the real cased path). The `<suffix>` distinguishes recolours of one
 * shared body bob (a palette slug, or `indexed` for the recolourable atlas) so variants don't clobber
 * each other. The bob-tree twin of {@link writeBobAtlas} (which writes to the fixed {@link BOBS_DIR} instead).
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
  if (atlas.timeImage !== undefined) {
    await writeFile(
      join(outDir, bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.build.png`)),
      encodePng(atlas.timeImage),
    );
  }
  return { png, manifest };
}
