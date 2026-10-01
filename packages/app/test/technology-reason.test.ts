import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_COLLECTOR, JOB_FARMER } from '../src/catalog/jobs.js';
import { GOOD_WHEAT } from '../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { technologyLabel, technologyName, technologyReason, vehicleLabel } from '../src/game/technology.js';
import { messages } from '../src/i18n/index.js';

const content = sandboxContent(grassTerrain(8, 8));
const [anyJob] = content.jobs;
const [anyGood] = content.goods;
if (anyJob === undefined || anyGood === undefined) throw new Error('the sandbox declares jobs and goods');

/** Rows the sandbox lacks, as extracted content carries them: the content `name` is the source slug. */
const FISHER_SEA = 9023;
const TRADER_SEA = 9026;
const BABY_MALE = 9002;
const HERO_SPEAR = 9043;
const VEHICLE_CART = 9050;
const FISH = 9022;
const extracted = {
  ...content,
  jobs: [
    ...content.jobs,
    ...[
      { typeId: FISHER_SEA, id: 'fisher_sea' },
      { typeId: TRADER_SEA, id: 'trader_sea' },
      { typeId: BABY_MALE, id: 'baby_male' },
      { typeId: HERO_SPEAR, id: 'hero_spear_siegfried' },
      { typeId: VEHICLE_CART, id: 'vehicle_cart' },
    ].map((row) => ({ ...anyJob, ...row, name: row.id })),
  ],
  goods: [...content.goods, { ...anyGood, typeId: FISH, id: 'fish', name: 'fish' }],
};
const open = { allowed: true, enabled: true, enablingJobs: [], requiredJobs: [], requiredGoods: [] };

describe('technologyReason', () => {
  it('names a forbidden type, nothing for an open one', () => {
    expect(technologyReason(content, { ...open, allowed: false })).toBe(messages().hud.technologyForbidden);
    expect(technologyReason(content, open)).toBeNull();
  });

  it('names the trade whose work discovers a missing good, unless that trade is missing itself', () => {
    const wheat = technologyLabel(content, 'good', GOOD_WHEAT);
    const farmer = technologyLabel(content, 'job', JOB_FARMER);
    const collector = technologyLabel(content, 'job', JOB_COLLECTOR);
    const byFarmer = technologyReason(content, {
      ...open,
      enabled: false,
      requiredGoods: [{ good: GOOD_WHEAT, jobs: [JOB_FARMER] }],
    });
    expect(byFarmer).toBe(`${messages().hud.technologyRequires} ${wheat} (${farmer})`);
    const missingTrade = technologyReason(content, {
      ...open,
      enabled: false,
      requiredJobs: [JOB_FARMER],
      requiredGoods: [{ good: GOOD_WHEAT, jobs: [JOB_FARMER] }],
    });
    expect(missingTrade).toBe(`${messages().hud.technologyRequires} ${farmer}, ${wheat}`);
    const byEnabler = technologyReason(content, { ...open, enabled: false, enablingJobs: [JOB_COLLECTOR] });
    expect(byEnabler).toBe(`${messages().hud.technologyRequires} ${collector}`);
  });
});

describe('technologyName', () => {
  it('names off-roster trades, life stages, heroes and goods from the catalogs, never by slug', () => {
    const text = messages();
    expect(technologyName(extracted, 'job', FISHER_SEA)).toBe(text.profession.fisher_sea);
    expect(technologyName(extracted, 'job', TRADER_SEA)).toBe(text.profession.trader_sea);
    expect(technologyName(extracted, 'job', BABY_MALE)).toBe(text.roleNames.baby_male);
    expect(technologyName(extracted, 'job', HERO_SPEAR)).toBe(text.heroNames.hero_unarmed);
    expect(technologyName(extracted, 'good', FISH)).toBe(text.goods.fish);
  });

  it('leaves a row no catalog names unnamed, and a plain-string seam reads it empty', () => {
    expect(technologyName(extracted, 'job', VEHICLE_CART)).toBeUndefined();
    expect(technologyLabel(extracted, 'job', VEHICLE_CART)).toBe('');
  });

  it('drops an unnamed trade from a requirement list', () => {
    const fisher = technologyLabel(extracted, 'job', FISHER_SEA);
    const reason = technologyReason(extracted, {
      ...open,
      enabled: false,
      enablingJobs: [VEHICLE_CART, FISHER_SEA],
    });
    expect(reason).toBe(`${messages().hud.technologyRequires} ${fisher}`);
  });

  it('names a vehicle only through the goods catalog', () => {
    const [vehicle] = content.vehicles;
    if (vehicle === undefined) throw new Error('the sandbox declares vehicles');
    const renamed = { vehicles: [{ ...vehicle, id: 'unlisted_cart', name: 'unlisted_cart' }] };
    expect(vehicleLabel(renamed, vehicle.typeId)).toBeUndefined();
  });
});
