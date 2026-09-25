import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Args } from './args.js';
import { decodePng } from './decoders/png.js';
import { errorMessage } from './errors.js';
import { resolveModRoot, type SourceRoots } from './roots.js';
import {
  convertBmdTree,
  convertEffectBmdTree,
  convertShadowBmdTree,
  resolveGraphicsBindings,
} from './stages/bmd/index.js';
import { MAPS_DIR, SOUNDS_DIR, TEXTURES_DIR } from './stages/content-tree.js';
import { convertFontStage } from './stages/fonts.js';
import { convertGoodsStage } from './stages/goods/index.js';
import { convertGuiStage } from './stages/gui/index.js';
import { HYPERTEXT_PICTURES_DIR } from './stages/gui/paths.js';
import { writeIr } from './stages/ir/index.js';
import { loadVehicleGraphicsBindings } from './stages/ir/vehicle-graphics.js';
import { BOBS_INDEX_FILE, MAPS_INDEX_FILE, writeListings } from './stages/listings.js';
import { convertMapDatTree, createMinimapSynthesizer } from './stages/maps/index.js';
import { renderMusicStage } from './stages/music/index.js';
import { composeMaskedTransitionPages, convertPcxTree } from './stages/pcx.js';
import {
  convertGuidepostPlayerAtlases,
  convertIndexedCharacterAtlases,
  convertPlayerColorLut,
} from './stages/player-colors.js';
import { copySoundTree } from './stages/sounds.js';
import { indexSourceAssets } from './stages/source-files.js';
import { convertVehiclePaletteFamilies } from './stages/vehicle-colors.js';
import { convertVertexPalette, VERTEX_PALETTE_FILE } from './stages/vertex-palette.js';

/** Runs the full conversion of the mod root into the IR under `args.out`. */
export async function runPipeline(args: Args): Promise<void> {
  const roots: SourceRoots = { mod: await resolveModRoot(args.modRoot) };
  console.log(`[pipeline] mod=${roots.mod} out=${args.out}`);

  await mkdir(args.out, { recursive: true });

  // Stages run in dependency order. Sources resolve mod .ini over base .cif; docs/DATA-FORMAT.md carries
  // the format-to-decoder map.
  const pictures = await convertPcxTree(roots, args.out);
  console.log(`[pipeline] pcx -> png: converted ${pictures.length} picture(s) into ${args.out}`);
  const vertexPalette = await convertVertexPalette(roots, args.out);
  console.log(
    `[pipeline] vertex palette: ${vertexPalette.length} entries -> ${join(args.out, VERTEX_PALETTE_FILE)}`,
  );

  const graphics = await resolveGraphicsBindings(roots);
  const assets = await indexSourceAssets(roots);
  const atlases = await convertBmdTree(graphics, args.out, assets);
  const { bindings, palettes } = graphics;
  const distinct = new Set(atlases.map((a) => a.png)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  const shadowAtlases = await convertShadowBmdTree(graphics, args.out, assets);
  console.log(
    `[pipeline] shadow bmd -> atlas: ${shadowAtlases.length} shadow atlas file(s) into ${args.out}`,
  );

  const indexed = await convertIndexedCharacterAtlases(bindings, args.out, assets);
  const lut = await convertPlayerColorLut(roots, args.out, assets).catch((err: unknown) => {
    console.warn(`[pipeline] player-colour LUT skipped: ${errorMessage(err)}`);
    return undefined;
  });
  const guideAtlases = await convertGuidepostPlayerAtlases(args.out, assets).catch((err: unknown) => {
    console.warn(`[pipeline] guidepost player atlases skipped: ${errorMessage(err)}`);
    return 0;
  });
  const vehicleColors = await convertVehiclePaletteFamilies(
    (await loadVehicleGraphicsBindings(roots)).map((row) => row.binding),
    palettes,
    args.out,
    assets,
  );
  console.log(
    `[pipeline] player colours: ${indexed.length} indexed character atlas(es)` +
      `${lut ? `, ${lut.colors}-colour ×${lut.blocks}-block + head LUT -> ${lut.png}` : ' (LUT skipped)'}` +
      `, ${guideAtlases} guidepost player atlas(es)` +
      `, ${vehicleColors.indexed.length} indexed vehicle atlas(es) over ${vehicleColors.luts.length} palette family LUT(s)`,
  );

  // The history book and every map briefing write content-addressed pictures here, so the reset
  // belongs to the run: neither stage owns the directory alone.
  await rm(join(args.out, HYPERTEXT_PICTURES_DIR), { recursive: true, force: true });
  const gui = await convertGuiStage(roots, args.out);
  console.log(
    `[pipeline] gui: ${gui.atlases} atlas(es) (${gui.frames} frames), ${gui.palettes}-palette LUT, ` +
      `${gui.strings.map((s) => `${s.lang}:${s.tables}t/${s.strings}s`).join(' ') || 'no strings'}, ` +
      `${gui.history.map((h) => `${h.lang}:${h.pages}p`).join(' ') || 'no history'}, ` +
      `${gui.cursors} cursor(s) into ${join(args.out, 'gui')}`,
  );

  const fonts = await convertFontStage(roots, args.out);
  console.log(
    `[pipeline] fonts: ${fonts.fonts} font(s) (${fonts.glyphs} glyphs), ` +
      `${fonts.colors}-colour LUT into ${join(args.out, 'gui', 'fonts')}`,
  );

  const goods = await convertGoodsStage(roots, args.out);
  console.log(
    `[pipeline] goods: ${goods.frames}-frame atlas, ${goods.palettes}-palette LUT, ` +
      `${goods.icons} good icon(s) into ${join(args.out, 'goods')}`,
  );

  const sounds = await copySoundTree(roots, args.out);
  console.log(`[pipeline] sounds: ${sounds.length} wav(s) into ${join(args.out, SOUNDS_DIR)}`);

  const ir = await writeIr(roots, args.out);
  console.log(
    `[pipeline] ini -> ir: ${ir.goods.length} goods, ${ir.jobs.length} jobs, ${ir.jobExperience.length} job-xp tracks, ` +
      `${ir.buildings.length} buildings, ` +
      `${ir.weapons.length} weapons, ${ir.armor.length} armor, ${ir.animals.length} animals, ${ir.vehicles.length} vehicles, ${ir.landscape.length} landscape, ` +
      `${ir.tribes.length} tribes, ${ir.atomicAnimations.length} atomic animations, ${ir.bobSequences.length} bob-sequence sets, ${ir.buildingBobs.length} building bobs, ${ir.maps.length} maps, ` +
      `${ir.gatheringPipeline.length} gathering pipelines ` +
      `-> ${join(args.out, 'ir.json')}`,
  );

  // Needs the extracted `GfxUserFXMatrix` flags, hence after writeIr.
  const effectAtlases = await convertEffectBmdTree(ir.landscapeGfx, args.out, assets);
  console.log(`[pipeline] effect bmd -> atlas: ${effectAtlases.length} indexed effect atlas(es)`);

  // Needs the extracted `[transition]` table, hence after writeIr.
  const maskedPairs = ir.gfxPatternTransitions.flatMap((t) =>
    t.texture !== undefined && t.textureAlpha !== undefined
      ? [{ texture: t.texture, textureAlpha: t.textureAlpha }]
      : [],
  );
  const masked = await composeMaskedTransitionPages(roots, args.out, maskedPairs);
  console.log(
    `[pipeline] transitions: ${ir.gfxPatternTransitions.length} record(s) -> ` +
      `${masked.length} masked overlay page(s) into ${args.out}`,
  );

  // Synthesizing a missing minimap reads back the `text_NNN` pages the pictures stage emitted above.
  const texturesDir = join(args.out, TEXTURES_DIR);
  const synthesizeMinimap = createMinimapSynthesizer({
    gfxPatterns: ir.gfxPatterns,
    terrainPatterns: ir.terrainPatterns,
    readPage: async (pageKey) => {
      try {
        return await decodePng(await readFile(join(texturesDir, `${pageKey}.png`)));
      } catch {
        return null;
      }
    },
  });
  const terrains = await convertMapDatTree(roots, args.out, synthesizeMinimap);
  const totalCells = terrains.reduce((sum, t) => sum + t.width * t.height, 0);
  const minimaps = terrains.filter((t) => t.minimap).length;
  const synthesized = terrains.filter((t) => t.minimapSynthesized).length;
  const scripts = terrains.filter((t) => t.script !== undefined).length;
  const briefings = terrains.filter((t) => t.briefing).length;
  const stringTables = terrains.filter((t) => t.strings).length;
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total, ${minimaps} minimap(s) ` +
      `of which ${synthesized} synthesized, ${scripts} script sidecar(s), ${stringTables} string ` +
      `table(s), ${briefings} briefing sidecar(s)) into ${join(args.out, MAPS_DIR)}`,
  );

  const music = await renderMusicStage(roots, args.out);
  console.log(
    music.skipped !== undefined
      ? `[pipeline] music skipped: ${music.skipped}`
      : `[pipeline] music: ${music.rendered} rendered, ${music.kept} kept, ${music.failed} failed ` +
          `into ${join(args.out, 'music')}`,
  );

  // Last, so the bobs listing sees every atlas the stages above wrote.
  await writeListings(args.out, terrains);
  console.log(`[pipeline] listings: ${MAPS_INDEX_FILE}, ${BOBS_INDEX_FILE} into ${args.out}`);
}
