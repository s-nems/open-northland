import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type AtlasAlphaMode, type BobAtlas, packBobAtlas } from '../../decoders/atlas.js';
import { decodeBmd } from '../../decoders/bmd/index.js';
import {
  type BmdPaletteBinding,
  normalizeAssetPath,
  type PaletteAlias,
  paletteAliasMap,
} from '../../decoders/ini.js';
import { decodePcx } from '../../decoders/pcx.js';
import { walkFiles } from '../../walk.js';
import { writeAtlasBeside } from '../game-file.js';

/**
 * Pure composition: `.bmd` bytes + a 768-byte RGB palette -> a packed bob atlas (the RGBA sheet to
 * PNG-encode + the JSON manifest of per-bob frame rects/metadata). Mirrors {@link pcxToPng}: the
 * decoders stay pure, this is the only wiring between them. The atlas PNG is `encodePng(atlas.image)`;
 * the manifest serializes straight to JSON. Throws a `bmd:`/`atlas:`-prefixed error for a malformed
 * container or a wrong-sized palette — the batch tree-walk (a later step) catches it per-file. The
 * **palette source** for a given `.bmd` (which `palettes.ini` entry / `.pcx` trailer pairs with it) is
 * the open question that gates the full tree-walk, so this seam takes the palette as a parameter today.
 * `alpha` picks the bake mode — see {@link AtlasAlphaMode}; the house atlases need `'opaque'`.
 */
export function bmdToAtlas(
  bmdBytes: Uint8Array,
  palette: Uint8Array,
  alpha: AtlasAlphaMode = 'per-pixel',
): BobAtlas {
  return packBobAtlas(decodeBmd(bmdBytes), palette, { alpha });
}

/**
 * Builds a case-insensitive index of the unpacked tree: `normalizeAssetPath(rel)` -> the real on-disk
 * relative path (native separators). The binding extractors lower-case + forward-slash their `.bmd`/
 * `.pcx` references, but the unpacked `.lib` members keep the archive's original (mixed) case, so a
 * direct `join(out, ref)` would miss on a case-sensitive filesystem. This map bridges the two: look a
 * normalized reference up to get the real path under `outDir`. Built once per run and shared by every
 * binding. Keys via the same `normalizeAssetPath` the extractors use (forward slashes, lower-case), so
 * the two sides can never drift.
 */
export async function indexOutTree(outDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for await (const file of walkFiles(outDir)) {
    const rel = relative(outDir, file);
    index.set(normalizeAssetPath(rel), rel);
  }
  return index;
}

/** One emitted bob atlas: the binding it came from plus the relative atlas PNG / manifest JSON paths. */
export interface BmdConversion {
  /** The body `.bmd`'s path under `outDir`, normalized (forward slashes, lower-case) — the binding key. */
  readonly bmd: string;
  /** The palette `editname` this atlas was recoloured with — the per-creature differentiator. */
  readonly paletteName: string;
  /** The atlas PNG's path relative to `outDir` (native separators). */
  readonly png: string;
  /** The atlas manifest JSON's path relative to `outDir` (native separators). */
  readonly manifest: string;
}

/**
 * Filesystem-safe slug of a palette `editname` for use as an output-filename component. Palette names
 * are already lower-cased ({@link normalizePaletteName}) and in the real data are bare identifiers like
 * `bear01`/`vik_man_base`/`test_human_00`, but a stray space or punctuation would otherwise leak into a
 * path — collapse every non-`[a-z0-9_]` run to a single `_` so the atlas name stays portable and stable.
 */
function paletteSlug(name: string): string {
  return name.replace(/[^a-z0-9_]+/g, '_');
}

/**
 * Converts the body `.bmd` of every readable `[jobgraphics]` binding into a packed atlas PNG + a
 * manifest JSON, written as siblings of the `.bmd` under `outDir`. This wires the `.bmd`→palette
 * pairing graph end-to-end: {@link extractGraphicsBindings} names each `.bmd`'s palette `editname`,
 * {@link extractPaletteIndex} resolves that name to a palette `.pcx`, and the `.pcx` trailer palette
 * colours the bob frames via {@link bmdToAtlas}. Both the `.bmd` and the palette `.pcx` are read from
 * the unpacked `--out` tree (the `.lib` unpack stage extracted them there); {@link indexOutTree}
 * resolves the extractors' lower-cased references to the real (mixed-case) on-disk paths.
 *
 * Per-binding boundary failures are warned-and-skipped, never fatal — an unresolvable palette name, a
 * `.pcx`/`.bmd` missing from `--out`, a palette-less `.pcx`, or a malformed `.bmd` only drops that one
 * atlas, matching the other tree-walk stages. Each binding emits `<bmd>.<palette>.png` (the atlas sheet)
 * and `<bmd>.<palette>.atlas.json` (the per-bob frame manifest), keyed by the palette `editname`: many
 * bindings share one body `.bmd` recoloured per creature (the animals are a single geometry, the humans
 * one body re-tinted per tribe/job), so naming on the `.bmd` alone would collapse them onto one file
 * (last-palette-wins). The palette name is the only per-creature differentiator, so it goes in the
 * filename — `(bmd, palette)` now names a distinct atlas. The shadow `.bmd` is left for a later step
 * (shadows use a separate, single-colour palette path).
 *
 * `opaqueAlphaBmds` (the `.bmd` paths claimed by a `[GfxHouse]` record — see
 * {@link resolveGraphicsBindings}) bake with the plain opaque blit instead of the Double8Bit
 * per-pixel alpha: a house bob's alpha bytes are measured non-coverage, so drawing them as alpha
 * ghosts the buildings. Keyed on the `.bmd` path alone — NOT `(bmd, palette)` — because the alpha
 * bytes live in the bob geometry the recolours share: every palette variant of a claimed `.bmd`
 * (including the `[GfxLandscape]` twins — residence houses / wonders placed as map decor) must bake
 * the same way, or identical pixels would go ghost-vs-solid by recolour name. REQUIRED (no default):
 * an accidentally-empty set silently ghosts every building, so the one production caller passes the
 * set explicitly.
 */
export async function convertBmdTree(
  bindings: readonly BmdPaletteBinding[],
  palettes: readonly PaletteAlias[],
  outDir: string,
  opaqueAlphaBmds: ReadonlySet<string>,
): Promise<BmdConversion[]> {
  const done: BmdConversion[] = [];
  const paletteByName = paletteAliasMap(palettes);
  const tree = await indexOutTree(outDir);
  for (const binding of bindings) {
    const pcxRel = paletteByName.get(binding.paletteName);
    if (pcxRel === undefined) {
      console.warn(`[pipeline] skipped ${binding.bmd}: unknown palette "${binding.paletteName}"`);
      continue;
    }
    const pcxOnDisk = tree.get(pcxRel);
    const bmdOnDisk = tree.get(binding.bmd);
    if (pcxOnDisk === undefined || bmdOnDisk === undefined) {
      const missing = pcxOnDisk === undefined ? `palette ${pcxRel}` : `bmd ${binding.bmd}`;
      console.warn(`[pipeline] skipped ${binding.bmd}: ${missing} not found under out`);
      continue;
    }
    let atlas: BobAtlas;
    try {
      const palette = decodePcx(await readFile(join(outDir, pcxOnDisk))).palette;
      if (palette === undefined) {
        console.warn(`[pipeline] skipped ${binding.bmd}: palette ${pcxRel} has no trailer`);
        continue;
      }
      const alpha: AtlasAlphaMode = opaqueAlphaBmds.has(binding.bmd) ? 'opaque' : 'per-pixel';
      atlas = bmdToAtlas(await readFile(join(outDir, bmdOnDisk)), palette, alpha);
    } catch (err) {
      console.warn(`[pipeline] skipped ${binding.bmd}: ${(err as Error).message}`);
      continue;
    }
    if (!/\.bmd$/i.test(bmdOnDisk)) {
      // A `.bmd`-less name would make the output paths collide with the source — skip rather than
      // clobber the input bytes. The extractor only emits `gfxbobmanagerbody` `.bmd` paths, so this is
      // a defensive guard, not an expected case.
      console.warn(`[pipeline] skipped ${binding.bmd}: source has no .bmd extension`);
      continue;
    }
    // Name on (bmd, palette), not the .bmd alone: many bindings share one body bob recoloured per
    // creature, so `<bmd>.png` would collapse them last-palette-wins. The palette editname is the only
    // per-creature differentiator, so it rides in the filename — `<bmd-stem>.<palette>.png`.
    const { png, manifest } = await writeAtlasBeside(
      outDir,
      bmdOnDisk,
      paletteSlug(binding.paletteName),
      atlas,
    );
    done.push({ bmd: binding.bmd, paletteName: binding.paletteName, png, manifest });
  }
  return done;
}
