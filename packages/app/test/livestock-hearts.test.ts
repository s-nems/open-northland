import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { computeLivestockHearts } from '../src/view/projections/livestock-hearts.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/** The heart's fill level: `Health` projected as a [0, 1] fraction, defaulting to full when the
 *  snapshot carries no usable pool (the render side has no "unknown" state to draw). */

const LIVESTOCK_TRIBE = 19;
const PLAYER = 0;

const animal = (id: number, health?: { hitpoints: number; max: number }): Ent => ({
  id,
  components: {
    Settler: { tribe: LIVESTOCK_TRIBE },
    Owner: { player: PLAYER },
    Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
    ...(health !== undefined ? { Health: health } : {}),
  },
});

const hearts = (...entities: Ent[]) =>
  computeLivestockHearts(snapshotOf(entities), (tribe) => tribe === LIVESTOCK_TRIBE, undefined);

describe('computeLivestockHearts - the life fraction', () => {
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
