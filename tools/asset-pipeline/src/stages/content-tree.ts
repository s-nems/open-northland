import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas/index.js';
import type { Bmd } from '../decoders/bmd/index.js';
import { encodePng } from '../decoders/png.js';

/** The canonical casing of the output's `Data/` tree: the exact spelling the content routes serve. */
export const DATA_DIR = 'Data';

/** The `content/` subtree served at the app's `/bobs/` route (bob atlases + the player/GUI/font colour LUTs). */
export const BOBS_DIR = join(DATA_DIR, 'engine2d', 'bin', 'bobs');

/** The `content/` subtree served at the app's `/textures/` route (ground pages + transition overlays). */
export const TEXTURES_DIR = join(DATA_DIR, 'engine2d', 'bin', 'textures');

/** The `content/` subtree served at the app's `/sounds/` route (the extracted `.wav` tree). */
export const SOUNDS_DIR = join(DATA_DIR, 'engine2d', 'bin', 'sounds');

/** The `content/` subtree served at the app's `/gui-bitmaps/` route (menu/HUD backdrops). */
export const GUI_BITMAPS_DIR = join(DATA_DIR, 'gui', 'bitmaps');

/** The subtrees the app addresses through a fixed route, in the spelling those routes match. */
const SERVED_DIRS: readonly string[] = [BOBS_DIR, TEXTURES_DIR, SOUNDS_DIR, GUI_BITMAPS_DIR];

/**
 * The output-relative path a derived file must be written at, given the path its source won in some
 * layer. The content routes match case-sensitively, so inside a served subtree the spelling is
 * canonical: the route's own casing plus a lower-cased tail. Paths outside those subtrees pass through.
 */
export function servedRelPath(rel: string): string {
  const segments = rel.split(/[\\/]+/);
  for (const dir of SERVED_DIRS) {
    const root = dir.split(sep);
    if (segments.length <= root.length) continue;
    if (!root.every((s, i) => segments[i]?.toLowerCase() === s.toLowerCase())) continue;
    return join(dir, ...segments.slice(root.length).map((s) => s.toLowerCase()));
  }
  return rel;
}

/**
 * Writes `value` as pretty-printed JSON (2-space indent, trailing newline) to `<outDir>/<relPath>`,
 * creating the parent directory.
 */
export async function writeJsonFile(outDir: string, relPath: string, value: unknown): Promise<void> {
  const path = join(outDir, relPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The relative paths a bob atlas write produced (native separators, under `outDir`). */
export interface BobAtlasFiles {
  readonly png: string;
  readonly manifest: string;
}

/**
 * Writes a packed bob atlas's `<stem>.png` and `<stem>.atlas.json` under {@link BOBS_DIR}, plus
 * `<stem>.build.png` for a `'build-time'` bake's time sheet.
 */
async function writeBobAtlas(outDir: string, stem: string, atlas: BobAtlas): Promise<BobAtlasFiles> {
  await mkdir(join(outDir, BOBS_DIR), { recursive: true });
  const png = join(BOBS_DIR, `${stem}.png`);
  const manifest = join(BOBS_DIR, `${stem}.atlas.json`);
  await writeFile(join(outDir, png), encodePng(atlas.image));
  await writeFile(join(outDir, manifest), `${JSON.stringify(atlas.manifest, null, 2)}\n`);
  if (atlas.timeImage !== undefined) {
    await writeFile(join(outDir, BOBS_DIR, `${stem}.build.png`), encodePng(atlas.timeImage));
  }
  return { png, manifest };
}

/** The two `loadLayer` stems {@link emitIndexedAndPreviewAtlas} wrote, plus the atlas frame count. */
export interface IndexedAtlasStems {
  /** `<keyStem>.indexed` - the recolourable indexed atlas (palette index in red, mask in alpha). */
  readonly indexedStem: string;
  /** `<keyStem>.<previewSuffix>` - the default-coloured RGBA preview atlas. */
  readonly previewStem: string;
  readonly frames: number;
}

/**
 * Packs a decoded bob container into an indexed atlas the app recolours at draw time plus an RGBA
 * preview coloured through `previewPalette`, written under {@link BOBS_DIR} as `<keyStem>.indexed` and
 * `<keyStem>.<previewSuffix>` (the naming the app-side loaders mirror).
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

/**
 * The flat {@link BOBS_DIR} stem a source `.bmd`'s derived atlas is served at: the lower-cased basename
 * plus `.<suffix>`. The app addresses every atlas by basename under one flat `/bobs/` route, so a bob in
 * a subdirectory or a mixed-case layer must still land at exactly this name. `suffix` (a palette slug,
 * or `indexed`/`shadow`) keeps recolours of one shared body bob apart.
 */
export function bobAtlasStem(bmdRel: string, suffix: string): string {
  const name = basename(bmdRel).replace(/\.bmd$/i, '');
  return `${name.toLowerCase()}.${suffix}`;
}

/** Writes a packed atlas for the source `.bmd` at `bmdRel` under its {@link bobAtlasStem}. */
export async function writeSourceBobAtlas(
  outDir: string,
  bmdRel: string,
  suffix: string,
  atlas: BobAtlas,
): Promise<BobAtlasFiles> {
  return writeBobAtlas(outDir, bobAtlasStem(bmdRel, suffix), atlas);
}

/**
 * Rejects distinct `.bmd` sources whose atlases would claim one {@link bobAtlasStem}. The served
 * namespace is flat, so `bobs/nowe/mur.bmd` and `bobs/mur.bmd` would silently clobber each other; the
 * owned corpus has no such pair. Pass one suffix family at a time, since across families the names
 * cannot meet. Every colliding pair is reported at once because a rerun costs a full conversion.
 */
export function assertDistinctBobBasenames(bmdRefs: Iterable<string>): void {
  const byBasename = new Map<string, string>();
  const collisions: string[] = [];
  for (const ref of bmdRefs) {
    const base = basename(ref).toLowerCase();
    const first = byBasename.get(base);
    if (first === undefined) byBasename.set(base, ref);
    else if (first !== ref) collisions.push(`"${first}" and "${ref}" -> ${bobAtlasStem(ref, '<suffix>')}`);
  }
  if (collisions.length > 0) {
    throw new Error(
      'bob basename collision - the served atlas namespace is flat, so each of these pairs would ' +
        `claim one name: ${collisions.join('; ')}. Rename one .bmd of each pair and re-run`,
    );
  }
}
