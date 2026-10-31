import { describe, expect, it } from 'vitest';
import { buildingHitpoints, createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { messages } from '../../../src/i18n/index.js';
import {
  COLLECTOR_JOB,
  FRANK,
  FRANK_SMITHY_HITPOINTS,
  GOOD,
  HARE_TRIBE,
  HOUSE,
  knowledgeContent,
  SABER_JOB,
  SMITH_JOB,
  SMITHY_HITPOINTS,
  SPEAR_CLIP_TICKS,
  VIKING,
  WOLF_TRIBE,
} from '../../support/knowledge-content.js';

const base = () => createKnowledgeBase(knowledgeContent());

describe('the knowledge base goods', () => {
  it('hides the meals, sausage, fruit and the two pseudo goods, and keeps the fish', () => {
    const ids = base().goods.map((g) => g.id);
    for (const hidden of ['food_simple', 'food_extra', 'sausage', 'fruit', 'chest', 'anything']) {
      expect(ids).not.toContain(hidden);
    }
    expect(ids).toContain('fish');
  });

  it('answers a meal type with its dish, in lookups and in the recipes that name it', () => {
    const knowledge = base();
    expect(knowledge.goodByType.get(GOOD.food_simple)?.id).toBe('bread');
    expect(knowledge.goodByType.get(GOOD.food_extra)?.id).toBe('candy');
    const amulet = knowledge.buildingById.get('work_bakery_00')?.recipes[1];
    expect(amulet?.inputs[0]?.goodType).toBe(GOOD.bread);
    expect(knowledge.buildingById.get('work_druid_00')?.tech?.goods[0]?.id).toBe(GOOD.bread);
  });

  it('completes a decoded good with the equip effects the content does not carry', () => {
    expect(base().goodById.get('amulet_food')?.equip?.category).toBe('misc');
  });

  it('names a good through the catalog', () => {
    expect(base().goodById.get('wood')?.name).toBe(messages().goods.wood);
  });

  it('reads a dish meal off the eat clips, doubled at home, candy on its own clip', () => {
    const knowledge = base();
    expect(knowledge.goodById.get('bread')?.meal).toEqual({
      hungerPct: 40,
      homeHungerPct: 80,
      leisurePct: 0,
    });
    expect(knowledge.goodById.get('candy')?.meal).toEqual({
      hungerPct: 60,
      homeHungerPct: 120,
      leisurePct: 40,
    });
    expect(knowledge.goodById.get('wood')?.meal).toBeNull();
  });

  it('takes production inputs as a slaughter only for a good no recipe makes', () => {
    const knowledge = base();
    expect(knowledge.goodById.get('leather')?.slaughterInputs).toEqual([
      { goodType: GOOD.cattle, amount: 1 },
    ]);
    expect(knowledge.goodById.get('flour')?.slaughterInputs).toEqual([]);
  });

  it('carries the original description when the help table has one', () => {
    const knowledge = createKnowledgeBase(knowledgeContent(), {
      goods: { [GOOD.wood]: 'Good timber.' },
      houses: { [HOUSE.mill]: 'Grinds.' },
    });
    expect(knowledge.goodById.get('wood')?.help).toBe('Good timber.');
    expect(knowledge.goodById.get('iron')?.help).toBeNull();
    expect(knowledge.buildingById.get('work_mill_00')?.help).toBe('Grinds.');
  });
});

describe('the knowledge base buildings', () => {
  it('leaves the wall piece out', () => {
    expect(base().buildingById.has('work_murek')).toBe(false);
  });

  it("reads a building's durability per tribe, the lowest tribe's for the rest", () => {
    const smithy = base().buildingById.get('work_smithy_00');
    expect(smithy).toBeDefined();
    if (smithy === undefined) return;
    expect(buildingHitpoints(smithy, FRANK)).toBe(FRANK_SMITHY_HITPOINTS);
    expect(buildingHitpoints(smithy, VIKING)).toBe(SMITHY_HITPOINTS);
  });
});

describe('the knowledge base jobs', () => {
  it('lists only the trades the reference tribe may hold', () => {
    const knowledge = base();
    expect(knowledge.jobByType.has(SMITH_JOB)).toBe(true);
    expect(knowledge.jobByType.has(SABER_JOB)).toBe(false);
  });

  it('keeps a civil trade school course, unnamed marker dropped, and refuses a fighter one', () => {
    const knowledge = base();
    expect(knowledge.jobById.get('smith')?.requirements.map((r) => [r.route, r.experience.length])).toEqual([
      ['need', 1],
      ['train', 0],
    ]);
    expect(knowledge.jobById.get('soldier_spear_wooden')?.requirements).toEqual([]);
  });

  it('traces a requirement to the job whose practice counts', () => {
    expect(base().jobById.get('smith')?.requirements[0]?.fromJobs).toEqual([COLLECTOR_JOB]);
  });

  it('files tech edges by kind, skipping vehicles, and collects the gatherers', () => {
    const knowledge = base();
    expect(Object.keys(knowledge.jobById.get('smith')?.enables ?? {})).toEqual(['house']);
    expect(knowledge.gatheredBy.get(GOOD.wood)?.map((w) => w.jobType)).toEqual([COLLECTOR_JOB]);
    expect(knowledge.goodRequirements.get(GOOD.iron)?.[0]?.amount).toBe(5);
  });
});

describe('the knowledge base fighters', () => {
  it('counts a weapon clip and its blows, and marks a row no tribe may field', () => {
    const rows = base().weapons.get(VIKING) ?? [];
    expect(rows.find((w) => w.id === 'wooden_spear')).toMatchObject({
      clipTicks: SPEAR_CLIP_TICKS,
      blows: 2,
      usable: true,
    });
    expect(rows.find((w) => w.id === 'short_saber')).toMatchObject({
      clipTicks: null,
      blows: 1,
      usable: false,
    });
  });

  it('times no house bow by the clip of the job its row names', () => {
    const rows = base().weapons.get(VIKING) ?? [];
    expect(rows.find((w) => w.id === 'house_bow')?.clipTicks).toBeNull();
  });

  it('keeps only a tribe-wide step reduction, one tied to a job is that unit', () => {
    const knowledge = base();
    expect(knowledge.tribes.find((t) => t.typeId === FRANK)?.stepReduction).toBe(2);
    expect(knowledge.tribes.find((t) => t.typeId === VIKING)?.stepReduction).toBe(0);
  });

  it('calls an animal aggressive only when it has a weapon to swing', () => {
    const knowledge = base();
    expect(knowledge.animals.find((a) => a.tribe === WOLF_TRIBE)).toMatchObject({
      aggressive: true,
      name: 'wolves',
    });
    expect(knowledge.animals.find((a) => a.tribe === HARE_TRIBE)).toMatchObject({
      aggressive: false,
      weapon: null,
    });
  });

  it('skips a pool-less swarm, a species nothing draws and the ox-less cart stage', () => {
    const knowledge = base();
    expect(knowledge.animals.map((a) => a.tribe)).toEqual([WOLF_TRIBE, HARE_TRIBE]);
    expect(knowledge.vehicles.map((v) => v.id)).toEqual(['handcart']);
  });
});
