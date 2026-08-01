import { readFile } from 'node:fs/promises';
import type { BuildingFootprint, GoodQuantity } from '@open-northland/data';
import {
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractBobSequences,
  extractBuildingBobs,
  extractBuildingFlagPoints,
  extractBuildingFootprints,
  extractBuildingOverlays,
  extractBuildings,
  extractConstructionCosts,
  extractConstructionLayers,
  extractGfxAnimAtomics,
  extractGfxWalkAtomics,
  extractGoods,
  extractHouseHitpoints,
  extractJobExperience,
  extractJobs,
  extractLandscape,
  extractTribes,
  extractUpgradeTargets,
  extractVehicles,
  extractWeapons,
  iniBytesToSections,
  type SourceRef,
} from '../../decoders/ini.js';
import type { BuildingGraphicsOverlays } from './building-overlays.js';
import type { IniSource } from './sources.js';

/** Folds one source's overlay rows into the accumulated map: a later source wins per typeId. */
function foldOverlay<V>(into: Map<number, V>, rows: ReadonlyMap<number, V>): void {
  for (const [typeId, value] of rows) into.set(typeId, value);
}

/**
 * Reads + parses every resolved `.ini` source and runs the typed extractors over it, returning one
 * table per record kind plus the {@link BuildingGraphicsOverlays} group. Decoding stays pure
 * (`iniBytesToSections`/`extract*` take bytes/text, not the filesystem); the only I/O here is reading
 * the resolved files. Each extractor pulls only its own `[section]`s from a file, so passing every
 * file's sections to every extractor is correct.
 *
 * These are the per-source tables only. The cross-table joins over them live in {@link buildIr}.
 */
export async function extractIniTables(sources: readonly IniSource[]) {
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
  const gfxWalkAtomics = [];
  const buildingBobs = [];
  const constructionLayers = [];
  const buildingOverlays = [];
  const buildingFlagPoints = [];
  const buildingGraphicsOverlays = {
    constructionCosts: new Map<number, GoodQuantity[]>(),
    hitpoints: new Map<number, number>(),
    upgradeTargets: new Map<number, number>(),
    footprints: new Map<number, BuildingFootprint>(),
  } satisfies BuildingGraphicsOverlays;

  for (const { path, file, layer } of sources) {
    const sections = iniBytesToSections(await readFile(path));
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
    gfxWalkAtomics.push(...extractGfxWalkAtomics(sections, src));
    buildingBobs.push(...extractBuildingBobs(sections, src));
    constructionLayers.push(...extractConstructionLayers(sections, src));
    buildingOverlays.push(...extractBuildingOverlays(sections, src));
    buildingFlagPoints.push(...extractBuildingFlagPoints(sections, src));
    foldOverlay(buildingGraphicsOverlays.constructionCosts, extractConstructionCosts(sections));
    foldOverlay(buildingGraphicsOverlays.hitpoints, extractHouseHitpoints(sections));
    foldOverlay(buildingGraphicsOverlays.upgradeTargets, extractUpgradeTargets(sections));
    foldOverlay(buildingGraphicsOverlays.footprints, extractBuildingFootprints(sections));
  }

  return {
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
    buildingGraphicsOverlays,
  };
}
