import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { GOOD_LANES } from '../../../src/hud/knowledge/lanes.js';
import {
  CARD_WIDTH,
  GOOD_CARD_HEIGHT,
  goodKey,
  layoutLane,
  relateBuilding,
  relateGood,
  spotLine,
  type TreeNode,
  tradeOf,
  treeNodeOf,
} from '../../../src/hud/knowledge/tree-layout.js';
import { knowledgeContent, SMITH_JOB } from '../../support/knowledge-content.js';

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
  it('ends its curve at the arrow head of the target card', () => {
    const { path, head } = spotLine({ left: 0, right: 10, mid: 5 }, { left: 100, right: 110, mid: 50 });
    expect(path.startsWith('M10 5C')).toBe(true);
    expect(head.startsWith('M100 50')).toBe(true);
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
    const relation = relateBuilding(base, 'building:work_druid_00');
    expect(relation.up).toEqual(new Set(['building:work_herb_hut', 'building:work_smithy_00']));
    expect(relation.down).toEqual(new Set(['building:work_druid_01']));
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
