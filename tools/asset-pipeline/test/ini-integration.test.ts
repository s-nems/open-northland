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

/**
 * A `parseContentSet` input carrying this suite's manifest + the always-required empty tables, with
 * `overrides` replacing whichever tables the case under test supplies.
 */
const contentSet = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
  goods: [],
  jobs: [],
  buildings: [],
  ...overrides,
});

/**
 * Extractor output → schema: every case runs a real `extract*` and asserts what `parseContentSet`
 * makes of its records. Cross-reference rules over hand-built IR belong to the package that owns the
 * validator (`packages/data/test/cross-references.test.ts`), not here.
 */
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
      parseContentSet(
        contentSet({
          goods,
          jobs,
          buildings,
          weapons,
          vehicles,
          landscape,
          tribes,
          atomicAnimations,
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a building that produces an unknown goodType (cross-reference)', () => {
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), { file: 'houses.ini', layer: 'mod' });
    expect(() =>
      parseContentSet(
        contentSet({
          goods: [], // no goods defined -> the workplace's logicproduction ids dangle
          jobs: [{ typeId: 51, id: 'job_51' }], // the buildings' worker job, so the danglers are all good-side
          buildings,
        }),
      ),
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
      parseContentSet(
        contentSet({
          goods,
        }),
      ),
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
      parseContentSet(
        contentSet({
          goods,
          landscape: [
            { typeId: 6, id: 'trunk' },
            { typeId: 7, id: 'wood' },
          ], // landscape 4 (the harvest source) is missing
        }),
      ),
    ).toThrow(/good "wood" gathering harvest references unknown landscape typeId 4/);
  });

  it('rejects a tribe whose setatomic binds an unknown jobType (cross-reference)', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    expect(() =>
      parseContentSet(
        contentSet({
          jobs: [], // no jobs defined -> the tribe's jobType bindings dangle
          tribes,
        }),
      ),
    ).toThrow(/unknown jobType/);
  });

  it('rejects an experience track whose job (or good) is unknown (cross-reference)', () => {
    const jobExperience = extractJobExperience(parseIniSections(JOBXP_INI), {
      file: 'humanjobexperiencetypes.ini',
    });
    // "gatherer reed" (job 33, good 22): defining job 33 + job 34 but no goods -> the good 22 dangles.
    expect(() =>
      parseContentSet(
        contentSet({
          jobs: [
            { typeId: 33, id: 'job_33' },
            { typeId: 34, id: 'job_34' },
          ],
          jobExperience,
        }),
      ),
    ).toThrow(/jobExperience "gatherer_reed" references unknown goodType 22/);
    // With the goods defined but the job missing, the jobType dangles instead.
    expect(() =>
      parseContentSet(
        contentSet({
          goods: [
            { typeId: 24, id: 'good_24' },
            { typeId: 22, id: 'good_22' },
          ],
          jobs: [], // no jobs -> every track's jobType dangles
          jobExperience,
        }),
      ),
    ).toThrow(/jobExperience "gatherer_basic" references unknown jobType 33/);
  });
});
