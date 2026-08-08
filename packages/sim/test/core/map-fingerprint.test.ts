import { terrainGridFingerprint } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

describe('Simulation.mapFingerprint', () => {
  it('digests the exact half-cell grid the sim navigates', () => {
    const map = grassCellMap(4, 3);
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    expect(sim.mapFingerprint).toBe(terrainGridFingerprint(map));
  });

  it('is undefined for a mapless sim', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(sim.mapFingerprint).toBeUndefined();
  });

  it('differs between maps that differ in one node', () => {
    const map = grassCellMap(4, 3);
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    const other = { ...map, typeIds: [...map.typeIds] };
    const OTHER_TYPE_ID = 1;
    other.typeIds[0] = OTHER_TYPE_ID;
    expect(terrainGridFingerprint(other)).not.toBe(sim.mapFingerprint);
  });
});
