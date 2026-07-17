import { join } from 'node:path';
import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import {
  extractLandscapeGfx,
  extractPatterns,
  extractPatternTransitions,
  extractSounds,
  extractTrianglePatternTypes,
} from '../../decoders/ini.js';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../game-file.js';
import { decodeMapTree } from '../maps/index.js';
import { applyBuildingGraphicsOverlays } from './building-overlays.js';
import { fillBuildingRecipes, stripVehicleGoods } from './building-recipes.js';
import { loadCifTable } from './cif-tables.js';
import { buildGatheringPipeline } from './gathering-pipeline.js';
import { resolveIniSources } from './sources.js';
import { extractIniTables } from './tables.js';
import { buildTerrainPatterns } from './terrain-patterns.js';

export { type IniSource, resolveIniSources } from './sources.js';

/**
 * Extracts every `.ini` table ({@link extractIniTables}), loads the `.cif`-only tables, resolves the
 * cross-table joins over them, then assembles and validates a {@link ContentSet} via `parseContentSet`
 * (zod + cross-reference checks).
 */
export async function buildIr(roots: SourceRoots): Promise<ContentSet> {
  const {
    goods,
    jobs,
    jobExperience,
    buildings,
    landscape,
    tribes,
    atomicAnimations,
    weapons,
    armor,
    animals,
    vehicles,
    bobSequences,
    gfxAtomics,
    buildingBobs,
    constructionCosts,
    hitpoints,
    footprints,
    constructionLayers,
    buildingOverlays,
  } = await extractIniTables(await resolveIniSources(roots));
  const maps = await decodeMapTree(roots);
  // Terrain ground graphics (`.cif`-only tables) → the approximated typeId→pattern map the renderer
  // consumes. Both files ship in the base game; a partial install that lacks them simply yields no
  // `terrainPatterns` (the renderer keeps its flat-colour fallback).
  const patternFile = join('Data', 'engine2d', 'inis', 'patterns', 'pattern.cif');
  const gfxPatterns = await loadCifTable(roots, patternFile, extractPatterns, []);
  const triangleFile = join('Data', 'logic', 'trianglepatterntypes.cif');
  const triangleTypes = await loadCifTable(roots, triangleFile, extractTrianglePatternTypes, []);
  const terrainPatterns = buildTerrainPatterns(landscape, gfxPatterns, triangleTypes, {
    file: patternFile,
    layer: 'base',
  });
  // The `[transition]` ground-overlay table (`.cif`-only) — a decoded map's `transitions.types`
  // names join onto it (`editName`) for the overlay texture + the six per-pair UV triangles.
  const transitionFile = join('Data', 'engine2d', 'inis', 'patterntransitions', 'transitions.cif');
  const gfxPatternTransitions = await loadCifTable(roots, transitionFile, extractPatternTransitions, []);
  // The full `[GfxLandscape]` object table (`.cif`-only) — the table a decoded map's `objects`
  // placements join onto by `EditName` (trees/stones/bushes/mine decals/waves; visual frames +
  // logic footprints). Distinct from the `(bmd, palette)` atlas work list the bmd stage derives.
  const landscapeFile = join('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif');
  const landscapeGfx = await loadCifTable(roots, landscapeFile, extractLandscapeGfx, []);
  // The resolved gathering-pipeline join: per map-gathered good, its three landscape stages +
  // the `[GfxLandscape]` records (by `logicType`) that place each — materialized once so a later
  // gathering system doesn't re-scan the goods × landscapeGfx tables. See `buildGatheringPipeline`.
  const gatheringPipeline = buildGatheringPipeline(goods, landscapeGfx);
  // The decoded `soundfx.cif` sound bank (`.cif`-only) — the named wav groups + terrain ambient beds +
  // life-event jingles the browser audio layer joins onto sim events / on-screen terrain. Base-game
  // file; a partial install that lacks it yields an empty bank (the app degrades to silence). Purely
  // render/audio-binding data — the pure sim never reads it.
  const soundFile = join('Data', 'engine2d', 'inis', 'soundfx', 'soundfx.cif');
  const sounds = await loadCifTable(roots, soundFile, extractSounds, {
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
  // Vehicles are not goods (they are built on a yard, not crafted into a stockpile) — strip them from
  // every stock/produces list before the recipe join (temporary; see stripVehicleGoods).
  const buildingsSansVehicles = stripVehicleGoods(buildingsWithCosts, goods, vehicles);
  // Output-side recipe join: a workplace's `produces` output goods -> each good's `productionInputs`
  // materializes each producing building's per-product `recipes` (cross-table, so after the tables
  // are built). Cycle ticks are the uniform design pacing (DEFAULT_RECIPE_TICKS).
  const buildingsWithRecipes = fillBuildingRecipes(buildingsSansVehicles, goods);
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: roots.game, mod: roots.mod },
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
export async function writeIr(roots: SourceRoots, out: string): Promise<ContentSet> {
  const set = await buildIr(roots);
  await writeJsonFile(out, 'ir.json', set);
  return set;
}
