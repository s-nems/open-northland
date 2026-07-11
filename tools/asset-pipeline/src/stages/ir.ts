import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BuildingFootprint, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import type { Args } from '../args.js';
import { decodeCifStringArray } from '../decoders/cif.js';
import {
  buildGatheringPipeline,
  buildTerrainPatterns,
  cifLinesToSections,
  decodeIni,
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractBobSequences,
  extractBuildingBobs,
  extractBuildingFootprints,
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
  type RuleSection,
  type SourceRef,
} from '../decoders/ini.js';
import { decodeMapTree } from './maps/index.js';

/**
 * Decodes a `.cif`-only table (no readable `.ini` twin — `pattern.cif`, `trianglepatterntypes.cif`)
 * into the shared {@link RuleSection} model, or `null` if the file is absent. Mirrors the
 * graceful-skip stance of {@link resolveIniSources}: a partial install still produces an IR from
 * whatever is present rather than aborting the batch.
 */
async function loadCifSections(path: string): Promise<RuleSection[] | null> {
  try {
    await access(path);
  } catch {
    return null;
  }
  const { lines } = decodeCifStringArray(new Uint8Array(await readFile(path)));
  return cifLinesToSections(lines);
}

/**
 * One readable `.ini` rule source to parse, with where it came from (`base` = `Data/logic`,
 * `mod` = `DataCnmd`). The extractor selects which `[section]`s it cares about, so a file with no
 * matching sections contributes nothing rather than erroring.
 */
export interface IniSource {
  /** Absolute path of the `.ini` file to read. */
  readonly path: string;
  /** Path stamped onto each record's `source.file` — relative so the IR is location-agnostic. */
  readonly file: string;
  readonly layer: 'base' | 'mod';
}

/**
 * Resolves the readable `.ini` sources for the type tables we can extract today, **preferring the
 * mod's readable `.ini` over the base game** (AGENTS.md golden rule #4): tribes + atomic animations +
 * weapons + buildings live only under `DataCnmd/types/` (the base game's twins are encrypted `.cif`),
 * while goods/jobs/landscape/vehicles/armor/animals are base `Data/logic/*.ini`. A source whose file is missing on disk is
 * dropped with a warning — a partial install (or no mod) still produces an IR from whatever is present,
 * rather than aborting the whole batch.
 */
export async function resolveIniSources(gameDir: string, mod: string | undefined): Promise<IniSource[]> {
  const base: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: join('Data', 'logic', 'goodtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'jobtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'humanjobexperiencetypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'landscapetypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'vehicletypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'armortypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'animaltypes.ini'), layer: 'base' },
  ];
  if (mod !== undefined) {
    base.push(
      { rel: join(mod, 'tribetypes12', 'tribetypes.ini'), layer: 'mod' },
      { rel: join(mod, 'atomicanimations12', 'atomicanimations.ini'), layer: 'mod' },
      { rel: join(mod, 'types', 'weapons.ini'), layer: 'mod' },
      { rel: join(mod, 'types', 'houses.ini'), layer: 'mod' },
      // The renderer's animation table: `[bobseq]` named frame ranges (`seq "<name>" <start> <length>`)
      // → IR `bobSequences`, so the render reads its walk/chop cycles from data instead of hard-coded
      // constants (see `extractBobSequences`). Mod-only readable; the base twin is encrypted `.cif`.
      { rel: join(mod, 'animation', 'mapmoveableanimations', 'animations.ini'), layer: 'mod' },
      // The graphics-table twin: its `[GfxHouse]` records carry the `LogicConstructionGoods` build
      // costs (and the home level chain), which the logic table above does not — overlaid onto the
      // buildings by `typeId` in `buildIr` (see `extractConstructionCosts`).
      { rel: join(mod, 'budynki12', 'houses', 'houses.ini'), layer: 'mod' },
    );
  }
  const sources: IniSource[] = [];
  for (const { rel, layer } of base) {
    const path = join(gameDir, rel);
    try {
      await access(path);
    } catch {
      console.warn(`[pipeline] ini source not found, skipping: ${rel}`);
      continue;
    }
    sources.push({ path, file: rel, layer });
  }
  return sources;
}

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
  const patternSections = await loadCifSections(join(args.game, patternFile));
  const triangleFile = join('Data', 'logic', 'trianglepatterntypes.cif');
  const triangleSections = await loadCifSections(join(args.game, triangleFile));
  const gfxPatterns = patternSections
    ? extractPatterns(patternSections, { file: patternFile, layer: 'base' })
    : [];
  const triangleTypes = triangleSections
    ? extractTrianglePatternTypes(triangleSections, { file: triangleFile, layer: 'base' })
    : [];
  const terrainPatterns = buildTerrainPatterns(landscape, gfxPatterns, triangleTypes, {
    file: patternFile,
    layer: 'base',
  });
  // The `[transition]` ground-overlay table (`.cif`-only) — a decoded map's `transitions.types`
  // names join onto it (`editName`) for the overlay texture + the six per-pair UV triangles.
  const transitionFile = join('Data', 'engine2d', 'inis', 'patterntransitions', 'transitions.cif');
  const transitionSections = await loadCifSections(join(args.game, transitionFile));
  const gfxPatternTransitions = transitionSections
    ? extractPatternTransitions(transitionSections, { file: transitionFile, layer: 'base' })
    : [];
  // The full `[GfxLandscape]` object table (`.cif`-only) — the table a decoded map's `objects`
  // placements join onto by `EditName` (trees/stones/bushes/mine decals/waves; visual frames +
  // logic footprints). Distinct from the `(bmd, palette)` atlas work list the bmd stage derives.
  const landscapeFile = join('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif');
  const landscapeSections = await loadCifSections(join(args.game, landscapeFile));
  const landscapeGfx = landscapeSections
    ? extractLandscapeGfx(landscapeSections, { file: landscapeFile, layer: 'base' })
    : [];
  // The resolved gathering-pipeline join: per map-gathered good, its three landscape stages +
  // the `[GfxLandscape]` records (by `logicType`) that place each — materialized once so a later
  // gathering system doesn't re-scan the goods × landscapeGfx tables. See `buildGatheringPipeline`.
  const gatheringPipeline = buildGatheringPipeline(goods, landscapeGfx);
  // The decoded `soundfx.cif` sound bank (`.cif`-only) — the named wav groups + terrain ambient beds +
  // life-event jingles the browser audio layer joins onto sim events / on-screen terrain. Base-game
  // file; a partial install that lacks it yields an empty bank (the app degrades to silence). Purely
  // render/audio-binding data — the pure sim never reads it.
  const soundFile = join('Data', 'engine2d', 'inis', 'soundfx', 'soundfx.cif');
  const soundSections = await loadCifSections(join(args.game, soundFile));
  const sounds = soundSections
    ? extractSounds(soundSections)
    : { staticGroups: [], ambient: [], jingles: [] };
  // Overlay each building's build-material cost + ground footprint from the graphics table (joined
  // by `typeId`); a building the graphics table omits keeps the schema-default empty cost and no
  // footprint (it places with no collision — the pre-footprint behavior).
  const buildingsWithCosts = buildings.map((b) => {
    const cost = constructionCosts.get(b.typeId);
    const hp = hitpoints.get(b.typeId);
    const footprint = footprints.get(b.typeId);
    return {
      ...b,
      ...(cost ? { construction: cost } : {}),
      ...(hp !== undefined ? { hitpoints: hp } : {}),
      ...(footprint ? { footprint } : {}),
    };
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
