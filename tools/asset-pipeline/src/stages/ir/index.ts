import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BuildingFootprint, type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import type { Args } from '../../args.js';
import {
  buildGatheringPipeline,
  buildTerrainPatterns,
  decodeIni,
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractBobSequences,
  extractBuildingBobs,
  extractBuildingFootprints,
  extractBuildingOverlays,
  extractBuildings,
  extractConstructionCosts,
  extractConstructionLayers,
  extractGfxAnimAtomics,
  extractGoods,
  extractHouseHitpoints,
  extractJobExperience,
  extractJobs,
  extractLandscape,
  extractLandscapeGfx,
  extractPatterns,
  extractPatternTransitions,
  extractSounds,
  extractTrianglePatternTypes,
  extractTribes,
  extractVehicles,
  extractWeapons,
  fillBuildingRecipes,
  parseIniSections,
  type SourceRef,
} from '../../decoders/ini.js';
import { decodeMapTree } from '../maps/index.js';
import { applyBuildingGraphicsOverlays } from './building-overlays.js';
import { loadCifTable } from './cif-tables.js';
import { resolveIniSources } from './sources.js';

export { type IniSource, resolveIniSources } from './sources.js';

/**
 * Reads + parses every resolved `.ini` source and runs the typed extractors, then assembles and
 * **validates** a {@link ContentSet} via `parseContentSet` (zod + cross-reference checks). Decoding
 * stays pure (`decodeIni`/`parseIniSections`/`extract*` take bytes/text, not the filesystem); the
 * only I/O here is reading the resolved files. Each extractor pulls only its own `[section]`s from a
 * file, so passing every file's sections to every extractor is correct and order-independent.
 */
export async function buildIr(args: Args): Promise<ContentSet> {
  const sources = await resolveIniSources(args.game, args.mod);
  const goods = [];
  const jobs = [];
  const jobExperience = [];
  const buildings = [];
  const landscape = [];
  const tribes = [];
  const atomicAnimations = [];
  const weapons = [];
  const armor = [];
  const animals = [];
  const vehicles = [];
  const bobSequences = [];
  const gfxAtomics = [];
  // The `[GfxHouse]` building-type -> house-bob join (the data-pinned twin of the renderer's
  // transcribed per-type table) — render-binding data the sim ignores. See `extractBuildingBobs`.
  const buildingBobs = [];
  // typeId -> build-material cost, overlaid from the graphics table's `[GfxHouse]` records onto the
  // logic-table buildings below (the logic table carries no construction cost — see `resolveIniSources`).
  const constructionCosts = new Map<number, { goodType: number; amount: number }[]>();
  // typeId -> max hitpoints, the graphics-table `logichitpoints` overlay onto the logic buildings —
  // the building's full life pool the ConstructionSystem ramps up as it rises (see `extractHouseHitpoints`).
  const hitpoints = new Map<number, number>();
  // typeId -> ground footprint (collision body / build-exclusion zone / door), the second graphics-table
  // overlay onto the logic buildings (see `extractBuildingFootprints`).
  const footprints = new Map<number, BuildingFootprint>();
  // `[GfxHouse]` construction-stage layers (render-binding data, like buildingBobs).
  const constructionLayers = [];
  // `[GfxHouse]` type-4 animated state overlays — the mill rotor (render-binding data, like buildingBobs).
  const buildingOverlays = [];
  for (const { path, file, layer } of sources) {
    const sections = parseIniSections(decodeIni(await readFile(path)));
    const src: SourceRef = { file, layer };
    goods.push(...extractGoods(sections, src));
    jobs.push(...extractJobs(sections, src));
    jobExperience.push(...extractJobExperience(sections, src));
    buildings.push(...extractBuildings(sections, src));
    landscape.push(...extractLandscape(sections, src));
    tribes.push(...extractTribes(sections, src));
    atomicAnimations.push(...extractAtomicAnimations(sections, src));
    weapons.push(...extractWeapons(sections, src));
    armor.push(...extractArmor(sections, src));
    animals.push(...extractAnimals(sections, src));
    vehicles.push(...extractVehicles(sections, src));
    bobSequences.push(...extractBobSequences(sections, src));
    gfxAtomics.push(...extractGfxAnimAtomics(sections, src));
    buildingBobs.push(...extractBuildingBobs(sections, src));
    constructionLayers.push(...extractConstructionLayers(sections, src));
    buildingOverlays.push(...extractBuildingOverlays(sections, src));
    for (const [typeId, cost] of extractConstructionCosts(sections)) {
      constructionCosts.set(typeId, cost);
    }
    for (const [typeId, hp] of extractHouseHitpoints(sections)) {
      hitpoints.set(typeId, hp);
    }
    for (const [typeId, footprint] of extractBuildingFootprints(sections)) {
      footprints.set(typeId, footprint);
    }
  }
  const maps = await decodeMapTree(args.game);
  // Terrain ground graphics (`.cif`-only tables) → the approximated typeId→pattern map the renderer
  // consumes. Both files ship in the base game; a partial install that lacks them simply yields no
  // `terrainPatterns` (the renderer keeps its flat-colour fallback).
  const patternFile = join('Data', 'engine2d', 'inis', 'patterns', 'pattern.cif');
  const gfxPatterns = await loadCifTable(args.game, patternFile, extractPatterns, []);
  const triangleFile = join('Data', 'logic', 'trianglepatterntypes.cif');
  const triangleTypes = await loadCifTable(args.game, triangleFile, extractTrianglePatternTypes, []);
  const terrainPatterns = buildTerrainPatterns(landscape, gfxPatterns, triangleTypes, {
    file: patternFile,
    layer: 'base',
  });
  // The `[transition]` ground-overlay table (`.cif`-only) — a decoded map's `transitions.types`
  // names join onto it (`editName`) for the overlay texture + the six per-pair UV triangles.
  const transitionFile = join('Data', 'engine2d', 'inis', 'patterntransitions', 'transitions.cif');
  const gfxPatternTransitions = await loadCifTable(args.game, transitionFile, extractPatternTransitions, []);
  // The full `[GfxLandscape]` object table (`.cif`-only) — the table a decoded map's `objects`
  // placements join onto by `EditName` (trees/stones/bushes/mine decals/waves; visual frames +
  // logic footprints). Distinct from the `(bmd, palette)` atlas work list the bmd stage derives.
  const landscapeFile = join('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif');
  const landscapeGfx = await loadCifTable(args.game, landscapeFile, extractLandscapeGfx, []);
  // The resolved gathering-pipeline join: per map-gathered good, its three landscape stages +
  // the `[GfxLandscape]` records (by `logicType`) that place each — materialized once so a later
  // gathering system doesn't re-scan the goods × landscapeGfx tables. See `buildGatheringPipeline`.
  const gatheringPipeline = buildGatheringPipeline(goods, landscapeGfx);
  // The decoded `soundfx.cif` sound bank (`.cif`-only) — the named wav groups + terrain ambient beds +
  // life-event jingles the browser audio layer joins onto sim events / on-screen terrain. Base-game
  // file; a partial install that lacks it yields an empty bank (the app degrades to silence). Purely
  // render/audio-binding data — the pure sim never reads it.
  const soundFile = join('Data', 'engine2d', 'inis', 'soundfx', 'soundfx.cif');
  const sounds = await loadCifTable(args.game, soundFile, extractSounds, {
    staticGroups: [],
    ambient: [],
    jingles: [],
  });
  // Overlay the graphics-table cost/hitpoints/footprint onto the logic buildings (joined by `typeId`).
  const buildingsWithCosts = applyBuildingGraphicsOverlays(buildings, {
    constructionCosts,
    hitpoints,
    footprints,
  });
  // Output-side recipe join: a workplace's `produces` output good -> that good's `productionInputs`
  // materializes each producing building's `recipe` (cross-table, so after the tables are built).
  // The recipe `ticks` is resolved through the produce-atomic animation length of the reference
  // tribe, so the tribes + atomicAnimations tables feed in too (fall back to a default otherwise).
  const buildingsWithRecipes = fillBuildingRecipes(buildingsWithCosts, goods, tribes, atomicAnimations);
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: args.game, mod: args.mod },
    },
    goods,
    jobs,
    jobExperience,
    buildings: buildingsWithRecipes,
    weapons,
    armor,
    animals,
    vehicles,
    landscape,
    landscapeGfx,
    gatheringPipeline,
    // The full positional pattern table — a decoded map's `ground.patterns` names join onto it
    // (`GfxPattern.editName`) for the texture page + per-triangle UVs.
    gfxPatterns,
    // The transition-overlay table — a decoded map's `transitions.types` names join onto it.
    gfxPatternTransitions,
    terrainPatterns,
    // The per-logicType ground classes (`humancanwalkon`/`housecanbebuildon`/`iswater`) the
    // map-collision join reads — emitted verbatim so ground blocking is data, not a hardcoded split.
    trianglePatternTypes: triangleTypes,
    bobSequences,
    gfxAtomics,
    buildingBobs,
    constructionLayers,
    buildingOverlays,
    tribes,
    atomicAnimations,
    maps,
    sounds,
  });
}

/**
 * Builds the validated IR and writes it to `<out>/ir.json` (pretty-printed for diff-legibility).
 * Returns the assembled set so the caller can report record counts. The write target lives under the
 * gitignored `content/` — no copyrighted bytes enter the repo source.
 */
export async function writeIr(args: Args): Promise<ContentSet> {
  const set = await buildIr(args);
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'ir.json'), `${JSON.stringify(set, null, 2)}\n`);
  return set;
}
