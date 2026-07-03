#!/usr/bin/env node
/**
 * Asset pipeline CLI — offline conversion of an OWNED original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
 *
 * This is run by a human/agent, not shipped. It writes NO copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 *
 * Phase 1 lands the stages one decoder at a time. Implemented now: `.lib` archives unpacked to loose
 * files under `--out` (the embedded `.pcx`/`.bmd`/`.cif` the later stages read), `.pcx` pictures -> PNG
 * (the loose-file pass over the `--game` tree), `.bmd` bob sets -> atlas PNG + manifest JSON for the
 * readable palette bindings (base animals `[jobgraphics]` + the mod's human `[jobbasegraphics]` skin),
 * and readable `.ini` rules -> a validated `content/ir.json`
 * (goods/jobs/landscape from base `Data/logic`, tribes + atomic animations from the mod's `DataCnmd`,
 * preferring the mod per CLAUDE.md), the declarative logic-header metadata of every `map.cif`
 * (dimensions/GUID/type/name ids), and the per-cell landscape grid of every `map.dat` -> a
 * `maps/<id>.json` `TerrainMap` (the sim's nav-graph input). The remaining stages (standalone
 * palettes, the `.cif`-only type tables, the map's `MissionData`/`StaticObjects` mission scripting,
 * and the oracle pixel-diff) are still TODO; see docs/ROADMAP.md.
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Args, assertOutStaysInCheckout, parseArgs, resolveArgs } from './args.js';
import { convertBmdTree, resolveGraphicsBindings } from './stages/bmd.js';
import { convertFontStage } from './stages/fonts.js';
import { convertGuiStage } from './stages/gui.js';
import { writeIr } from './stages/ir.js';
import { unpackLibTree } from './stages/lib.js';
import { convertMapDatTree } from './stages/maps.js';
import { convertPcxTree } from './stages/pcx.js';
import { convertIndexedCharacterAtlases, convertPlayerColorLut } from './stages/player-colors.js';

async function run(args: Args): Promise<void> {
  console.log(`[pipeline] game=${args.game} mod=${args.mod ?? '(none)'} out=${args.out}`);

  // Stage order (see docs/SOURCES.md). Prefer the mod's readable .ini sources over base .cif.
  // > 1. Unpack .lib archives                  -> decoders/lib.ts (this stage)
  //   2. Decode palettes + .hlt remap tables   -> ref CPalette.cs, CRemapTable.cs (TODO)
  // > 3. Decode .pcx pictures -> PNG            -> decoders/pcx.ts + png.ts  (this stage)
  // > 4. Decode .bmd bobs -> atlas + anim JSON  -> decoders/bmd.ts + atlas.ts (this stage; readable bindings)
  // > 5. Parse .ini rules -> typed IR           -> decoders/ini.ts (this stage; mod .ini preferred)
  // > 6. Decode map logic headers -> map IR     -> decoders/cif.ts + ini.ts (this stage; metadata only)
  // > 7. Write content/ir.json + validate with parseContentSet()  (this stage)
  // > 8. Decode map.dat terrain grids -> maps/  -> decoders/mapdat.ts (this stage; the nav-graph grid)
  // > 9. Extract GUI/HUD art+strings+cursors    -> decoders/cursor.ts + stages/gui.ts (this stage)
  //
  // The unpack extracts loose copies of the embedded .pcx/.bmd/.cif into <out> (gitignored).
  const extracted = await unpackLibTree(args.game, args.out);
  console.log(`[pipeline] lib unpack: extracted ${extracted.length} member(s) into ${args.out}`);

  // Convert .pcx -> .png from BOTH trees: the original --game tree (loose pictures shipped as files)
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

  // Convert .bmd bob sets -> atlas PNG + manifest JSON for every binding: the base animals
  // [jobgraphics] records, the base vehicles/jobgraphics.cif [jobgraphics] cart/ship records, the base
  // humans/jobgraphics.cif [jobbasegraphics] base-appearance + [jobchangegraphics] equipment-skin
  // records (the .cif-only legs), plus, with a --mod, the mod's [jobbasegraphics]/[jobchangegraphics]
  // human body/head bobs. Each binding
  // names its palette by editname; palettes.ini resolves it to a .pcx, whose trailer palette colours
  // the bobs. Both the .bmd and the .pcx are read from the just-unpacked <out> tree.
  const { bindings, palettes } = await resolveGraphicsBindings(args.game, args.mod);
  const atlases = await convertBmdTree(bindings, palettes, args.out);
  // Atlases are now named per (bmd, palette), so each per-creature recolour is its own file rather than
  // collapsing onto one body bob last-palette-wins. Report both the distinct atlas files and the distinct
  // body .bmd geometries behind them — the gap is the per-creature recolour fan-out.
  const distinct = new Set(atlases.map((a) => a.png)).size;
  const distinctBmd = new Set(atlases.map((a) => a.bmd)).size;
  console.log(
    `[pipeline] bmd -> atlas: ${atlases.length} of ${bindings.length} readable binding(s) -> ` +
      `${distinct} atlas file(s) (${distinctBmd} distinct .bmd) into ${args.out} ` +
      `(${palettes.length} palette aliases)`,
  );

  // Player (team) colours: keep the human character bobs recolourable at draw time. Emit an indexed atlas
  // (palette index in red, mask in alpha) for every `cr_hum_*` body/head, plus one 256×16 player-colour LUT
  // (10 shipped `playerNN.pcx` + 6 hue-rotated extras). The renderer reads each index through the player's
  // LUT row, so one atlas serves all 16 players — see packages/render palette-LUT shader + docs/FIDELITY.md.
  const indexed = await convertIndexedCharacterAtlases(bindings, args.out);
  const lut = await convertPlayerColorLut(args.out).catch((err: unknown) => {
    console.warn(`[pipeline] player-colour LUT skipped: ${(err as Error).message}`);
    return undefined;
  });
  console.log(
    `[pipeline] player colours: ${indexed.length} indexed character atlas(es)` +
      `${lut ? `, ${lut.colors}-colour LUT -> ${lut.png}` : ' (LUT skipped)'}`,
  );

  // GUI/HUD: the in-game HUD bob sheets (ls_gui_window 193 bobs + ls_gui_bubbles 23) -> an indexed atlas
  // (render colours per element at draw time) + an RGBA preview atlas + a 256×N palette LUT, the nine
  // ingamegui string tables per language -> id->text JSON, and the mouse cursors -> PNG + verbatim .cur.
  // All from loose files (the HUD ships unpacked); outputs land under content/ for the app's /bobs + /gui
  // routes. See stages/gui.ts + docs/SOURCES.md "GUI".
  const gui = await convertGuiStage(args.game, args.out);
  console.log(
    `[pipeline] gui: ${gui.atlases} atlas(es) (${gui.frames} frames), ${gui.palettes}-palette LUT, ` +
      `${gui.strings.map((s) => `${s.lang}:${s.tables}t/${s.strings}s`).join(' ') || 'no strings'}, ` +
      `${gui.cursors} cursor(s) into ${join(args.out, 'gui')}`,
  );

  // Fonts: the UI bitmap fonts (font08/10/12/fontdebug × the default/latin/rus sets) -> an indexed glyph
  // atlas (render colours per text-colour at draw time) + an RGBA preview atlas + a 256×4 font-colour LUT
  // (white/dark/dimmed/red) + a per-font metrics JSON (per-glyph advance/offset/size, line height, baseline).
  // Each `.fnt` is a CFont wrapping the same CBobManager bob container the settlers/HUD use; all from loose
  // files. See stages/fonts.ts + docs/SOURCES.md ".fnt".
  const fonts = await convertFontStage(args.game, args.out);
  console.log(
    `[pipeline] fonts: ${fonts.fonts} font(s) (${fonts.glyphs} glyphs), ` +
      `${fonts.colors}-colour LUT into ${join(args.out, 'gui', 'fonts')}`,
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

  // Decode each map's binary terrain grid (map.dat hoix container -> lmlt landscape-type layer -> one
  // per-cell typeId) into maps/<id>.json — the TerrainMap the sim's buildTerrainGraph consumes, so the
  // sim loads a real map's grid instead of a synthetic scenario one. Joins onto the same-folder
  // map.cif's MapInfo id.
  const terrains = await convertMapDatTree(args.game, args.out);
  const totalCells = terrains.reduce((sum, t) => sum + t.width * t.height, 0);
  console.log(
    `[pipeline] map.dat -> terrain: ${terrains.length} map grid(s) ` +
      `(${totalCells} cells total) into ${join(args.out, 'maps')}`,
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
