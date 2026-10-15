import type { BuildingFootprint, GoodQuantity } from '@open-northland/data';
import {
  type ByTribe,
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractBobSequences,
  extractBuildingBobs,
  extractBuildingFlagPoints,
  extractBuildingFootprints,
  extractBuildingHolyFirePoints,
  extractBuildingLandscapeOverlays,
  extractBuildingOverlays,
  extractBuildingSoldierFlagPoints,
  extractBuildings,
  extractConstructionCosts,
  extractConstructionLayers,
  extractGfxAnimAtomics,
  extractGfxInHousePrograms,
  extractGfxWalkAtomics,
  extractGoods,
  extractHouseHitpoints,
  extractJobExperience,
  extractJobs,
  extractLandscape,
  extractRawFrameAtomics,
  extractRawFrameGaits,
  extractTribes,
  extractUpgradeTargets,
  extractVehicles,
  extractWeapons,
  iniBytesToSections,
  type RuleSection,
  type SourceRef,
} from '@open-northland/formats/ini';
import { BASE_BUILDING_GRAPHICS_FILE, BUILDING_GRAPHICS_FILE } from '../../data-layout.js';
import { readSourceFile, type SourceRoots } from '../../roots.js';
import { loadBaseOnlyHouseRecords } from '../base-houses.js';
import type { BuildingGraphicsOverlays } from './building-overlays.js';
import type { IniSource } from './sources.js';

/** Folds one source's overlay rows into the accumulated map: a later source wins per typeId. */
function foldOverlay<V>(into: Map<number, V>, rows: ReadonlyMap<number, V>): void {
  for (const [typeId, value] of rows) into.set(typeId, value);
}

/** Adds a fallback layer's overlay rows for the typeIds no earlier source described. */
function fillOverlay<V>(into: Map<number, V>, rows: ReadonlyMap<number, V>): void {
  for (const [typeId, value] of rows) if (!into.has(typeId)) into.set(typeId, value);
}

/** {@link fillOverlay} per `(typeId, tribe)`: a fallback tribe joins a type other tribes describe. */
function fillTribeOverlay<V>(into: Map<number, ByTribe<V>>, rows: ReadonlyMap<number, ByTribe<V>>): void {
  for (const [typeId, byTribe] of rows) {
    const merged = new Map(into.get(typeId));
    for (const [tribe, value] of byTribe) if (!merged.has(tribe)) merged.set(tribe, value);
    into.set(typeId, merged);
  }
}

/**
 * Runs every extractor over every source's sections, returning one table per record kind. An extractor
 * pulls only its own `[section]`s, so a file with no matching section contributes nothing. These are
 * the per-source tables only; the cross-table joins run afterwards.
 */
export async function extractIniTables(roots: SourceRoots, sources: readonly IniSource[]) {
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
  const gfxInHousePrograms = [];
  const rawFrameAtomics = [];
  const rawFrameGaits = [];
  const buildingBobs: ReturnType<typeof extractBuildingBobs> = [];
  const constructionLayers: ReturnType<typeof extractConstructionLayers> = [];
  const buildingOverlays: ReturnType<typeof extractBuildingOverlays> = [];
  const buildingLandscapeOverlays: ReturnType<typeof extractBuildingLandscapeOverlays> = [];
  const buildingFlagPoints: ReturnType<typeof extractBuildingFlagPoints> = [];
  const buildingSoldierFlagPoints: ReturnType<typeof extractBuildingSoldierFlagPoints> = [];
  const buildingHolyFirePoints: ReturnType<typeof extractBuildingHolyFirePoints> = [];
  const buildingGraphicsOverlays = {
    constructionCosts: new Map<number, GoodQuantity[]>(),
    hitpoints: new Map<number, ByTribe<number>>(),
    upgradeTargets: new Map<number, number>(),
    footprints: new Map<number, ByTribe<BuildingFootprint>>(),
  } satisfies BuildingGraphicsOverlays;
  const pushHouseVisuals = (sections: readonly RuleSection[], src: SourceRef): void => {
    buildingBobs.push(...extractBuildingBobs(sections, src));
    constructionLayers.push(...extractConstructionLayers(sections, src));
    buildingOverlays.push(...extractBuildingOverlays(sections, src));
    buildingLandscapeOverlays.push(...extractBuildingLandscapeOverlays(sections, src));
    buildingFlagPoints.push(...extractBuildingFlagPoints(sections, src));
    buildingSoldierFlagPoints.push(...extractBuildingSoldierFlagPoints(sections, src));
    buildingHolyFirePoints.push(...extractBuildingHolyFirePoints(sections, src));
  };

  let ruleHouses: RuleSection[] = [];
  for (const { path, file, layer } of sources) {
    const sections = iniBytesToSections(await readSourceFile(roots, path));
    const src: SourceRef = { file, layer };
    if (file === BUILDING_GRAPHICS_FILE) ruleHouses = sections;
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
    gfxInHousePrograms.push(...extractGfxInHousePrograms(sections, src));
    rawFrameAtomics.push(...extractRawFrameAtomics(sections));
    rawFrameGaits.push(...extractRawFrameGaits(sections));
    pushHouseVisuals(sections, src);
    foldOverlay(buildingGraphicsOverlays.constructionCosts, extractConstructionCosts(sections));
    foldOverlay(buildingGraphicsOverlays.hitpoints, extractHouseHitpoints(sections));
    foldOverlay(buildingGraphicsOverlays.upgradeTargets, extractUpgradeTargets(sections));
    foldOverlay(buildingGraphicsOverlays.footprints, extractBuildingFootprints(sections));
  }

  // Houses only the base table defines join after every rule source, filling what no rule row described.
  const baseHouses = await loadBaseOnlyHouseRecords(roots, ruleHouses);
  pushHouseVisuals(baseHouses, { file: BASE_BUILDING_GRAPHICS_FILE, layer: 'base' });
  fillOverlay(buildingGraphicsOverlays.constructionCosts, extractConstructionCosts(baseHouses));
  fillTribeOverlay(buildingGraphicsOverlays.hitpoints, extractHouseHitpoints(baseHouses));
  fillOverlay(buildingGraphicsOverlays.upgradeTargets, extractUpgradeTargets(baseHouses));
  fillTribeOverlay(buildingGraphicsOverlays.footprints, extractBuildingFootprints(baseHouses));

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
    gfxInHousePrograms,
    rawFrameAtomics,
    rawFrameGaits,
    buildingBobs,
    constructionLayers,
    buildingOverlays,
    buildingLandscapeOverlays,
    buildingFlagPoints,
    buildingSoldierFlagPoints,
    buildingHolyFirePoints,
    buildingGraphicsOverlays,
  };
}
