import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packIndexedBobAtlas } from '../decoders/atlas/index.js';
import { decodeBmd } from '../decoders/bmd/index.js';
import { buildPaletteLutImage } from '../decoders/image.js';
import { type PaletteAlias, paletteAliasMap, type VehicleGraphicsBinding } from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import { writeFileWithParents } from '../files.js';
import { BOBS_DIR, writeSourceBobAtlas } from './content-tree.js';
import { paletteFamily } from './ir/vehicle-graphics.js';
import type { SourceAssetIndex } from './source-files.js';

/** What the stage emitted: the indexed body atlases and one LUT per palette family. */
export interface VehicleColorResult {
  readonly indexed: readonly string[];
  readonly luts: readonly string[];
}

/** The served LUT of a palette family, named after the family's first member (`human_ship01.lut.png`);
 *  a string contract with the app's vehicle sheet loader. */
export function paletteFamilyLutFile(bodyPalette: string): string {
  return `${BOBS_DIR}/${bodyPalette}.lut.png`;
}

/**
 * For every vehicle body whose palette starts a numbered family (the ships' `human_ship01..10`), emits
 * the body as an indexed atlas (`<bmd-basename>.indexed`) plus the family as a `256 x members` LUT, row
 * `n` the family's member `n + 1`, so one atlas draws every owner. A missing or unreadable source skips
 * that body or family with a warning; the baked first-member atlas stays the fallback.
 */
export async function convertVehiclePaletteFamilies(
  bindings: readonly Pick<VehicleGraphicsBinding, 'bmd' | 'paletteName'>[],
  palettes: readonly PaletteAlias[],
  outDir: string,
  tree: SourceAssetIndex,
): Promise<VehicleColorResult> {
  const aliases = paletteAliasMap(palettes);
  const lutByFamily = new Map<string, string | undefined>();
  const bodies = new Set<string>();
  for (const binding of bindings) {
    const family = paletteFamily(binding.paletteName, palettes);
    if (family === undefined) continue;
    if (!lutByFamily.has(binding.paletteName)) {
      lutByFamily.set(
        binding.paletteName,
        await writeFamilyLut(binding.paletteName, family, aliases, outDir, tree),
      );
    }
    if (lutByFamily.get(binding.paletteName) !== undefined) bodies.add(binding.bmd);
  }
  const indexed: string[] = [];
  for (const bmdRef of bodies) {
    const source = tree.get(bmdRef);
    if (source === undefined) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: not found in any source layer`);
      continue;
    }
    try {
      const atlas = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
      const { png } = await writeSourceBobAtlas(outDir, source.rel, 'indexed', atlas);
      indexed.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return { indexed, luts: [...lutByFamily.values()].filter((png) => png !== undefined) };
}

/** The family's LUT path, or `undefined` (with a warning) when a member palette is unreadable. */
async function writeFamilyLut(
  bodyPalette: string,
  family: readonly string[],
  aliases: ReadonlyMap<string, string>,
  outDir: string,
  tree: SourceAssetIndex,
): Promise<string | undefined> {
  try {
    const rows = await Promise.all(family.map((name) => readFamilyPalette(name, aliases, tree)));
    const png = paletteFamilyLutFile(bodyPalette);
    await writeFileWithParents(join(outDir, png), await encodePng(buildPaletteLutImage(rows)));
    return png;
  } catch (err) {
    console.warn(`[pipeline] skipped palette family ${bodyPalette}: ${errorMessage(err)}`);
    return undefined;
  }
}

async function readFamilyPalette(
  name: string,
  aliases: ReadonlyMap<string, string>,
  tree: SourceAssetIndex,
): Promise<Uint8Array> {
  const file = aliases.get(name);
  const source = file === undefined ? undefined : tree.get(file);
  if (source === undefined) throw new Error(`palette ${name} not found in any source layer`);
  const palette = decodePcx(await readFile(source.path)).palette;
  if (palette === undefined) throw new Error(`palette ${name} has no 256-colour trailer`);
  return palette;
}
