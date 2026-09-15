import { type Vfs, vbasename, vjoin, writeText } from '@open-northland/vfs';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas/index.js';
import type { Bmd } from '../decoders/bmd/index.js';
import { encodePng } from '../decoders/png.js';

// The output tree is served as static files, so each directory's name is the URL root the app fetches
// it at, and every file inside is lower-cased because the IR's references are.

/** Bob atlases plus the player, GUI and font colour LUTs. */
export const BOBS_DIR = 'bobs';
/** Ground texture pages and transition overlays. */
export const TEXTURES_DIR = 'textures';
/** The mod's `.wav` tree. */
export const SOUNDS_DIR = 'sounds';
/** Menu and HUD backdrop fills. */
export const GUI_BITMAPS_DIR = 'gui-bitmaps';
/** Decoded map grids and their sidecars. */
export const MAPS_DIR = 'maps';

/**
 * Writes `value` as pretty-printed JSON (2-space indent, trailing newline) to `<outDir>/<relPath>`,
 * creating the parent directory.
 */
export async function writeJsonFile(fs: Vfs, outDir: string, relPath: string, value: unknown): Promise<void> {
  await writeText(fs, vjoin(outDir, relPath), `${JSON.stringify(value, null, 2)}\n`);
}

/** The relative paths a bob atlas write produced (under `outDir`). */
export interface BobAtlasFiles {
  readonly png: string;
  readonly manifest: string;
}

/**
 * Writes a packed bob atlas's `<stem>.png` and `<stem>.atlas.json` under {@link BOBS_DIR}, plus
 * `<stem>.build.png` for a `'build-time'` bake's time sheet.
 */
async function writeBobAtlas(fs: Vfs, outDir: string, stem: string, atlas: BobAtlas): Promise<BobAtlasFiles> {
  const png = vjoin(BOBS_DIR, `${stem}.png`);
  const manifest = vjoin(BOBS_DIR, `${stem}.atlas.json`);
  await fs.writeFile(vjoin(outDir, png), await encodePng(atlas.image));
  await writeText(fs, vjoin(outDir, manifest), `${JSON.stringify(atlas.manifest, null, 2)}\n`);
  if (atlas.timeImage !== undefined) {
    await fs.writeFile(vjoin(outDir, BOBS_DIR, `${stem}.build.png`), await encodePng(atlas.timeImage));
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
  fs: Vfs,
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
  await writeBobAtlas(fs, outDir, indexedStem, indexed);
  await writeBobAtlas(fs, outDir, previewStem, preview);
  return { indexedStem, previewStem, frames: indexed.manifest.frames.length };
}

/**
 * The flat {@link BOBS_DIR} stem a source `.bmd`'s derived atlas is served at: the lower-cased basename
 * plus `.<suffix>`. The app addresses every atlas by basename under one flat `/bobs/` route, so a bob in
 * a subdirectory or a mixed-case layer must still land at exactly this name. `suffix` (a palette slug,
 * or `indexed`/`shadow`) keeps recolours of one shared body bob apart.
 */
export function bobAtlasStem(bmdRel: string, suffix: string): string {
  const name = vbasename(bmdRel).replace(/\.bmd$/i, '');
  return `${name.toLowerCase()}.${suffix}`;
}

/** Writes a packed atlas for the source `.bmd` at `bmdRel` under its {@link bobAtlasStem}. */
export async function writeSourceBobAtlas(
  fs: Vfs,
  outDir: string,
  bmdRel: string,
  suffix: string,
  atlas: BobAtlas,
): Promise<BobAtlasFiles> {
  return writeBobAtlas(fs, outDir, bobAtlasStem(bmdRel, suffix), atlas);
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
    const base = vbasename(ref).toLowerCase();
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
