import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BOB_ATLASES_PATH } from '@open-northland/data';
import { decodePng } from '@open-northland/formats/png';
import { loadTranslationOverlays } from '@open-northland/translations';
import type { Args } from './args.js';
import { CORRECTIONS_DIR, loadSourceCorrections } from './corrections.js';
import { errorMessage } from './errors.js';
import { resolveDataPack, type SourceRoots } from './roots.js';
import {
  convertBmdTree,
  convertEffectBmdTree,
  convertShadowBmdTree,
  domPictureStems,
  resolveGraphicsBindings,
} from './stages/bmd/index.js';
import { CAMPAIGNS_DIR, convertCampaignStage } from './stages/campaigns.js';
import { BOBS_DIR, BobAtlasCatalog, MAPS_DIR, SOUNDS_DIR, TEXTURES_DIR } from './stages/content-tree.js';
import { convertGoodsStage } from './stages/goods/index.js';
import { convertGuiStage } from './stages/gui/index.js';
import { HYPERTEXT_PICTURES_DIR } from './stages/gui/paths.js';
import { writeIr } from './stages/ir/index.js';
import { loadVehicleGraphicsBindings } from './stages/ir/vehicle-graphics.js';
import { BOBS_INDEX_FILE, CAMPAIGNS_INDEX_FILE, MAPS_INDEX_FILE, writeListings } from './stages/listings.js';
import { assertStaticVerbsKnown, convertMapDatTree, summarizeMapOverlays } from './stages/maps/index.js';
import { createMinimapSynthesizer } from './stages/maps/synth-minimap.js';
import { renderMusicStage } from './stages/music/index.js';
import { composeMaskedTransitionPages, convertPcxTree } from './stages/pcx.js';
import {
  convertIndexedCharacterAtlases,
  convertPlayerPaletteAtlases,
  convertSignPlayerAtlases,
  ownerPaletteBmds,
} from './stages/player-colors.js';
import { convertSoundTree, loopedBedClips } from './stages/sounds/index.js';
import { indexSourceAssets } from './stages/source-files.js';
import { convertVehiclePaletteFamilies } from './stages/vehicle-colors.js';
import { convertVertexPalette, VERTEX_PALETTE_FILE } from './stages/vertex-palette.js';
import {
  loadMapStringCorrections,
  loadStringCorrections,
  MAP_STRING_CORRECTIONS_FILE,
  STRING_CORRECTIONS_FILE,
} from './string-corrections.js';

/** Runs the full conversion of the base data root into the IR under `args.out`. */
export async function runPipeline(args: Args): Promise<void> {
  const pack = await resolveDataPack(args.dataRoot);
  const data = pack.base;
  const corrections = await loadSourceCorrections(CORRECTIONS_DIR, data);
  const stringCorrections = await loadStringCorrections(STRING_CORRECTIONS_FILE);
  const mapStringCorrections = await loadMapStringCorrections(MAP_STRING_CORRECTIONS_FILE);
  const overlays = await loadTranslationOverlays();
  const roots: SourceRoots = { data, corrections, stringCorrections, mapStringCorrections, overlays };
  console.log(`[pipeline] data=${roots.data} out=${args.out}`);
  for (const { id, file } of corrections.list) console.log(`[pipeline] correction ${id}: ${file}`);
  console.log(
    `[pipeline] translations: overlays for ${overlays.maps.size} map(s); object tables, books and campaign ` +
      `titles in ${overlays.objects.size}, ${overlays.books.size} and ${overlays.campaigns.size} language(s)`,
  );

  await mkdir(args.out, { recursive: true });

  // Stages run in dependency order. Sources resolve mod .ini over base .cif; docs/DATA-FORMAT.md carries
  // the format-to-decoder map.
  const pictures = await convertPcxTree(roots, args.out);
  console.log(`[pipeline] pcx -> png: converted ${pictures.length} picture(s) into ${args.out}`);
  const vertexPalette = await convertVertexPalette(roots, args.out);
  console.log(
    `[pipeline] vertex palette: ${vertexPalette.length} entries -> ${join(args.out, VERTEX_PALETTE_FILE)}`,
  );

  const ir = await writeIr(roots, args.out);
  console.log(
    `[pipeline] ini -> ir: ${ir.goods.length} goods, ${ir.jobs.length} jobs, ${ir.jobExperience.length} job-xp tracks, ` +
      `${ir.buildings.length} buildings, ` +
      `${ir.weapons.length} weapons, ${ir.armor.length} armor, ${ir.animals.length} animals, ${ir.vehicles.length} vehicles, ${ir.landscape.length} landscape, ` +
      `${ir.tribes.length} tribes, ${ir.atomicAnimations.length} atomic animations, ${ir.bobSequences.length} bob-sequence sets, ${ir.buildingBobs.length} building bobs, ${ir.maps.length} maps, ` +
      `${ir.gatheringPipeline.length} gathering pipelines, ` +
      `${ir.humanPalettes.recipes.length} human palette recipes over ${Object.keys(ir.humanPalettes.ramps).length} ramps ` +
      `-> ${join(args.out, 'ir.json')}`,
  );

  const graphics = await resolveGraphicsBindings(roots);
  const assets = await indexSourceAssets(roots);
  // Every atlas stage writes content-addressed sheets here and skips a name already present, so the
  // reset belongs to the run.
  await rm(join(args.out, BOBS_DIR), { recursive: true, force: true });
  const bobAtlases = new BobAtlasCatalog(args.out);
  // The IR rows name the stems the app's DOM shows, which keep RGB sheets.
  const atlases = await convertBmdTree(
    graphics,
    bobAtlases,
    assets,
    domPictureStems(ir, graphics.bindings),
    ir.bobSequences,
  );
  const { bindings, palettes } = graphics;
  const distinct = new Set(atlases.map((a) => a.image)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  const shadowAtlases = await convertShadowBmdTree(graphics, bobAtlases, assets);
  console.log(
    `[pipeline] shadow bmd -> atlas: ${shadowAtlases.length} shadow atlas file(s) into ${args.out}`,
  );

  const indexed = await convertIndexedCharacterAtlases(bindings, bobAtlases, assets, ir.bobSequences);
  const ownerAtlases = await convertPlayerPaletteAtlases(ownerPaletteBmds(ir), bobAtlases, assets).catch(
    (err: unknown) => {
      console.warn(`[pipeline] player palette atlases skipped: ${errorMessage(err)}`);
      return 0;
    },
  );
  const signAtlases = await convertSignPlayerAtlases(bobAtlases, assets).catch((err: unknown) => {
    console.warn(`[pipeline] sign player atlases skipped: ${errorMessage(err)}`);
    return 0;
  });
  const vehicleColors = await convertVehiclePaletteFamilies(
    (await loadVehicleGraphicsBindings(roots)).map((row) => row.binding),
    palettes,
    bobAtlases,
    assets,
  );
  console.log(
    `[pipeline] player colours: ${indexed.length} indexed character atlas(es)` +
      `, ${ownerAtlases} owner palette atlas(es)` +
      `, ${signAtlases} synthetic sign atlas(es)` +
      `, ${vehicleColors.indexed.length} indexed vehicle atlas(es) over ${vehicleColors.luts.length} palette family LUT(s)`,
  );

  // The history book and every map briefing write content-addressed pictures here, so the reset
  // belongs to the run: neither stage owns the directory alone.
  await rm(join(args.out, HYPERTEXT_PICTURES_DIR), { recursive: true, force: true });
  const gui = await convertGuiStage(roots, args.out, bobAtlases);
  console.log(
    `[pipeline] gui: ${gui.atlases} atlas(es) (${gui.frames} frames), ${gui.palettes}-palette LUT, ` +
      `${gui.strings.map((s) => `${s.lang}:${s.tables}t/${s.strings}s`).join(' ') || 'no strings'}, ` +
      `${gui.history.map((h) => `${h.lang}:${h.pages}p`).join(' ') || 'no history'}, ` +
      `${gui.help.map((h) => `${h.lang}:${h.strings}h`).join(' ') || 'no help'}, ` +
      `${gui.cursors} cursor(s) into ${join(args.out, 'gui')}`,
  );

  const goods = await convertGoodsStage(roots, args.out, bobAtlases);
  console.log(
    `[pipeline] goods: ${goods.frames}-frame atlas, ${goods.palettes}-palette LUT, ` +
      `${goods.icons} good icon(s) into ${join(args.out, 'goods')}`,
  );

  const sounds = await convertSoundTree(roots, args.out, loopedBedClips(ir.sounds));
  console.log(
    `[pipeline] sounds: ${sounds.clips} clip(s) in ${sounds.banks} bank(s), ` +
      `${sounds.bytes.lossless} lossless / ${sounds.bytes.compact} compact byte(s) into ${join(args.out, SOUNDS_DIR)}`,
  );

  // Needs the extracted `GfxUserFXMatrix` flags, hence after writeIr.
  const effectAtlases = await convertEffectBmdTree(ir.landscapeGfx, bobAtlases, assets);
  console.log(`[pipeline] effect bmd -> atlas: ${effectAtlases.length} indexed effect atlas(es)`);
  await bobAtlases.writeDocument();
  console.log(`[pipeline] atlas manifests -> ${join(args.out, BOB_ATLASES_PATH)}`);

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

  // Synthesizing a minimap reads back the `text_NNN` pages the pictures stage emitted above.
  const texturesDir = join(args.out, TEXTURES_DIR);
  const synthesizeMinimap = createMinimapSynthesizer({
    gfxPatterns: ir.gfxPatterns,
    terrainPatterns: ir.terrainPatterns,
    landscapeGfx: ir.landscapeGfx,
    gatheringPipeline: ir.gatheringPipeline,
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
  const mapPictures = terrains.filter((t) => t.picture).length;
  const minimaps = terrains.filter((t) => t.minimap).length;
  const scripts = terrains.filter((t) => t.script !== undefined).length;
  const briefings = terrains.filter((t) => t.briefing).length;
  const stringTables = terrains.filter((t) => t.strings).length;
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total, ${mapPictures} picture(s), ${minimaps} minimap(s), ${scripts} script sidecar(s), ${stringTables} string ` +
      `table(s), ${briefings} briefing sidecar(s)) into ${join(args.out, MAPS_DIR)}`,
  );

  // After the base maps: that stage resets `maps/`, and a campaign map must not reuse a base map's id.
  const campaigns = await convertCampaignStage(
    roots,
    pack.root,
    pack.campaigns,
    args.out,
    new Set(terrains.map((map) => map.id)),
    synthesizeMinimap,
  );
  console.log(
    `[pipeline] campaigns: ${campaigns.index.campaigns.length} campaign(s), ${campaigns.maps.length} map(s) ` +
      `into ${join(args.out, MAPS_DIR)} and ${join(args.out, CAMPAIGNS_DIR)}`,
  );

  const music = await renderMusicStage(roots, args.out);
  console.log(
    music.skipped !== undefined
      ? `[pipeline] music skipped: ${music.skipped}`
      : `[pipeline] music: ${music.rendered} rendered, ${music.kept} kept, ${music.failed} failed ` +
          `into ${join(args.out, 'music')}`,
  );

  // Last, so the bobs listing sees every sheet the stages above wrote.
  await writeListings(args.out, [...terrains, ...campaigns.maps], campaigns.index);
  console.log(
    `[pipeline] listings: ${MAPS_INDEX_FILE}, ${BOBS_INDEX_FILE}, ${CAMPAIGNS_INDEX_FILE} into ${args.out}`,
  );

  corrections.assertApplied();
  stringCorrections.assertApplied();
  mapStringCorrections.assertApplied();
  console.log(
    `[pipeline] corrections: ${corrections.list.length} file(s), ${stringCorrections.list.length} string(s), ` +
      `${mapStringCorrections.list.length} map string(s) applied`,
  );
  console.log(
    `[pipeline] translations: ${summarizeMapOverlays([...terrains, ...campaigns.maps], new Set(overlays.maps.keys()))}; ` +
      `campaign languages ${campaigns.index.campaigns.map((c) => `${c.id}:${c.languages.join('+')}`).join(' ') || 'none'}`,
  );
  assertStaticVerbsKnown([...terrains, ...campaigns.maps]);
}
