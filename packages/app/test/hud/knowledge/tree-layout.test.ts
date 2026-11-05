import type { BuildingType, ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { GOOD_LANES } from '../../../src/hud/knowledge/lanes.js';
import {
  BUILDING_CARD_HEIGHT,
  CARD_WIDTH,
  GOOD_CARD_HEIGHT,
  goodKey,
  layoutLane,
  type PlaneRect,
  relateBuilding,
  relateGood,
  spotLine,
  type TreeNode,
  tradeOf,
  treeNodeOf,
} from '../../../src/hud/knowledge/tree-layout.js';
import { FRANK, GOOD, HOUSE, knowledgeContent, SMITH_JOB, VIKING } from '../../support/knowledge-content.js';

const node = (key: string, ...kids: readonly TreeNode[]): TreeNode => ({ key, kids });

describe('layoutLane', () => {
  it('sets a parent level with its first child and steps the next kid a row down', () => {
    const { cards } = layoutLane([node('a', node('b'), node('c'))], GOOD_CARD_HEIGHT);
    const at = (key: string) => cards.find((c) => c.key === key);
    expect(at('a')?.row).toBe(at('b')?.row);
    expect(at('b')?.col).toBe(1);
    expect(at('c')?.row).toBe(1);
  });

  it('routes a level line straight and a lower one through the bus', () => {
    const { lines } = layoutLane([node('a', node('b'), node('c'))], GOOD_CARD_HEIGHT);
    const line = (to: string) => lines.find((l) => l.to === to);
    expect(line('b')?.path).not.toContain('Q');
    expect(line('c')?.path).toContain('Q');
  });

  it('tucks a small root beside a big one only where cards and buses stay clear', () => {
    const { cards } = layoutLane([node('a', node('b'), node('c')), node('d')], GOOD_CARD_HEIGHT);
    expect(cards.find((c) => c.key === 'd')).toMatchObject({ col: 0, row: 1 });
    const beside = layoutLane([node('a', node('b'), node('c')), node('d', node('e'))], GOOD_CARD_HEIGHT);
    expect(beside.cards.find((c) => c.key === 'e')).toMatchObject({ col: 1, row: 2 });
  });

  it('fits the plane round its cards', () => {
    const { width, height, cards } = layoutLane([node('a', node('b'))], GOOD_CARD_HEIGHT);
    const right = Math.max(...cards.map((c) => c.x + c.width));
    expect(width).toBeGreaterThan(right);
    expect(height).toBeGreaterThan(GOOD_CARD_HEIGHT);
    expect(cards[0]?.width).toBe(CARD_WIDTH);
  });

  it('keys an authored lane by card', () => {
    const lane = GOOD_LANES[0];
    expect(lane).toBeDefined();
    const root = lane?.roots[0];
    if (root === undefined) return;
    expect(treeNodeOf(root, goodKey).key).toBe('good:wheat');
  });
});

describe('spotLine', () => {
  const card = (left: number, top: number): PlaneRect => ({
    left,
    right: left + CARD_WIDTH,
    top,
    bottom: top + BUILDING_CARD_HEIGHT,
    mid: top + BUILDING_CARD_HEIGHT / 2,
  });
  const NEXT_COLUMN = 200;
  const FAR_COLUMN = 800;
  const LOWER_ROW = 300;
  /** Where a path or head starts, as [x, y]. */
  const start = (d: string): number[] => (/^M(\S+) (\S+?)[A-Za-z]/.exec(d) ?? []).slice(1).map(Number);

  it('runs side to side into a target clear to the right', () => {
    const from = card(0, 0);
    const to = card(NEXT_COLUMN, LOWER_ROW);
    const { path, head } = spotLine(from, to);
    expect(start(path)).toEqual([from.right, from.mid]);
    expect(start(head)).toEqual([to.left, to.mid]);
  });

  it('bows under the row into the bottom of a target to the left in the same row', () => {
    const from = card(FAR_COLUMN, 0);
    const to = card(0, 0);
    const { path, head } = spotLine(from, to);
    expect(start(path)).toEqual([(from.left + from.right) / 2, from.bottom]);
    expect(start(head)).toEqual([(to.left + to.right) / 2, to.bottom]);
  });

  it('bows rather than cutting through the cards between in the same row', () => {
    const { head } = spotLine(card(0, 0), card(FAR_COLUMN, 0));
    expect(start(head)).toEqual([FAR_COLUMN + CARD_WIDTH / 2, BUILDING_CARD_HEIGHT]);
  });

  it('drops from the bottom edge into the top of a target below in the same column', () => {
    const from = card(0, 0);
    const to = card(0, LOWER_ROW);
    const { path, head } = spotLine(from, to);
    expect(start(path)).toEqual([CARD_WIDTH / 2, from.bottom]);
    expect(start(head)).toEqual([CARD_WIDTH / 2, to.top]);
  });

  it('rises from the top edge into the bottom of a target above', () => {
    const from = card(0, LOWER_ROW);
    const to = card(0, 0);
    const { path, head } = spotLine(from, to);
    expect(start(path)).toEqual([CARD_WIDTH / 2, from.top]);
    expect(start(head)).toEqual([CARD_WIDTH / 2, to.bottom]);
  });
});

describe('chains over the cards', () => {
  const base = createKnowledgeBase(knowledgeContent());

  it('relates a good to its whole chain and draws its links', () => {
    const relation = relateGood(base, 'good:flour');
    expect(relation.up).toEqual(new Set(['good:wheat']));
    expect(relation.down).toEqual(new Set(['good:bread', 'good:amulet_food']));
    expect(relation.links).toEqual([
      { from: 'good:wheat', to: 'good:flour', kind: 'up' },
      { from: 'good:flour', to: 'good:bread', kind: 'down' },
    ]);
  });

  it('answers empty for a key it does not hold', () => {
    expect(relateGood(base, 'good:nothing').links).toEqual([]);
  });

  it('relates a building through its lane parents and the workplace of its discovery', () => {
    const relation = relateBuilding(base, 'building:work_druid_00', FRANK);
    expect(relation.up).toEqual(new Set(['building:work_herb_hut', 'building:work_smithy_00']));
    expect(relation.down).toEqual(new Set(['building:work_druid_01']));
    expect(relation.links).toEqual([
      { from: 'building:work_smithy_00', to: 'building:work_druid_00', kind: 'up' },
    ]);
  });

  /** The smithy upgrades to the bakery, and the druid's hut is built of the bakery's bread. */
  function materialBase() {
    const content = knowledgeContent();
    const edit = (row: BuildingType): BuildingType => {
      if (row.typeId === HOUSE.smithy) return { ...row, upgradeTarget: HOUSE.bakery };
      if (row.typeId === HOUSE.druid) return { ...row, construction: [{ goodType: GOOD.bread, amount: 1 }] };
      return row;
    };
    const edited: ContentSet = { ...content, buildings: content.buildings.map(edit) };
    return createKnowledgeBase(edited);
  }

  it('links the level that makes a construction good instead of a lower level of its line', () => {
    const relation = relateBuilding(materialBase(), 'building:work_druid_00', FRANK);
    expect(relation.links).toEqual([
      { from: 'building:work_bakery_00', to: 'building:work_druid_00', kind: 'up' },
    ]);
    expect(relation.up).toEqual(
      new Set(['building:work_herb_hut', 'building:work_smithy_00', 'building:work_bakery_00']),
    );
  });

  it('keeps the discovery link when the tribe may not raise the material house', () => {
    const relation = relateBuilding(materialBase(), 'building:work_druid_00', VIKING);
    expect(relation.links).toEqual([
      { from: 'building:work_smithy_00', to: 'building:work_druid_00', kind: 'up' },
    ]);
  });

  it('skips the porters and gatherers when naming what a workshop is for', () => {
    const smithy = base.buildingById.get('work_smithy_00');
    const mill = base.buildingById.get('work_mill_00');
    if (smithy === undefined || mill === undefined) throw new Error('no fixture buildings');
    expect(tradeOf(base, smithy)?.jobType).toBe(SMITH_JOB);
    expect(tradeOf(base, mill)).toBeUndefined();
  });
});
