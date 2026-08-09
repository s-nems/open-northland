import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { type Vfs, vjoin } from '@open-northland/vfs';
import {
  extractLandscapeGfx,
  extractPatterns,
  extractPatternTransitions,
  extractSounds,
  extractTrianglePatternTypes,
} from '../../decoders/ini.js';
import { CONTENT_REVISION } from '../../manifest.js';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { decodeMapTree } from '../maps/index.js';
import { applyBuildingGraphicsOverlays } from './building-overlays.js';
import { fillBuildingRecipes, stripVehicleGoods } from './building-recipes.js';
import { loadCifTable } from './cif-tables.js';
import { buildGatheringPipeline } from './gathering-pipeline.js';
import { resolveIniSources } from './sources.js';
import { extractIniTables } from './tables.js';
import { buildTerrainPatterns } from './terrain-patterns.js';

export { type IniSource, resolveIniSources } from './sources.js';

/** Extracts the `.ini` and `.cif` tables, resolves the cross-table joins, then validates the set. */
export async function buildIr(fs: Vfs, roots: SourceRoots): Promise<ContentSet> {
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
    gfxWalkAtomics,
    buildingBobs,
    constructionLayers,
    buildingOverlays,
    buildingFlagPoints,
    buildingSoldierFlagPoints,
    buildingGraphicsOverlays,
  } = await extractIniTables(fs, await resolveIniSources(fs, roots));
  const maps = await decodeMapTree(fs, roots);
  const patternFile = vjoin('Data', 'engine2d', 'inis', 'patterns', 'pattern.cif');
  const gfxPatterns = await loadCifTable(fs, roots, patternFile, extractPatterns, []);
  const triangleFile = vjoin('Data', 'logic', 'trianglepatterntypes.cif');
  const triangleTypes = await loadCifTable(fs, roots, triangleFile, extractTrianglePatternTypes, []);
  const terrainPatterns = buildTerrainPatterns(landscape, gfxPatterns, triangleTypes, {
    file: patternFile,
    layer: 'base',
  });
  const transitionFile = vjoin('Data', 'engine2d', 'inis', 'patterntransitions', 'transitions.cif');
  const gfxPatternTransitions = await loadCifTable(fs, roots, transitionFile, extractPatternTransitions, []);
  const landscapeFile = vjoin('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif');
  const landscapeGfx = await loadCifTable(fs, roots, landscapeFile, extractLandscapeGfx, []);
  const gatheringPipeline = buildGatheringPipeline(goods, landscapeGfx);
  const soundFile = vjoin('Data', 'engine2d', 'inis', 'soundfx', 'soundfx.cif');
  const sounds = await loadCifTable(fs, roots, soundFile, extractSounds, {
    staticGroups: [],
    ambient: [],
    jingles: [],
  });
  const buildingsWithCosts = applyBuildingGraphicsOverlays(buildings, buildingGraphicsOverlays);
  const buildingsSansVehicles = stripVehicleGoods(buildingsWithCosts, goods, vehicles);
  const buildingsWithRecipes = fillBuildingRecipes(buildingsSansVehicles, goods);
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      contentRevision: CONTENT_REVISION,
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
    gfxPatterns,
    gfxPatternTransitions,
    terrainPatterns,
    trianglePatternTypes: triangleTypes,
    bobSequences,
    gfxAtomics,
    gfxWalkAtomics,
    buildingBobs,
    constructionLayers,
    buildingOverlays,
    buildingFlagPoints,
    buildingSoldierFlagPoints,
    tribes,
    atomicAnimations,
    maps,
    sounds,
  });
}

/**
 * Builds the validated IR and writes it to `<out>/ir.json`. The output tree is gitignored, so no
 * content decoded from the owned game copy enters the repository.
 */
export async function writeIr(fs: Vfs, roots: SourceRoots, out: string): Promise<ContentSet> {
  const set = await buildIr(fs, roots);
  await writeJsonFile(fs, out, 'ir.json', set);
  return set;
}
