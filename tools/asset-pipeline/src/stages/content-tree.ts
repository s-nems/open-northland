import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
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
 * layer. Inside a served subtree the spelling is canonical - the route's own casing, then a lower-cased
 * tail (the casing `normalizeAssetPath` gives the tail of every app-side reference) - because the
 * content routes match case-sensitively: a layer spelling `data/` or `Bin/Bobs/` would otherwise write
 * outside its route and the loaders would read the 404 as absent content. Paths outside those subtrees
 * pass through, no route addresses them.
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
 * creating the parent directory. The single JSON-artifact writer the stage manifest/metrics emitters end with.
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
 * Writes a packed bob atlas's `<stem>.png` + `<stem>.atlas.json` under {@link BOBS_DIR} (the `/bobs/`
 * convention), plus `<stem>.build.png` for a `'build-time'` bake's time sheet (announced by the
 * manifest's `build` flag), and returns their relative paths.
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
 * Packs a decoded bob container into (a) an indexed atlas the app recolours at draw time and (b) an RGBA
 * preview coloured through `previewPalette`, writes both under {@link BOBS_DIR} as `<keyStem>.indexed` and
 * `<keyStem>.<previewSuffix>`, and returns the two stems + frame count. The shared emit path for the
 * goods/GUI/font indexed-atlas stages, which differ only in their key stem, preview suffix, and palette -
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

/**
 * The flat {@link BOBS_DIR} stem a source `.bmd`'s derived atlas is served at: the lower-cased
 * basename plus `.<suffix>`. The app addresses every atlas by basename under one flat `/bobs/` route
 * (`servedAtlasStem`, packages/app), so a bob in a `bobs/` subdirectory or in a mixed-case layer must
 * still land at exactly this name. `suffix` distinguishes recolours of one shared body bob (a palette
 * slug, or `indexed`/`shadow`) so variants don't clobber each other.
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
 * namespace is flat, so `bobs/nowe/mur.bmd` and `bobs/mur.bmd` would silently clobber each other and
 * half the buildings would draw the wrong body; the owned corpus has no such pair. Pass one suffix
 * family at a time (bodies carry a palette slug, shadows a fixed `shadow`) - across families the
 * names cannot meet. Every colliding pair is reported at once: a rerun costs a full conversion.
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
