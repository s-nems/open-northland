import { describe, expect, it } from 'vitest';
import { buildTerrainGraph, type TerrainGraph } from '../../../src/index.js';
import { ClusterRegions, NO_REGION } from '../../../src/nav/pathfinding/cluster-regions.js';
import { testContent } from '../../fixtures/content.js';
import { StampedMask } from '../../fixtures/stamped-mask.js';

const GRASS = 0;
const SIZE = 48;
/** A row through the middle of the second cluster row. */
const WALL_ROW = 24;

function open(): TerrainGraph {
  return buildTerrainGraph(testContent(), {
    resolution: 'half-cell',
    width: SIZE,
    height: SIZE,
    typeIds: new Array<number>(SIZE * SIZE).fill(GRASS),
  });
}

describe('ClusterRegions', () => {
  it('splits a cluster a wall cuts and joins it again once the wall opens', () => {
    const terrain = open();
    const mask = new StampedMask(terrain);
    const regions = new ClusterRegions(terrain, mask);
    const above = terrain.nodeAt(20, WALL_ROW - 2);
    const below = terrain.nodeAt(20, WALL_ROW + 2);
    regions.refresh();
    expect(regions.regionOf(above)).toBe(regions.regionOf(below));

    for (let x = 0; x < SIZE; x++) mask.flip(terrain.nodeAt(x, WALL_ROW));
    regions.refresh();
    expect(regions.regionOf(above)).not.toBe(regions.regionOf(below));
    expect(regions.regionOf(terrain.nodeAt(20, WALL_ROW))).toBe(NO_REGION);
    expect(regions.linksOf(regions.regionOf(above))).not.toContain(regions.regionOf(below));
    expect(regions.verify()).toEqual([]);

    mask.flip(terrain.nodeAt(20, WALL_ROW));
    regions.refresh();
    expect(regions.regionOf(above)).toBe(regions.regionOf(below));
    expect(regions.verify()).toEqual([]);
  });

  it('reports a cluster whose node flipped without a stamp', () => {
    const terrain = open();
    const mask = new StampedMask(terrain);
    const regions = new ClusterRegions(terrain, mask);
    regions.refresh();
    regions.regionOf(terrain.nodeAt(20, 20));
    mask.flip(terrain.nodeAt(21, 21), false);
    expect(regions.verify()).toHaveLength(1);
  });
});
