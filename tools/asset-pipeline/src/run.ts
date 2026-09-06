import { type Vfs, vjoin } from '@open-northland/vfs';
import type { Args } from './args.js';
import { decodePng } from './decoders/png.js';
import { errorMessage } from './errors.js';
import { clearPipelineManifest, PIPELINE_MANIFEST_NAME, writePipelineManifest } from './manifest.js';
import type { PipelineProgress } from './progress.js';
import { resolveModRoot, type SourceRoots, withArchiveLayer } from './roots.js';
import { convertBmdTree, convertShadowBmdTree, resolveGraphicsBindings } from './stages/bmd/index.js';
import { TEXTURES_DIR } from './stages/content-tree.js';
import { convertFontStage } from './stages/fonts.js';
import { convertGoodsStage } from './stages/goods/index.js';
import { convertGuiStage } from './stages/gui/index.js';
import { HYPERTEXT_PICTURES_DIR } from './stages/gui/paths.js';
import { writeIr } from './stages/ir/index.js';
import { unpackLibTree } from './stages/lib.js';
import { convertMapDatTree, createMinimapSynthesizer } from './stages/maps/index.js';
import { renderMusicStage } from './stages/music/index.js';
import { composeMaskedTransitionPages, convertPcxTree } from './stages/pcx.js';
import {
  convertGuidepostPlayerAtlases,
  convertIndexedCharacterAtlases,
  convertPlayerColorLut,
} from './stages/player-colors.js';
import { indexSourceAssets } from './stages/source-files.js';

/**
 * Runs the full conversion of an owned game copy into the IR under `args.out`, shared by the CLI and
 * the desktop shell's first-run installer. `progress` is optional live-UI telemetry.
 */
export async function runPipeline(fs: Vfs, args: Args, progress?: PipelineProgress): Promise<void> {
  const roots: SourceRoots = {
    game: args.game,
    mod: await resolveModRoot(fs, args.game, args.modRoot),
    modVersion: args.modVersion,
  };
  console.log(`[pipeline] game=${args.game} mod=${roots.mod} out=${args.out}`);

  await clearPipelineManifest(fs, args.out);
  // The archive layer resolves against this directory, so it must exist even when the unpack writes
  // nothing (a copy that ships no `.lib`).
  await fs.mkdir(args.out);

  // Stages run in dependency order. Sources resolve mod .ini over base .cif; docs/SOURCES.md carries
  // the full source-to-decoder map. The unpack writes loose .pcx/.bmd/.cif copies into gitignored <out>.
  progress?.stage?.('unpack');
  const extracted = await unpackLibTree(fs, roots, args.out, progress?.item);
  console.log(`[pipeline] lib unpack: extracted ${extracted.length} member(s) into ${args.out}`);

  // The unpack above is this layer's precondition; <game> == <out> is not a supported invocation.
  const sources = withArchiveLayer(roots, args.out);

  progress?.stage?.('pictures');
  const pictures = await convertPcxTree(fs, sources, args.out, progress?.item);
  console.log(`[pipeline] pcx -> png: converted ${pictures.length} picture(s) into ${args.out}`);

  progress?.stage?.('atlases');
  const graphics = await resolveGraphicsBindings(fs, roots);
  const assets = await indexSourceAssets(fs, sources);
  const atlases = await convertBmdTree(fs, graphics, args.out, assets, progress?.item);
  const { bindings, palettes } = graphics;
  const distinct = new Set(atlases.map((a) => a.png)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  const shadowAtlases = await convertShadowBmdTree(fs, graphics, args.out, assets);
  console.log(
    `[pipeline] shadow bmd -> atlas: ${shadowAtlases.length} shadow atlas file(s) into ${args.out}`,
  );

  progress?.stage?.('player-colors');
  const indexed = await convertIndexedCharacterAtlases(fs, bindings, args.out, assets);
  const lut = await convertPlayerColorLut(fs, roots, args.out, assets).catch((err: unknown) => {
    console.warn(`[pipeline] player-colour LUT skipped: ${errorMessage(err)}`);
    return undefined;
  });
  const guideAtlases = await convertGuidepostPlayerAtlases(fs, args.out, assets).catch((err: unknown) => {
    console.warn(`[pipeline] guidepost player atlases skipped: ${errorMessage(err)}`);
    return 0;
  });
  console.log(
    `[pipeline] player colours: ${indexed.length} indexed character atlas(es)` +
      `${lut ? `, ${lut.colors}-colour ×${lut.armorTiers}-tier LUT -> ${lut.png}` : ' (LUT skipped)'}` +
      `, ${guideAtlases} guidepost player atlas(es)`,
  );

  progress?.stage?.('gui');
  // The history book and every map briefing write content-addressed pictures here, so the reset
  // belongs to the run: neither stage owns the directory alone.
  await fs.rm(vjoin(args.out, HYPERTEXT_PICTURES_DIR));
  const gui = await convertGuiStage(fs, roots, args.out);
  console.log(
    `[pipeline] gui: ${gui.atlases} atlas(es) (${gui.frames} frames), ${gui.palettes}-palette LUT, ` +
      `${gui.strings.map((s) => `${s.lang}:${s.tables}t/${s.strings}s`).join(' ') || 'no strings'}, ` +
      `${gui.history.map((h) => `${h.lang}:${h.pages}p`).join(' ') || 'no history'}, ` +
      `${gui.cursors} cursor(s) into ${vjoin(args.out, 'gui')}`,
  );

  progress?.stage?.('fonts');
  const fonts = await convertFontStage(fs, roots, args.out);
  console.log(
    `[pipeline] fonts: ${fonts.fonts} font(s) (${fonts.glyphs} glyphs), ` +
      `${fonts.colors}-colour LUT into ${vjoin(args.out, 'gui', 'fonts')}`,
  );

  progress?.stage?.('goods');
  const goods = await convertGoodsStage(fs, roots, args.out);
  console.log(
    `[pipeline] goods: ${goods.frames}-frame atlas, ${goods.palettes}-palette LUT, ` +
      `${goods.icons} good icon(s) into ${vjoin(args.out, 'goods')}`,
  );

  progress?.stage?.('ir');
  const ir = await writeIr(fs, roots, args.out);
  console.log(
    `[pipeline] ini -> ir: ${ir.goods.length} goods, ${ir.jobs.length} jobs, ${ir.jobExperience.length} job-xp tracks, ` +
      `${ir.buildings.length} buildings, ` +
      `${ir.weapons.length} weapons, ${ir.armor.length} armor, ${ir.animals.length} animals, ${ir.vehicles.length} vehicles, ${ir.landscape.length} landscape, ` +
      `${ir.tribes.length} tribes, ${ir.atomicAnimations.length} atomic animations, ${ir.bobSequences.length} bob-sequence sets, ${ir.buildingBobs.length} building bobs, ${ir.maps.length} maps, ` +
      `${ir.gatheringPipeline.length} gathering pipelines ` +
      `-> ${vjoin(args.out, 'ir.json')}`,
  );

  // Needs the extracted `[transition]` table, hence after writeIr.
  progress?.stage?.('transitions');
  const maskedPairs = ir.gfxPatternTransitions.flatMap((t) =>
    t.texture !== undefined && t.textureAlpha !== undefined
      ? [{ texture: t.texture, textureAlpha: t.textureAlpha }]
      : [],
  );
  const masked = await composeMaskedTransitionPages(fs, sources, args.out, maskedPairs);
  console.log(
    `[pipeline] transitions: ${ir.gfxPatternTransitions.length} record(s) -> ` +
      `${masked.length} masked overlay page(s) into ${args.out}`,
  );

  // Synthesizing a missing minimap reads back the `text_NNN` pages the pictures stage emitted above.
  progress?.stage?.('maps');
  const texturesDir = vjoin(args.out, TEXTURES_DIR);
  const synthesizeMinimap = createMinimapSynthesizer({
    gfxPatterns: ir.gfxPatterns,
    terrainPatterns: ir.terrainPatterns,
    readPage: async (pageKey) => {
      try {
        return await decodePng(await fs.readFile(vjoin(texturesDir, `${pageKey}.png`)));
      } catch {
        return null;
      }
    },
  });
  const terrains = await convertMapDatTree(fs, roots, args.out, progress?.item, synthesizeMinimap);
  const totalCells = terrains.reduce((sum, t) => sum + t.width * t.height, 0);
  const minimaps = terrains.filter((t) => t.minimap).length;
  const synthesized = terrains.filter((t) => t.minimapSynthesized).length;
  const scripts = terrains.filter((t) => t.script).length;
  const briefings = terrains.filter((t) => t.briefing).length;
  const stringTables = terrains.filter((t) => t.strings).length;
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total, ${minimaps} minimap(s) ` +
      `of which ${synthesized} synthesized, ${scripts} script sidecar(s), ${stringTables} string ` +
      `table(s), ${briefings} briefing sidecar(s)) into ${vjoin(args.out, 'maps')}`,
  );

  progress?.stage?.('music');
  const music = await renderMusicStage(fs, roots, args.out, progress?.item);
  console.log(
    music.skipped !== undefined
      ? `[pipeline] music skipped: ${music.skipped}`
      : `[pipeline] music: ${music.rendered} rendered, ${music.kept} kept, ${music.failed} failed ` +
          `into ${vjoin(args.out, 'music')}`,
  );

  // Stamped last: its presence is what marks a conversion that ran to completion.
  await writePipelineManifest(fs, args.out);
  console.log(`[pipeline] stamped ${vjoin(args.out, PIPELINE_MANIFEST_NAME)}`);
}
