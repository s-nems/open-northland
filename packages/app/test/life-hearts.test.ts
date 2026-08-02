import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { computeLifeHearts } from '../src/view/projections/life-hearts.js';
import { building, type Ent, snapshotOf } from './support/snapshot.js';

const LIVESTOCK_TRIBE = 19;
const PEOPLE_TRIBE = 1;
const PLAYER = 0;
const ENEMY = 1;
const STORE_TYPE = 2;

type Pool = { hitpoints: number; max: number };

const unit = (id: number, tribe: number, player: number, health?: Pool): Ent => ({
  id,
  components: {
    Settler: { tribe },
    Owner: { player },
    Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
    ...(health !== undefined ? { Health: health } : {}),
  },
});

const animal = (id: number, health?: Pool): Ent => unit(id, LIVESTOCK_TRIBE, PLAYER, health);
const person = (id: number, health?: Pool, player = PLAYER): Ent => unit(id, PEOPLE_TRIBE, player, health);

const heartsOf = (entities: Ent[], selected?: ReadonlySet<number>) =>
  computeLifeHearts(snapshotOf(entities), {
    isLivestockTribe: (tribe) => tribe === LIVESTOCK_TRIBE,
    selected,
  });

const hearts = (...entities: Ent[]) => heartsOf(entities);

/** The heart's fill level: `Health` projected as a [0, 1] fraction, defaulting to full when the
 *  snapshot carries no usable pool (the render side has no "unknown" state to draw). */
describe('computeLifeHearts - the life fraction', () => {
  it('projects Health as hitpoints/max', () => {
    expect(hearts(animal(1, { hitpoints: 250, max: 1000 }))[0]?.life).toBe(0.25);
  });

  it('a missing or empty pool projects as full, an overfull one clamps', () => {
    expect(hearts(animal(1))[0]?.life).toBe(1);
    expect(hearts(animal(2, { hitpoints: 5, max: 0 }))[0]?.life).toBe(1);
    expect(hearts(animal(3, { hitpoints: 1500, max: 1000 }))[0]?.life).toBe(1);
  });

  it('an animal inside the workplace (Resting - not drawn) gets no heart', () => {
    const visiting = animal(1);
    const inside: Ent = { id: 1, components: { ...visiting.components, Resting: { at: 9 } } };
    expect(hearts(inside)).toHaveLength(0);
  });
});

describe('computeLifeHearts - who among the people wears one', () => {
  it('an unhurt person wears none until the player selects them', () => {
    const whole = person(1, { hitpoints: 100, max: 100 });
    expect(hearts(whole)).toHaveLength(0);
    expect(heartsOf([whole], new Set([1]))[0]?.life).toBe(1);
  });

  it('one percent of the pool spent is enough to show the wound', () => {
    expect(hearts(person(1, { hitpoints: 99, max: 100 }))).toHaveLength(1);
    expect(hearts(person(2, { hitpoints: 999, max: 1000 }))).toHaveLength(0);
  });

  it('a wounded enemy wears its own faction colour, not ours', () => {
    const ours = person(1, { hitpoints: 50, max: 100 });
    const theirs = person(2, { hitpoints: 50, max: 100 }, ENEMY);
    const [mine, enemy] = hearts(ours, theirs);
    expect(mine?.colour).not.toBe(enemy?.colour);
  });

  it('a selected person inside a building (Resting - not drawn) still gets no heart', () => {
    const outside = person(1, { hitpoints: 100, max: 100 });
    const inside: Ent = { id: 1, components: { ...outside.components, Resting: { at: 9 } } };
    expect(heartsOf([inside], new Set([1]))).toHaveLength(0);
  });

  it('a wounded carrier mid-exchange inside a store (not drawn either) gets no heart', () => {
    const store = building(9, STORE_TYPE, 1, 1);
    const hurt = person(1, { hitpoints: 50, max: 100 });
    const inside: Ent = {
      id: 1,
      components: { ...hurt.components, CurrentAtomic: { effect: { kind: 'pileup', store: store.id } } },
    };
    expect(hearts(hurt)).toHaveLength(1); // the same settler, still outside
    expect(heartsOf([store, inside])).toHaveLength(0);
  });
});
