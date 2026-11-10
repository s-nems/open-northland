import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../../../src/data/projection/index.js';
import { collectSpriteScene, SceneItemMemo } from '../../../../src/data/scene/index.js';
import { entity, snapshotOf } from '../../../support/fixtures.js';

const VIEW: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
/** Frames nothing the specs place, so every entity is culled. */
const VIEW_NONE: Viewport = { minX: 1e9, maxX: 1e9 + 1, minY: 1e9, maxY: 1e9 + 1 };
/** Frames tile (6, 6) alone of the tiles the signpost spec places posts on. */
const VIEW_OF_POST: Viewport = { minX: 350, maxX: 470, minY: 200, maxY: 260 };
const TREE = 1;
const PILE = 2;
const WORKER = 3;
const HOUSE = 4;
const POST = 5;
const FAR_POST = 6;

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

  it('hands an unchanged building its item again, and a changed one a new item', () => {
    const memo = new SceneItemMemo();
    const house = entity(HOUSE, 6, 6, { Building: { buildingType: 2, tribe: 0, level: 0, built: 1 } });
    const first = scene(snapshotOf([house, worker]), memo).find((item) => item.ref === HOUSE);
    expect(scene(snapshotOf([house, worker], 2), memo).find((item) => item.ref === HOUSE)).toBe(first);
    const raised = entity(HOUSE, 6, 6, { Building: { buildingType: 2, tribe: 0, level: 1, built: 1 } });
    const next = scene(snapshotOf([raised, worker], 3), memo).find((item) => item.ref === HOUSE);
    expect(next).not.toBe(first);
    expect(next?.level).toBe(1);
  });

  it('keeps a signpost and its boards while the posts it links to hold, and reads them again after', () => {
    const memo = new SceneItemMemo();
    const post = entity(POST, 6, 6, { Signpost: { links: [FAR_POST] }, Owner: { player: 0 } });
    const far = entity(FAR_POST, 6, 2, { Signpost: { links: [POST] }, Owner: { player: 0 } });
    const ofPost = (items: readonly { ref: number; boardIndex?: number }[]) =>
      items.filter((item) => item.ref === POST || item.boardIndex !== undefined);
    const first = ofPost(scene(snapshotOf([post, far]), memo, VIEW_OF_POST));
    expect(first).toHaveLength(2);
    const again = ofPost(scene(snapshotOf([post, far], 2), memo, VIEW_OF_POST));
    expect(again.map((item, i) => item === first[i])).toEqual([true, true]);
    // The linked post moved, so the board turns: neither it nor the post's memo stands.
    const moved = entity(FAR_POST, 10, 6, { Signpost: { links: [POST] }, Owner: { player: 0 } });
    const turned = ofPost(scene(snapshotOf([post, moved], 3), memo, VIEW_OF_POST));
    expect(turned).toEqual(ofPost(scene(snapshotOf([post, moved], 3), undefined, VIEW_OF_POST)));
    expect(turned.find((item) => item.boardIndex !== undefined)?.boardIndex).not.toBe(
      first.find((item) => item.boardIndex !== undefined)?.boardIndex,
    );
  });

  it('assembles a walking settler fresh on every build, and hands an idle one its item again', () => {
    const memo = new SceneItemMemo();
    const walker = entity(WORKER, 3, 3, { Settler: { tribe: 0 }, PathFollow: {} });
    const walking = scene(snapshotOf([walker]), memo)[0];
    expect(scene(snapshotOf([walker], 2), memo)[0]).not.toBe(walking);
    const idle = scene(snapshotOf([worker], 3), memo)[0];
    expect(scene(snapshotOf([worker], 4), memo)[0]).toBe(idle);
  });
});
