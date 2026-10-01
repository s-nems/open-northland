import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../src/data/projection/index.js';
import { collectSpriteScene, SceneItemMemo } from '../../src/data/scene/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const VIEW: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
/** Frames nothing the specs place, so every entity is culled. */
const VIEW_NONE: Viewport = { minX: 1e9, maxX: 1e9 + 1, minY: 1e9, maxY: 1e9 + 1 };
const TREE = 1;
const PILE = 2;
const WORKER = 3;

const tree = entity(TREE, 2, 2, { Resource: { goodType: 3 } });
const pile = entity(PILE, 4, 2, { Stockpile: { goods: { 5: 2 } } });
const worker = entity(WORKER, 3, 3, { Settler: { tribe: 0 } });

function scene(snapshot: WorldSnapshot, memo?: SceneItemMemo, viewport: Viewport = VIEW) {
  return collectSpriteScene(snapshot, { viewport }, undefined, memo).items;
}

describe('SceneItemMemo', () => {
  it('builds the same items as a build without it', () => {
    const memo = new SceneItemMemo();
    const snapshot = snapshotOf([tree, pile, worker]);
    scene(snapshot, memo);
    expect(scene(snapshotOf([tree, pile, worker], 2), memo)).toEqual(scene(snapshot));
  });

  it('reuses the item of an unchanged self-contained entity, also after a culled build', () => {
    const memo = new SceneItemMemo();
    const first = scene(snapshotOf([tree, worker]), memo).find((item) => item.ref === TREE);
    expect(scene(snapshotOf([tree, worker], 2), memo, VIEW_NONE)).toEqual([]);
    const again = scene(snapshotOf([tree, worker], 3), memo).find((item) => item.ref === TREE);
    expect(again).toBe(first);
  });

  it('rebuilds the item of an entity whose object changed', () => {
    const memo = new SceneItemMemo();
    scene(snapshotOf([tree]), memo);
    const felled = entity(TREE, 2, 2, { Resource: { goodType: 4 } });
    const item = scene(snapshotOf([felled], 2), memo)[0];
    expect(item?.goodType).toBe(4);
  });

  it('assembles a settler fresh on every build', () => {
    const memo = new SceneItemMemo();
    const first = scene(snapshotOf([worker]), memo)[0];
    expect(scene(snapshotOf([worker], 2), memo)[0]).not.toBe(first);
  });
});
