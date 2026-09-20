import { basename } from 'node:path';
import { type ContentSet, emptySoundBank, IR_VERSION, parseContentSet } from '@open-northland/data';
import {
  extractAnimalCalls,
  extractHumanVoices,
  extractLandscapeGfx,
  extractPatterns,
  extractPatternTransitions,
  extractSounds,
  extractTrianglePatternTypes,
} from '../../decoders/ini.js';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { decodeMapTree } from '../maps/index.js';
import { applyBuildingGraphicsOverlays } from './building-overlays.js';
import { fillBuildingRecipes, stripVehicleGoods } from './building-recipes.js';
import { loadCifTable, loadIniTable } from './cif-tables.js';
import { buildGatheringPipeline } from './gathering-pipeline.js';
import { rebindMovedJobExperience } from './job-experience.js';
import { loadJobGraphics } from './job-graphics.js';
import { resolveIniSources } from './sources.js';
import { extractIniTables } from './tables.js';
import { buildTerrainPatterns } from './terrain-patterns.js';

export { type IniSource, resolveIniSources } from './sources.js';

/** Extracts the `.ini` and `.cif` tables, resolves the cross-table joins, then validates the set. */
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
    gfxWalkAtomics,
    gfxInHousePrograms,
    buildingBobs,
    constructionLayers,
    buildingOverlays,
    buildingFlagPoints,
    buildingSoldierFlagPoints,
    buildingGraphicsOverlays,
  } = await extractIniTables(await resolveIniSources(roots));
  const jobGraphics = await loadJobGraphics(roots);
  const maps = await decodeMapTree(roots);
  const patternFile = 'Data/engine2d/inis/patterns/pattern.cif';
  const gfxPatterns = await loadCifTable(roots, patternFile, extractPatterns, []);
  const triangleFile = 'Data/logic/trianglepatterntypes.cif';
  const triangleTypes = await loadCifTable(roots, triangleFile, extractTrianglePatternTypes, []);
  const terrainPatterns = buildTerrainPatterns(landscape, gfxPatterns, triangleTypes, {
    file: patternFile,
    layer: 'base',
  });
  const transitionFile = 'Data/engine2d/inis/patterntransitions/transitions.cif';
  const gfxPatternTransitions = await loadCifTable(roots, transitionFile, extractPatternTransitions, []);
  const landscapeFile = 'Data/engine2d/inis/landscapes/landscapes.cif';
  const landscapeGfx = await loadCifTable(roots, landscapeFile, extractLandscapeGfx, []);
  const gatheringPipeline = buildGatheringPipeline(goods, landscapeGfx);
  const humanVoices = await loadCifTable(
    roots,
    'Data/engine2d/inis/humans/sounds.cif',
    extractHumanVoices,
    [],
  );
  const animalCalls = await loadIniTable(
    roots,
    'Data/engine2d/inis/animals/sounds.ini',
    extractAnimalCalls,
    [],
  );
  const soundFile = 'Data/engine2d/inis/soundfx/soundfx.cif';
  const sounds = await loadCifTable(
    roots,
    soundFile,
    (sections) => extractSounds(sections, { humanVoices, animalCalls }),
    emptySoundBank(),
  );
  const buildingsWithCosts = applyBuildingGraphicsOverlays(buildings, buildingGraphicsOverlays);
  const buildingsSansVehicles = stripVehicleGoods(buildingsWithCosts, goods, vehicles);
  const buildingsWithRecipes = fillBuildingRecipes(buildingsSansVehicles, goods);
  const alignedJobExperience = rebindMovedJobExperience(jobExperience, tribes);
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { mod: basename(roots.mod) } },
    goods,
    jobs,
    jobExperience: alignedJobExperience,
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
    jobGraphics,
    gfxAtomics,
    gfxWalkAtomics,
    gfxInHousePrograms,
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
 * content decoded from the mod enters the repository.
 */
export async function writeIr(roots: SourceRoots, out: string): Promise<ContentSet> {
  const set = await buildIr(roots);
  await writeJsonFile(out, 'ir.json', set);
  return set;
}
