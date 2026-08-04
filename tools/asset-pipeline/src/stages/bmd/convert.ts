import { readFile } from 'node:fs/promises';
import {
  type AtlasAlphaMode,
  type BobAtlas,
  packBobAtlas,
  packShadowBobAtlas,
} from '../../decoders/atlas.js';
import { decodeBmd } from '../../decoders/bmd/index.js';
import { paletteAliasMap } from '../../decoders/ini.js';
import { decodePcx } from '../../decoders/pcx.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { assertDistinctBobBasenames, writeSourceBobAtlas } from '../content-tree.js';
import type { SourceAssetIndex } from '../source-files.js';
import { bindingKey, type GraphicsBindingSet } from './bindings.js';

/**
 * `.bmd` bytes plus a 768-byte RGB palette to a packed bob atlas. Throws a `bmd:`/`atlas:`-prefixed
 * error for a malformed container or a wrong-sized palette. `alpha` picks the bake mode
 * ({@link AtlasAlphaMode}); the house atlases need `'build-time'`.
 */
export function bmdToAtlas(
  bmdBytes: Uint8Array,
  palette: Uint8Array,
  alpha: AtlasAlphaMode = 'per-pixel',
): BobAtlas {
  return packBobAtlas(decodeBmd(bmdBytes), palette, { alpha });
}

/** One emitted bob atlas: the binding it came from plus the relative atlas PNG / manifest JSON paths. */
export interface BmdConversion {
  /** The body `.bmd`'s path under `outDir`, normalized (forward slashes, lower-case) - the binding key. */
  readonly bmd: string;
  /** The palette `editname` this atlas was recoloured with - the per-creature differentiator. */
  readonly paletteName: string;
  /** The atlas PNG's path relative to `outDir` (native separators). */
  readonly png: string;
  /** The atlas manifest JSON's path relative to `outDir` (native separators). */
  readonly manifest: string;
}

/**
 * Filesystem-safe slug of an already lower-cased palette `editname`: every non-`[a-z0-9_]` run collapses
 * to a single `_`, so a stray space or punctuation cannot leak into an output path.
 */
function paletteSlug(name: string): string {
  return name.replace(/[^a-z0-9_]+/g, '_');
}

/**
 * Converts the body `.bmd` of every binding into a packed atlas PNG plus a manifest JSON at its served
 * flat stem, colouring the bob frames through the palette its `editname` resolves to. Duplicate
 * `(bmd, palette)` bindings convert once, since the binding legs deliberately overlap.
 *
 * Each atlas is named `<bmd-basename>.<palette>` because many bindings share one body `.bmd` recoloured
 * per creature; naming on the `.bmd` alone would collapse them onto one last-palette-wins file. Shadow
 * `.bmd`s convert separately ({@link convertShadowBmdTree}).
 *
 * Per-binding boundary failures are warned and skipped; a basename collision is the one fatal case
 * ({@link assertDistinctBobBasenames}), having no per-binding answer.
 *
 * `buildTimeBmds` (the `.bmd` paths a `[GfxHouse]` record claims) bake `'build-time'` alpha. It is keyed
 * on the `.bmd` path alone, not `(bmd, palette)`, because the build-time bytes live in the bob geometry
 * the recolours share. Required with no default, since an accidentally-empty set silently ghosts every
 * building.
 */
export async function convertBmdTree(
  graphics: GraphicsBindingSet,
  outDir: string,
  tree: SourceAssetIndex,
  onItem?: StageItemReporter,
): Promise<BmdConversion[]> {
  const { bindings, palettes, buildTimeBmds } = graphics;
  assertDistinctBobBasenames(bindings.map((b) => b.bmd).filter((ref) => tree.has(ref)));
  const done: BmdConversion[] = [];
  const paletteByName = paletteAliasMap(palettes);
  const seen = new Set<string>();
  for (const [processed, binding] of bindings.entries()) {
    onItem?.(processed, bindings.length);
    const key = bindingKey(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    const pcxRel = paletteByName.get(binding.paletteName);
    if (pcxRel === undefined) {
      console.warn(`[pipeline] skipped ${binding.bmd}: unknown palette "${binding.paletteName}"`);
      continue;
    }
    const pcxSource = tree.get(pcxRel);
    const bmdSource = tree.get(binding.bmd);
    if (pcxSource === undefined || bmdSource === undefined) {
      const missing = pcxSource === undefined ? `palette ${pcxRel}` : `bmd ${binding.bmd}`;
      console.warn(`[pipeline] skipped ${binding.bmd}: ${missing} not found in any source layer`);
      continue;
    }
    let atlas: BobAtlas;
    try {
      const palette = decodePcx(await readFile(pcxSource.path)).palette;
      if (palette === undefined) {
        console.warn(`[pipeline] skipped ${binding.bmd}: palette ${pcxRel} has no trailer`);
        continue;
      }
      const alpha: AtlasAlphaMode = buildTimeBmds.has(binding.bmd) ? 'build-time' : 'per-pixel';
      atlas = bmdToAtlas(await readFile(bmdSource.path), palette, alpha);
    } catch (err) {
      console.warn(`[pipeline] skipped ${binding.bmd}: ${errorMessage(err)}`);
      continue;
    }
    if (!/\.bmd$/i.test(bmdSource.rel)) {
      // The served stem is the basename minus `.bmd`, so a `.bmd`-less name would carry its own
      // extension into the atlas name. The extractor only emits `.bmd` paths, so this is a guard.
      console.warn(`[pipeline] skipped ${binding.bmd}: source has no .bmd extension`);
      continue;
    }
    const { png, manifest } = await writeSourceBobAtlas(
      outDir,
      bmdSource.rel,
      paletteSlug(binding.paletteName),
      atlas,
    );
    done.push({ bmd: binding.bmd, paletteName: binding.paletteName, png, manifest });
  }
  return done;
}

/** The atlas-filename suffix of a converted shadow `.bmd` (`<shadow-stem>.shadow.{png,atlas.json}`) -
 *  the palette slug's slot, fixed because a shadow atlas is palette-less. */
const SHADOW_ATLAS_SUFFIX = 'shadow';

/**
 * Converts the shadow `.bmd` of every binding that names one (`GfxBobLibs`/`shadowlib` second value)
 * into a packed shadow atlas at `<shadow-basename>.shadow.{png,atlas.json}`. A shadow bob set parallels
 * its body's bob ids (observed: `ls_trees_s.bmd` mirrors `ls_trees.bmd`'s 493 slots), so a consumer
 * looks a caster's shadow up by the body's own bob id. One atlas per shadow `.bmd`, since a shadow has
 * no palette for recolours to differ by.
 */
export async function convertShadowBmdTree(
  graphics: GraphicsBindingSet,
  outDir: string,
  tree: SourceAssetIndex,
): Promise<string[]> {
  const convertible = (ref: string | undefined): ref is string => ref !== undefined && tree.has(ref);
  assertDistinctBobBasenames(graphics.bindings.map((b) => b.shadowBmd).filter(convertible));
  const seen = new Set<string>();
  const done: string[] = [];
  for (const binding of graphics.bindings) {
    const shadowBmd = binding.shadowBmd;
    if (shadowBmd === undefined || seen.has(shadowBmd)) continue;
    seen.add(shadowBmd);
    const source = tree.get(shadowBmd);
    if (source === undefined) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: not found in any source layer`);
      continue;
    }
    if (!/\.bmd$/i.test(source.rel)) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: source has no .bmd extension`);
      continue;
    }
    try {
      const atlas = packShadowBobAtlas(decodeBmd(await readFile(source.path)));
      const { png } = await writeSourceBobAtlas(outDir, source.rel, SHADOW_ATLAS_SUFFIX, atlas);
      done.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: ${errorMessage(err)}`);
    }
  }
  return done;
}
