import { readFile } from 'node:fs/promises';
import type { BuildingFootprint } from '@open-northland/data';
import {
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
  extractTribes,
  extractVehicles,
  extractWeapons,
  parseIniSections,
  type SourceRef,
} from '../../decoders/ini.js';
import type { IniSource } from './sources.js';

/**
 * Reads + parses every resolved `.ini` source and runs the typed extractors over it, returning one
 * table per record kind. Decoding stays pure (`decodeIni`/`parseIniSections`/`extract*` take
 * bytes/text, not the filesystem); the only I/O here is reading the resolved files. Each extractor
 * pulls only its own `[section]`s from a file, so passing every file's sections to every extractor is
 * correct and order-independent.
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
  // The `[GfxHouse]` building-type -> house-bob join (the data-pinned twin of the renderer's
  // transcribed per-type table) — render-binding data the sim ignores. See `extractBuildingBobs`.
  const buildingBobs = [];
  // typeId -> build-material cost, overlaid from the graphics table's `[GfxHouse]` records onto the
  // logic-table buildings (the logic table carries no construction cost — see `resolveIniSources`).
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
    buildingBobs,
    constructionCosts,
    hitpoints,
    footprints,
    constructionLayers,
    buildingOverlays,
  };
}
