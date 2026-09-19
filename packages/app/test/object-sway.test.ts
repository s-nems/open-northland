import { LOGIC_TYPE_NONE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  STILL_VEGETATION_SWAY,
  standingVegetationTypeIds,
  stillVegetationSway,
} from '../src/content/object-sway.js';

const TREE = 4;
const TREE_FALLING = 5;
const TRUNK = 6;
const BUSH = 7;
const ROCK = 15;
const LANDSCAPE = [
  { typeId: TREE, name: 'tree' },
  { typeId: TREE_FALLING, name: 'tree falling' },
  { typeId: TRUNK, name: 'trunk' },
  { typeId: BUSH, name: 'bush naked' },
  { typeId: ROCK, name: 'rock' },
];
/** Any walk-block area makes a record a tall object; the shape is irrelevant here. */
const TALL = { walkBlockAreas: [[0, 0, 0, 0]] } as const;

describe('stillVegetationSway: the breeze reaches only vegetation the original left still', () => {
  const standing = standingVegetationTypeIds(LANDSCAPE);

  it('resolves rooted vegetation by name and leaves out what has fallen', () => {
    expect([...standing]).toEqual([TREE]);
  });

  it('sways a single-frame tree', () => {
    expect(stillVegetationSway({ ...TALL, logicType: TREE }, false, standing)).toBe(STILL_VEGETATION_SWAY);
  });

  it('leaves a tree with an authored loop to its own frames', () => {
    expect(stillVegetationSway({ ...TALL, logicType: TREE }, true, standing)).toBeUndefined();
  });

  it('leaves rocks, trunks, falling trees, bushes and untyped records still', () => {
    for (const logicType of [ROCK, TRUNK, TREE_FALLING, BUSH, LOGIC_TYPE_NONE]) {
      expect(stillVegetationSway({ ...TALL, logicType }, false, standing)).toBeUndefined();
    }
  });

  it('leaves flat decor still, since its quads cannot shear', () => {
    expect(stillVegetationSway({ logicType: TREE }, false, standing)).toBeUndefined();
    expect(stillVegetationSway({ logicType: TREE, walkBlockAreas: [] }, false, standing)).toBeUndefined();
  });
});
