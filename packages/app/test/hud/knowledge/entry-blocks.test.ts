import { describe, expect, it } from 'vitest';
import { createKnowledgeBase, type KnowledgeBuilding } from '../../../src/hud/knowledge/base.js';
import {
  animalBlocks,
  buildingBlocks,
  buildingCapacity,
  capacityShows,
  categoryRows,
  goodBlocks,
  jobBlocks,
  jobFamily,
  jobsLedTo,
  levelChain,
  missingTech,
  placeOf,
  rawCostAddsSteps,
  tribeDifferences,
  tribeHeroes,
  tribeWeapons,
  vehicleHolds,
} from '../../../src/hud/knowledge/entry-blocks.js';
import type { KnowledgeAnimal, KnowledgeBase, KnowledgeGood } from '../../../src/hud/knowledge/model.js';
import { FRANK, knowledgeContent, VIKING } from '../../support/knowledge-content.js';

const HERO_UNARMED = 42;
const SOLDIER = 31;
const TRADE = 8;

const base = (): KnowledgeBase => createKnowledgeBase(knowledgeContent());

const shows = { aura: false, capacity: false, teaches: false, levels: false };

function building(over: Partial<KnowledgeBuilding>): KnowledgeBuilding {
  const row = base().buildings[0];
  if (row === undefined) throw new Error('fixture has a building');
  return { ...row, recipes: [], workers: [], tech: null, ...over };
}

describe('entry places', () => {
  it('sends a vehicle good and a yard to the vehicle page', () => {
    const b = base();
    expect(placeOf(b, { kind: 'good', id: 'handcart' }).family).toBe('vehicle');
  });

  it('files a weapon good under arms and bread under goods', () => {
    const b = base();
    expect(placeOf(b, { kind: 'good', id: 'spear_wooden' })).toMatchObject({
      category: 'arms',
      family: 'weapon',
    });
    expect(placeOf(b, { kind: 'good', id: 'armor_leather' }).family).toBe('armour');
    expect(placeOf(b, { kind: 'good', id: 'bread' }).category).toBe('goods');
  });

  it('keeps a hidden good and the catapult stone out of arms', () => {
    const b = base();
    const arms = categoryRows(b, 'arms').map((row) => row.entry.id);
    expect(arms).not.toContain('fruit');
    expect(arms).not.toContain('stone');
    expect(categoryRows(b, 'goods').map((row) => row.entry.id)).not.toContain('fruit');
  });
});

describe('block selection', () => {
  const good = (over: Partial<KnowledgeGood>): KnowledgeGood => {
    const row = base().goods[0];
    if (row === undefined) throw new Error('fixture has a good');
    return { ...row, equip: null, meal: null, ...over };
  };

  it('leads a good with its effect and hides the cost of a one-step good', () => {
    const plain = goodBlocks(good({}), { cost: false });
    expect(plain).not.toContain('effect');
    expect(plain).not.toContain('cost');
    const worn = goodBlocks(good({ equip: { category: 'misc', wears: false } }), { cost: true });
    expect(worn.slice(0, 3)).toEqual(['status', 'effect', 'obtain']);
    expect(worn.at(-1)).toBe('origin');
  });

  it('orders a building as the player reads it', () => {
    const b = building({
      recipes: [{ inputs: [], outputs: [], madeGood: null, fallbackTicks: 1 }],
      workers: [{ jobType: 8, name: 'x', count: 1 }],
      tech: { jobs: [], goods: [] },
    });
    expect(buildingBlocks(b, { ...shows, levels: true })).toEqual([
      'status',
      'output',
      'workers',
      'build',
      'discover',
      'levels',
      'health',
      'links',
      'origin',
    ]);
  });

  it('gives a hero no way to learn his trade', () => {
    expect(jobFamily({ typeId: HERO_UNARMED })).toBe('hero');
    expect(jobBlocks('hero', { does: true })).not.toContain('learn');
    expect(jobBlocks('hero', { does: true })).not.toContain('leadsTo');
  });

  it('shows a soldier his arms and training, a trade its workplace', () => {
    expect(jobFamily({ typeId: SOLDIER })).toBe('soldier');
    expect(jobBlocks('soldier', { does: false })).toEqual(['arms', 'train', 'links']);
    expect(jobFamily({ typeId: TRADE })).toBe('trade');
    expect(jobBlocks('trade', { does: true }).slice(0, 3)).toEqual(['does', 'worksIn', 'learn']);
  });

  it('drops the yield and attack an animal does not have', () => {
    const animal = { carcass: [], weapon: null } as unknown as KnowledgeAnimal;
    expect(animalBlocks(animal)).toEqual(['facts', 'film', 'hunt', 'links']);
  });
});

describe('building facts', () => {
  it('reads a uniform storehouse as a capacity per good', () => {
    const store = building({
      kind: 'storage',
      stock: [
        { goodType: 1, capacity: 70 },
        { goodType: 2, capacity: 70 },
      ],
    });
    expect(buildingCapacity(store).store).toEqual({ perGood: 70, goods: 2 });
  });

  it('reads a home by its first shelf and shows nothing for a plain workshop', () => {
    const home = building({ kind: 'home', homeSize: 2, stock: [{ goodType: 1, capacity: 15 }] });
    expect(buildingCapacity(home).larder).toBe(15);
    expect(capacityShows(buildingCapacity(building({ kind: 'workplace', stock: [] })))).toBe(false);
  });

  it('walks a level line from any of its houses', () => {
    const b = base();
    const low = b.buildings[0];
    const high = b.buildings[1];
    if (low === undefined || high === undefined) throw new Error('fixture has two buildings');
    const linked: KnowledgeBase = {
      ...b,
      buildings: [{ ...low, upgradeTarget: high.typeId }, high],
      buildingByType: new Map([
        [low.typeId, low],
        [high.typeId, high],
      ]),
    };
    expect(levelChain(linked, high).map((row) => row.typeId)).toEqual([low.typeId, high.typeId]);
  });

  it('narrows a discovery list to what is missing', () => {
    const tech = { jobs: [{ id: 1, name: 'Smith' }], goods: [{ id: 2, name: 'Iron' }] };
    expect(missingTech(tech, ['Iron'])).toEqual({ jobs: [], goods: tech.goods });
  });
});

describe('raw cost', () => {
  it('hides a cost that only repeats one step', () => {
    const b = base();
    const flour = b.goodById.get('flour');
    if (flour === undefined) throw new Error('fixture has flour');
    expect(rawCostAddsSteps(b, flour)).toBe(false);
  });
});

describe('vehicles', () => {
  it('hides a hold the vehicle does not have', () => {
    const holds = vehicleHolds({ stockSlots: 0, passengerSlots: 9 } as Parameters<typeof vehicleHolds>[0]);
    expect(holds).toEqual({ cargo: false, passengers: true });
  });
});

describe('tribes', () => {
  it('finds no difference between a tribe and itself', () => {
    const b = base();
    expect(tribeDifferences(b, VIKING, VIKING)).toEqual({ stepSeconds: null, weapons: [], buildings: [] });
  });

  it('reports a building sturdier than the reference', () => {
    const b = base();
    const rows = tribeDifferences(b, FRANK, VIKING).buildings;
    expect(rows.some((row) => row.own > row.reference)).toBe(true);
  });

  it('closes the weapon table with the catapult', () => {
    const b = base();
    const catapult = { ...rowOf(b), id: 'catapult', mainType: 7, goodType: 3, jobType: 54 };
    const melee = rowOf(b);
    const rows = tribeWeapons({ ...b, weapons: new Map([[VIKING, [catapult, melee]]]) }, VIKING);
    expect(rows.map((row) => row.id)).toEqual([melee.id, 'catapult']);
  });

  it('lists a hero by his job, not a row that only carries the prefix', () => {
    const b = base();
    const stray = { ...rowOf(b), id: 'hero_fist', jobType: 32 };
    const hero = { ...rowOf(b), id: 'hero_spear', jobType: 43 };
    const rows = tribeHeroes({ ...b, weapons: new Map([[VIKING, [stray, hero]]]) }, VIKING);
    expect(rows.map((row) => row.id)).toEqual(['hero_spear']);
  });
});

describe('jobs', () => {
  it('never leads to a hero', () => {
    const b = base();
    const job = b.jobs[0];
    if (job === undefined) throw new Error('fixture has a job');
    const hero = {
      ...job,
      typeId: HERO_UNARMED,
      requirements: [{ route: 'need', amount: 1, experience: [], fromJobs: [job.typeId] }],
    } as const;
    expect(jobsLedTo({ ...b, jobs: [job, hero] }, job)).toEqual([]);
  });
});

function rowOf(b: KnowledgeBase) {
  const row = b.weapons.get(VIKING)?.[0];
  if (row === undefined) throw new Error('fixture has a weapon');
  return { ...row, usable: true, goodType: 39 };
}
