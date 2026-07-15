import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  extractAtomicAnimations,
  extractBuildings,
  extractGoods,
  extractJobExperience,
  extractJobs,
  extractLandscape,
  extractTribes,
  extractVehicles,
  extractWeapons,
  parseIniSections,
} from '../src/decoders/ini.js';
import {
  ATOMICANIMATIONS_INI,
  GOODTYPES_INI,
  HOUSES_INI,
  JOBTYPES_INI,
  JOBXP_INI,
  LANDSCAPE_INI,
  TRIBETYPES_INI,
  VEHICLETYPES_INI,
  WEAPONTYPES_INI,
} from './fixtures/ini-sources.js';

describe('IR integration', () => {
  it('extracted goods + jobs + buildings + weapons + tribes + landscape + animations assemble into a valid ContentSet', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), { file: 'houses.ini', layer: 'mod' });
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    const landscape = extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' });
    const atomicAnimations = extractAtomicAnimations(parseIniSections(ATOMICANIMATIONS_INI), {
      file: 'atomicanimations.ini',
      layer: 'mod',
    });
    const weapons = extractWeapons(parseIniSections(WEAPONTYPES_INI), {
      file: 'weapons.ini',
      layer: 'mod',
    });
    // The tribe's `jobEnablesVehicle 51 37` edge keys into the vehicle table, so it must define
    // vehicle 37 (reed barge) for the cross-ref to resolve.
    const vehicles = extractVehicles(parseIniSections(VEHICLETYPES_INI), { file: 'vehicletypes.ini' });
    // The tribe binds jobTypes 50/51/55 and the weapons wield jobTypes 51/53, so the job set must
    // define them all (cross-ref resolvability — validateCrossReferences checks weapon.jobType too).
    const jobs = [
      ...extractJobs(parseIniSections(JOBTYPES_INI), { file: 'jobtypes.ini' }),
      { typeId: 50, id: 'job_50' },
      { typeId: 51, id: 'job_51' },
      { typeId: 53, id: 'job_53' },
      { typeId: 55, id: 'job_55' },
    ];
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods,
        jobs,
        buildings,
        weapons,
        vehicles,
        landscape,
        tribes,
        atomicAnimations,
      }),
    ).not.toThrow();
  });

  it('rejects a building that produces an unknown goodType (cross-reference)', () => {
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), { file: 'houses.ini', layer: 'mod' });
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [], // no goods defined -> the workplace's logicproduction ids dangle
        jobs: [{ typeId: 51, id: 'job_51' }], // the buildings' worker job, so the danglers are all good-side
        buildings,
      }),
    ).toThrow(/produces unknown goodType/);
  });

  it('rejects a good whose productionInputGoods names an unknown goodType (cross-reference)', () => {
    // coin consumes wood (5) + gold (7), but only wood is defined -> gold dangles.
    const goods = extractGoods(
      parseIniSections(
        '[goodtype]\nname "wood"\ntype 5\n[goodtype]\nname "coin"\ntype 8\nproductionInputGoods 5 7\n',
      ),
      { file: 'goodtypes.ini' },
    );
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods,
        jobs: [],
        buildings: [],
      }),
    ).toThrow(/good "coin" consumes unknown input goodType 7/);
  });

  it('rejects a good whose gathering stage names an unknown landscape typeId (cross-reference)', () => {
    // wood's harvest stage points at landscape 4, but the landscape table omits it -> the stage dangles.
    const goods = extractGoods(
      parseIniSections(
        '[goodtype]\nname "wood"\ntype 5\nlandscapetype 7\nlandscapeToHarvest 4\nlandscapeToPickup 6\nlandscapeToStore 7\n',
      ),
      { file: 'goodtypes.ini' },
    );
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods,
        jobs: [],
        buildings: [],
        landscape: [
          { typeId: 6, id: 'trunk' },
          { typeId: 7, id: 'wood' },
        ], // landscape 4 (the harvest source) is missing
      }),
    ).toThrow(/good "wood" gathering harvest references unknown landscape typeId 4/);
  });

  it('rejects a good whose `landscapetype` names an unknown landscape typeId (cross-reference)', () => {
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [{ typeId: 5, id: 'wood', landscapeType: 99 }],
        jobs: [],
        buildings: [],
        landscape: [],
      }),
    ).toThrow(/good "wood" references unknown landscape typeId 99/);
  });

  it('rejects a gatheringPipeline record whose good is unknown (cross-reference)', () => {
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [], // no good 5 -> the pipeline record dangles
        jobs: [],
        buildings: [],
        landscape: [{ typeId: 7, id: 'wood' }],
        gatheringPipeline: [{ goodType: 5, goodId: 'wood', store: { landscapeType: 7, gfxIndices: [] } }],
      }),
    ).toThrow(/gatheringPipeline good "wood" references unknown goodType 5/);
  });

  it('rejects a gatheringPipeline stage naming an unknown landscape typeId (cross-reference)', () => {
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [{ typeId: 5, id: 'wood' }],
        jobs: [],
        buildings: [],
        landscape: [], // the store stage's landscape 7 is missing
        gatheringPipeline: [{ goodType: 5, goodId: 'wood', store: { landscapeType: 7, gfxIndices: [] } }],
      }),
    ).toThrow(/gatheringPipeline good "wood" store references unknown landscape typeId 7/);
  });

  it('rejects a gatheringPipeline stage naming a gfx index no landscapeGfx record has (cross-reference)', () => {
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [{ typeId: 5, id: 'wood' }],
        jobs: [],
        buildings: [],
        landscape: [{ typeId: 7, id: 'wood' }],
        landscapeGfx: [], // no gfx records -> index 0 resolves to nothing
        gatheringPipeline: [{ goodType: 5, goodId: 'wood', store: { landscapeType: 7, gfxIndices: [0] } }],
      }),
    ).toThrow(/gatheringPipeline good "wood" store references unknown landscapeGfx index 0/);
  });

  it('rejects a tribe whose setatomic binds an unknown jobType (cross-reference)', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [], // no jobs defined -> the tribe's jobType bindings dangle
        buildings: [],
        tribes,
      }),
    ).toThrow(/unknown jobType/);
  });

  it('rejects a tribe whose jobEnables edge targets an unknown good (cross-reference)', () => {
    // job 5 exists, but the good it enables (99) is not defined -> the tech-graph edge dangles.
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings: [],
        tribes: [{ typeId: 1, id: 'fenling', jobEnables: [{ jobType: 5, kind: 'good', targetId: 99 }] }],
      }),
    ).toThrow(/enables unknown goodType 99/);
  });

  it('rejects a tribe whose jobEnables edge targets an unknown vehicle (cross-reference)', () => {
    // The vehicle kind keys into the `vehicletypes` `type` (`logicvehicletype`) namespace, now
    // extracted as `VehicleType.typeId` — so a dangling vehicle edge (targetId 3, no vehicle 3) is
    // caught like any other dangling tech-graph edge. (Buildings are a DIFFERENT namespace, so an
    // empty buildings list doesn't mask it.)
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings: [],
        vehicles: [{ typeId: 1, id: 'handcart' }],
        tribes: [{ typeId: 1, id: 'fenling', jobEnables: [{ jobType: 5, kind: 'vehicle', targetId: 3 }] }],
      }),
    ).toThrow(/enables unknown vehicleType 3/);
    // With vehicle 3 defined, the same edge resolves — mirrors the real data (jobEnablesVehicle ids
    // 1..5 are a subset of the vehicle typeIds 1..6).
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings: [],
        vehicles: [{ typeId: 3, id: 'oxcart' }],
        tribes: [{ typeId: 1, id: 'fenling', jobEnables: [{ jobType: 5, kind: 'vehicle', targetId: 3 }] }],
      }),
    ).not.toThrow();
  });

  it('rejects an experience track whose job (or good) is unknown (cross-reference)', () => {
    const jobExperience = extractJobExperience(parseIniSections(JOBXP_INI), {
      file: 'humanjobexperiencetypes.ini',
    });
    // "gatherer reed" (job 33, good 22): defining job 33 + job 34 but no goods -> the good 22 dangles.
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [
          { typeId: 33, id: 'job_33' },
          { typeId: 34, id: 'job_34' },
        ],
        buildings: [],
        jobExperience,
      }),
    ).toThrow(/jobExperience "gatherer_reed" references unknown goodType 22/);
    // With the goods defined but the job missing, the jobType dangles instead.
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [
          { typeId: 24, id: 'good_24' },
          { typeId: 22, id: 'good_22' },
        ],
        jobs: [], // no jobs -> every track's jobType dangles
        buildings: [],
        jobExperience,
      }),
    ).toThrow(/jobExperience "gatherer_basic" references unknown jobType 33/);
  });
});
