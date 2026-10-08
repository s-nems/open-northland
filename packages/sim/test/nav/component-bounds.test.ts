import { describe, expect, it } from 'vitest';
import { buildTerrainGraph } from '../../src/index.js';
import { NO_COMPONENT } from '../../src/nav/terrain/index.js';
import { testContent } from '../fixtures/content.js';
import { waterColumnMap } from '../fixtures/terrain.js';

/** Two banks of a channel: separate land components, each spanning part of the map. */
const MAP_W = 20;
const MAP_H = 6;
const CHANNEL_COLUMN = 8;

describe('TerrainGraph.componentBounds', () => {
  it('is the box of every node carrying each static label', () => {
    const graph = buildTerrainGraph(testContent(), waterColumnMap(MAP_W, MAP_H, CHANNEL_COLUMN));
    const expected = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (let y = 0; y < graph.height; y++) {
      for (let x = 0; x < graph.width; x++) {
        const label = graph.componentOf(graph.nodeAt(x, y));
        if (label === NO_COMPONENT) continue;
        const box = expected.get(label) ?? { minX: x, minY: y, maxX: x, maxY: y };
        expected.set(label, {
          minX: Math.min(box.minX, x),
          minY: Math.min(box.minY, y),
          maxX: Math.max(box.maxX, x),
          maxY: Math.max(box.maxY, y),
        });
      }
    }
    const west = graph.componentOf(graph.nodeAt(0, 0));
    const east = graph.componentOf(graph.nodeAt(graph.width - 1, 0));
    expect(west).not.toBe(east);
    expect(graph.componentBounds(west).maxX).toBeLessThan(graph.componentBounds(east).minX);
    for (const [label, box] of expected) expect(graph.componentBounds(label)).toEqual(box);
  });

  it('refuses a label no node carries', () => {
    const graph = buildTerrainGraph(testContent(), waterColumnMap(MAP_W, MAP_H, CHANNEL_COLUMN));
    expect(() => graph.componentBounds(NO_COMPONENT)).toThrow();
  });
});
