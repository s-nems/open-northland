import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  type AtlasAlphaMode,
  type BobAtlas,
  packBobAtlas,
  packShadowBobAtlas,
} from '../../decoders/atlas.js';
import { decodeBmd } from '../../decoders/bmd/index.js';
import { normalizeAssetPath, paletteAliasMap } from '../../decoders/ini.js';
import { decodePcx } from '../../decoders/pcx.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { walkFiles } from '../../walk.js';
import { writeAtlasBeside } from '../content-tree.js';
import type { GraphicsBindingSet } from './bindings.js';

/**
 * Pure composition: `.bmd` bytes + a 768-byte RGB palette -> a packed bob atlas (the RGBA sheet to
 * PNG-encode + the JSON manifest of per-bob frame rects/metadata). Mirrors {@link pcxToPng}: the
 * decoders stay pure, this is the only wiring between them. The atlas PNG is `encodePng(atlas.image)`;
 * the manifest serializes straight to JSON. Throws a `bmd:`/`atlas:`-prefixed error for a malformed
 * container or a wrong-sized palette — the batch tree-walk (a later step) catches it per-file.
 * `alpha` picks the bake mode — see {@link AtlasAlphaMode}; the house atlases need `'build-time'`.
 */
export function bmdToAtlas(
  bmdBytes: Uint8Array,
  palette: Uint8Array,
  alpha: AtlasAlphaMode = 'per-pixel',
): BobAtlas {
  return packBobAtlas(decodeBmd(bmdBytes), palette, { alpha });
}

/** Normalized asset reference → its real (mixed-case) path under `outDir`. See {@link indexOutTree}. */
export type OutTreeIndex = ReadonlyMap<string, string>;

/**
 * Builds a case-insensitive index of the unpacked tree: `normalizeAssetPath(rel)` -> the real on-disk
 * relative path (native separators). The binding extractors lower-case + forward-slash their `.bmd`/
 * `.pcx` references, but the unpacked `.lib` members keep their archive spelling under the
 * `Data/`-canonicalized root, so a direct `join(out, ref)` would miss on a case-sensitive
 * filesystem. This map bridges the two: look a
 * normalized reference up to get the real path under `outDir`. Keys via the same `normalizeAssetPath` the
 * extractors use (forward slashes, lower-case), so the two sides can never drift.
 *
 * Built once after the unpack stages and threaded into every consumer: the tree holds ~10k files, and the
 * atlas stages only ever look up source `.bmd`/`.pcx` members, never the `.png`/`.atlas.json` they write.
 */
export async function indexOutTree(outDir: string): Promise<OutTreeIndex> {
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
 * filename — `(bmd, palette)` now names a distinct atlas. The shadow `.bmd`s convert separately
 * ({@link convertShadowBmdTree} — no palette, one atlas per shadow `.bmd`).
 *
 * `buildTimeBmds` (the `.bmd` paths claimed by a `[GfxHouse]` record — see
 * {@link resolveGraphicsBindings}, which documents why their second bytes are build-time thresholds,
 * not alpha) bake `'build-time'` instead of per-pixel alpha. Keyed on the `.bmd` path alone, not
 * `(bmd, palette)`: the second bytes live in the bob geometry the recolours share, so every palette
 * variant of a claimed `.bmd` must bake the same way. Required (no default) because an
 * accidentally-empty set silently ghosts every building.
 */
export async function convertBmdTree(
  graphics: GraphicsBindingSet,
  outDir: string,
  tree: OutTreeIndex,
  onItem?: StageItemReporter,
): Promise<BmdConversion[]> {
  const { bindings, palettes, buildTimeBmds } = graphics;
  const done: BmdConversion[] = [];
  const paletteByName = paletteAliasMap(palettes);
  for (const [processed, binding] of bindings.entries()) {
    onItem?.(processed, bindings.length);
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
      const alpha: AtlasAlphaMode = buildTimeBmds.has(binding.bmd) ? 'build-time' : 'per-pixel';
      atlas = bmdToAtlas(await readFile(join(outDir, bmdOnDisk)), palette, alpha);
    } catch (err) {
      console.warn(`[pipeline] skipped ${binding.bmd}: ${errorMessage(err)}`);
      continue;
    }
    if (!/\.bmd$/i.test(bmdOnDisk)) {
      // A `.bmd`-less name would make the output paths collide with the source — skip rather than
      // clobber the input bytes. The extractor only emits `gfxbobmanagerbody` `.bmd` paths, so this is
      // a defensive guard, not an expected case.
      console.warn(`[pipeline] skipped ${binding.bmd}: source has no .bmd extension`);
      continue;
    }
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

/** The atlas-filename suffix of a converted shadow `.bmd` (`<shadow-stem>.shadow.{png,atlas.json}`) —
 *  the palette slug's slot, fixed because a shadow atlas is palette-less. */
const SHADOW_ATLAS_SUFFIX = 'shadow';

/**
 * Converts the shadow `.bmd` of every binding that names one (`GfxBobLibs`/`shadowlib` second value)
 * into a packed shadow atlas ({@link packShadowBobAtlas} — black-at-`SHADOW_ALPHA` silhouettes,
 * the shadow blit pre-baked) written beside the shadow `.bmd` as
 * `<shadow-stem>.shadow.{png,atlas.json}`. A shadow bob set parallels its body's bob ids (observed:
 * `ls_trees_s.bmd` mirrors `ls_trees.bmd`'s 493 slots; the house `_s.bmd`s hold a ground silhouette at
 * each finished `GfxBobId`), so a consumer looks a caster's shadow up by the body's own bob id. One
 * atlas per shadow `.bmd` — recolours share it (a shadow has no palette). Boundary failures
 * warn-and-skip per file, like every tree-walk stage.
 */
export async function convertShadowBmdTree(
  graphics: GraphicsBindingSet,
  outDir: string,
  tree: OutTreeIndex,
): Promise<string[]> {
  const seen = new Set<string>();
  const done: string[] = [];
  for (const binding of graphics.bindings) {
    const shadowBmd = binding.shadowBmd;
    if (shadowBmd === undefined || seen.has(shadowBmd)) continue;
    seen.add(shadowBmd);
    const onDisk = tree.get(shadowBmd);
    if (onDisk === undefined) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: not found under out`);
      continue;
    }
    if (!/\.bmd$/i.test(onDisk)) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: source has no .bmd extension`);
      continue;
    }
    try {
      const atlas = packShadowBobAtlas(decodeBmd(await readFile(join(outDir, onDisk))));
      const { png } = await writeAtlasBeside(outDir, onDisk, SHADOW_ATLAS_SUFFIX, atlas);
      done.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: ${errorMessage(err)}`);
    }
  }
  return done;
}
