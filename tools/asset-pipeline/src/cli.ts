#!/usr/bin/env node
/**
 * Asset pipeline CLI — offline conversion of an owned original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
 *
 * This is run by a human/agent, not shipped. It writes no copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Args, assertOutStaysInCheckout, parseArgs, resolveArgs } from './args.js';
import { convertBmdTree, resolveGraphicsBindings } from './stages/bmd/index.js';
import { convertFontStage } from './stages/fonts.js';
import { convertGoodsStage } from './stages/goods/index.js';
import { convertGuiStage } from './stages/gui/index.js';
import { writeIr } from './stages/ir/index.js';
import { unpackLibTree } from './stages/lib.js';
import { convertMapDatTree } from './stages/maps/index.js';
import { composeMaskedTransitionPages, convertPcxTree } from './stages/pcx.js';
import { convertIndexedCharacterAtlases, convertPlayerColorLut } from './stages/player-colors.js';

async function run(args: Args): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stages run in dependency order — unpack first, then the passes that read its output. Prefer the
  // mod's readable .ini sources over base .cif; docs/SOURCES.md carries the full source → decoder map.
  // The unpack extracts loose copies of the embedded .pcx/.bmd/.cif into <out> (gitignored).
  const extracted = await unpackLibTree(args.game, args.out);
  console.log(`[pipeline] lib unpack: extracted ${extracted.length} member(s) into ${args.out}`);

  // Convert .pcx -> .png from both trees: the original --game tree (loose pictures shipped as files)
  // mirrored into <out>, and the unpacked <out> tree itself (the .pcx the unpack stage just extracted
  // from data0001.lib, converted in place to a .png sibling). The two roots are disjoint sources, so a
  // picture is converted exactly once per location it exists; <game>==<out> is not a supported invocation.
  const loosePictures = await convertPcxTree(args.game, args.out);
  const embeddedPictures = await convertPcxTree(args.out, args.out);
  const pictures = loosePictures.length + embeddedPictures.length;
  console.log(
    `[pipeline] pcx -> png: converted ${pictures} picture(s) into ${args.out} ` +
      `(${loosePictures.length} loose, ${embeddedPictures.length} embedded)`,
  );

  // Convert every (bmd, palette) graphics binding (resolved by resolveGraphicsBindings) to an atlas PNG +
  // manifest JSON. A binding names its palette by editname, which palettes.ini resolves to the .pcx whose
  // trailer colours the bobs; both the .bmd and .pcx are read from the just-unpacked <out> tree.
  const { bindings, palettes, buildTimeBmds } = await resolveGraphicsBindings(args.game, args.mod);
  const atlases = await convertBmdTree(bindings, palettes, args.out, buildTimeBmds);
  // Atlases are named per (bmd, palette), so the log reports both the distinct atlas files and the
  // distinct body .bmd geometries behind them — the gap is the per-creature recolour fan-out.
  const distinct = new Set(atlases.map((a) => a.png)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  // Player (team) colours: an indexed atlas (palette index in red, mask in alpha) per `cr_hum_*` body/head
  // plus one 256×16 player-colour LUT, so one atlas serves all 16 players (the renderer reads each index
  // through the player's LUT row). See stages/player-colors.ts + packages/render's palette-LUT shader.
  const indexed = await convertIndexedCharacterAtlases(bindings, args.out);
  const lut = await convertPlayerColorLut(args.out).catch((err: unknown) => {
    console.warn(`[pipeline] player-colour LUT skipped: ${(err as Error).message}`);
    return undefined;
  });
  console.log(
    `[pipeline] player colours: ${indexed.length} indexed character atlas(es)` +
      `${lut ? `, ${lut.colors}-colour LUT -> ${lut.png}` : ' (LUT skipped)'}`,
  );

  // GUI/HUD: the HUD bob sheets -> indexed + preview atlas + palette LUT, the ingamegui string tables
  // per language -> id->text JSON, and the mouse cursors -> PNG + verbatim .cur. All from loose files.
  // See stages/gui/ + docs/SOURCES.md "GUI".
  const gui = await convertGuiStage(args.game, args.out);
  console.log(
    `[pipeline] gui: ${gui.atlases} atlas(es) (${gui.frames} frames), ${gui.palettes}-palette LUT, ` +
      `${gui.strings.map((s) => `${s.lang}:${s.tables}t/${s.strings}s`).join(' ') || 'no strings'}, ` +
      `${gui.cursors} cursor(s) into ${join(args.out, 'gui')}`,
  );

  // Fonts: the UI bitmap fonts (font08/10/12/fontdebug × default/latin/rus) -> an indexed glyph atlas +
  // preview + a 256×4 font-colour LUT + a per-font metrics JSON. See stages/fonts.ts + docs/SOURCES.md ".fnt".
  const fonts = await convertFontStage(args.game, args.out);
  console.log(
    `[pipeline] fonts: ${fonts.fonts} font(s) (${fonts.glyphs} glyphs), ` +
      `${fonts.colors}-colour LUT into ${join(args.out, 'gui', 'fonts')}`,
  );

  // Goods icons: the shared good-pile bob sheet -> an indexed atlas + preview + a goods palette LUT, plus
  // the good -> (pile frame, palette) bindings. Feeds the HUD's per-good resource icons. See stages/goods/.
  const goods = await convertGoodsStage(args.game, args.out);
  console.log(
    `[pipeline] goods: ${goods.frames}-frame atlas, ${goods.palettes}-palette LUT, ` +
      `${goods.icons} good icon(s) into ${join(args.out, 'goods')}`,
  );

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
  const terrains = await convertMapDatTree(args.game, args.out);
  const totalCells = terrains.reduce((sum, t) => sum + t.width * t.height, 0);
  const metas = terrains.filter((t) => t.meta).length;
  const minimaps = terrains.filter((t) => t.minimap).length;
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total, ${metas} name/description sidecar(s), ${minimaps} minimap(s)) ` +
      `into ${join(args.out, 'maps')}`,
  );
}

// Auto-run only when invoked as the entry point (node src/cli.ts / the dist bin), not when a test
// imports this module for parseArgs/pcxToPng/convertPcxTree.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Resolve relative --game/--out against where `npm run` was invoked (repo root), not the workspace
  // package dir npm sets as cwd — see resolveArgs. Fall back to cwd for a bare `node dist/cli.js`.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const args = resolveArgs(parseArgs(process.argv.slice(2)), baseDir);
  // A symlinked out (a worktree sharing the primary's content/) would be clobbered in place — refuse.
  assertOutStaysInCheckout(args.out, baseDir);
  run(args).catch((err: unknown) => {
    console.error('[pipeline] failed:', err);
    process.exitCode = 1;
  });
}
