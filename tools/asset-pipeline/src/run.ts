import { join } from 'node:path';
import type { Args } from './args.js';
import { PIPELINE_MANIFEST_NAME, writePipelineManifest } from './manifest.js';
import type { PipelineProgress } from './progress.js';
import { convertBmdTree, convertShadowBmdTree, resolveGraphicsBindings } from './stages/bmd/index.js';
import { convertFontStage } from './stages/fonts.js';
import { convertGoodsStage } from './stages/goods/index.js';
import { convertGuiStage } from './stages/gui/index.js';
import { writeIr } from './stages/ir/index.js';
import { unpackLibTree } from './stages/lib.js';
import { convertMapDatTree } from './stages/maps/index.js';
import { composeMaskedTransitionPages, convertPcxTree } from './stages/pcx.js';
import {
  convertGuidepostPlayerAtlases,
  convertIndexedCharacterAtlases,
  convertPlayerColorLut,
} from './stages/player-colors.js';

/**
 * Runs the full conversion of an owned game copy into the IR under `args.out` — the one pipeline
 * entry both hosts share (the CLI in `cli.ts`, the desktop shell's first-run installer). `progress`
 * feeds a live UI (see `progress.ts`); the stage summary `console.log`s stay for the CLI transcript.
 */
export async function runPipeline(args: Args, progress?: PipelineProgress): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stages run in dependency order — unpack first, then the passes that read its output. Prefer the
  // mod's readable .ini sources over base .cif; docs/SOURCES.md carries the full source → decoder map.
  // The unpack extracts loose copies of the embedded .pcx/.bmd/.cif into <out> (gitignored).
  progress?.stage?.('unpack');
  const extracted = await unpackLibTree(args.game, args.out, progress?.item);
  console.log(`[pipeline] lib unpack: extracted ${extracted.length} member(s) into ${args.out}`);

  // Convert .pcx -> .png from both trees: the original --game tree (loose pictures shipped as files)
  // mirrored into <out>, and the unpacked <out> tree itself (the .pcx the unpack stage just extracted
  // from data0001.lib, converted in place to a .png sibling). The two roots are disjoint sources, so a
  // picture is converted exactly once per location it exists; <game>==<out> is not a supported invocation.
  progress?.stage?.('pictures');
  const loosePictures = await convertPcxTree(args.game, args.out, progress?.item);
  const embeddedPictures = await convertPcxTree(
    args.out,
    args.out,
    progress?.item === undefined ? undefined : (done) => progress.item?.(loosePictures.length + done),
  );
  const pictures = loosePictures.length + embeddedPictures.length;
  console.log(
    `[pipeline] pcx -> png: converted ${pictures} picture(s) into ${args.out} ` +
      `(${loosePictures.length} loose, ${embeddedPictures.length} embedded)`,
  );

  // Convert every (bmd, palette) graphics binding (resolved by resolveGraphicsBindings) to an atlas PNG +
  // manifest JSON. A binding names its palette by editname, which palettes.ini resolves to the .pcx whose
  // trailer colours the bobs; both the .bmd and .pcx are read from the just-unpacked <out> tree.
  progress?.stage?.('atlases');
  const graphics = await resolveGraphicsBindings(args.game, args.mod);
  const atlases = await convertBmdTree(graphics, args.out, progress?.item);
  const { bindings, palettes } = graphics;
  // Atlases are named per (bmd, palette), so the log reports both the distinct atlas files and the
  // distinct body .bmd geometries behind them — the gap is the per-creature recolour fan-out.
  const distinct = new Set(atlases.map((a) => a.png)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  // Shadow bob sets (the `GfxBobLibs`/`shadowlib` second value): each converts once into a palette-less
  // black translucent-silhouette atlas the renderer draws under its caster (bob ids parallel the body's).
  const shadowAtlases = await convertShadowBmdTree(graphics, args.out);
  console.log(
    `[pipeline] shadow bmd -> atlas: ${shadowAtlases.length} shadow atlas file(s) into ${args.out}`,
  );

  // Player (team) colours: an indexed atlas (palette index in red, mask in alpha) per `cr_hum_*` body/head
  // plus one 256×16 player-colour LUT, so one atlas serves all 16 players (the renderer reads each index
  // through the player's LUT row). See stages/player-colors.ts + packages/render's palette-LUT shader.
  progress?.stage?.('player-colors');
  const indexed = await convertIndexedCharacterAtlases(bindings, args.out);
  const lut = await convertPlayerColorLut(args.out).catch((err: unknown) => {
    console.warn(`[pipeline] player-colour LUT skipped: ${(err as Error).message}`);
    return undefined;
  });
  // Per-player baked guidepost atlases (full player palettes; baked, not indexed, so the guidepost's
  // graded edge alpha survives — see stages/player-colors.ts convertGuidepostPlayerAtlases).
  const guideAtlases = await convertGuidepostPlayerAtlases(args.out).catch((err: unknown) => {
    console.warn(`[pipeline] guidepost player atlases skipped: ${(err as Error).message}`);
    return 0;
  });
  console.log(
    `[pipeline] player colours: ${indexed.length} indexed character atlas(es)` +
      `${lut ? `, ${lut.colors}-colour LUT -> ${lut.png}` : ' (LUT skipped)'}` +
      `, ${guideAtlases} guidepost player atlas(es)`,
  );

  // GUI/HUD: the HUD bob sheets -> indexed + preview atlas + palette LUT, the ingamegui string tables
  // per language -> id->text JSON, and the mouse cursors -> PNG + verbatim .cur. All from loose files.
  // See stages/gui/ + docs/SOURCES.md "GUI".
  progress?.stage?.('gui');
  const gui = await convertGuiStage(args.game, args.out);
  console.log(
    `[pipeline] gui: ${gui.atlases} atlas(es) (${gui.frames} frames), ${gui.palettes}-palette LUT, ` +
      `${gui.strings.map((s) => `${s.lang}:${s.tables}t/${s.strings}s`).join(' ') || 'no strings'}, ` +
      `${gui.cursors} cursor(s) into ${join(args.out, 'gui')}`,
  );

  // Fonts: the UI bitmap fonts (font08/10/12/fontdebug × default/latin/rus) -> an indexed glyph atlas +
  // preview + a 256×4 font-colour LUT + a per-font metrics JSON. See stages/fonts.ts + docs/SOURCES.md ".fnt".
  progress?.stage?.('fonts');
  const fonts = await convertFontStage(args.game, args.out);
  console.log(
    `[pipeline] fonts: ${fonts.fonts} font(s) (${fonts.glyphs} glyphs), ` +
      `${fonts.colors}-colour LUT into ${join(args.out, 'gui', 'fonts')}`,
  );

  // Goods icons: the shared good-pile bob sheet -> an indexed atlas + preview + a goods palette LUT, plus
  // the good -> (pile frame, palette) bindings. Feeds the HUD's per-good resource icons. See stages/goods/.
  progress?.stage?.('goods');
  const goods = await convertGoodsStage(args.game, args.out);
  console.log(
    `[pipeline] goods: ${goods.frames}-frame atlas, ${goods.palettes}-palette LUT, ` +
      `${goods.icons} good icon(s) into ${join(args.out, 'goods')}`,
  );

  progress?.stage?.('ir');
  const ir = await writeIr(args);
  console.log(
    `[pipeline] ini -> ir: ${ir.goods.length} goods, ${ir.jobs.length} jobs, ${ir.jobExperience.length} job-xp tracks, ` +
      `${ir.buildings.length} buildings, ` +
      `${ir.weapons.length} weapons, ${ir.armor.length} armor, ${ir.animals.length} animals, ${ir.vehicles.length} vehicles, ${ir.landscape.length} landscape, ` +
      `${ir.tribes.length} tribes, ${ir.atomicAnimations.length} atomic animations, ${ir.bobSequences.length} bob-sequence sets, ${ir.buildingBobs.length} building bobs, ${ir.maps.length} maps, ` +
      `${ir.gatheringPipeline.length} gathering pipelines ` +
      `-> ${join(args.out, 'ir.json')}`,
  );

  // Compose each ground-transition overlay's RGB texture + alpha-mask .pcx pair into one RGBA
  // `<stem>.masked.png` — the plain per-file pcx pass above can't carry the separate mask, and the
  // renderer alpha-blends these pages over the base ground triangles. Needs the extracted
  // `[transition]` table, hence after writeIr.
  progress?.stage?.('transitions');
  const maskedPairs = ir.gfxPatternTransitions.flatMap((t) =>
    t.texture !== undefined && t.textureAlpha !== undefined
      ? [{ texture: t.texture, textureAlpha: t.textureAlpha }]
      : [],
  );
  const masked = await composeMaskedTransitionPages(args.game, args.out, maskedPairs);
  console.log(
    `[pipeline] transitions: ${ir.gfxPatternTransitions.length} record(s) -> ` +
      `${masked.length} masked overlay page(s) into ${args.out}`,
  );

  // Decode each map's binary terrain grid (map.dat hoix container -> lmlt landscape-type layer -> one
  // per-cell typeId) into maps/<id>.json — the TerrainMap the sim's buildTerrainGraph consumes. Joins
  // onto the same-folder map.cif's MapInfo id.
  progress?.stage?.('maps');
  const terrains = await convertMapDatTree(args.game, args.out, progress?.item);
  const totalCells = terrains.reduce((sum, t) => sum + t.width * t.height, 0);
  const metas = terrains.filter((t) => t.meta).length;
  const minimaps = terrains.filter((t) => t.minimap).length;
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total, ${metas} name/description sidecar(s), ${minimaps} minimap(s)) ` +
      `into ${join(args.out, 'maps')}`,
  );

  // Stamped LAST on purpose: its presence marks a conversion that ran to completion, and its
  // versions let an installed shell detect stale content (see manifest.ts).
  await writePipelineManifest(args.out);
  console.log(`[pipeline] stamped ${join(args.out, PIPELINE_MANIFEST_NAME)}`);
}
