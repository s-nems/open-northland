import { describe, expect, it } from 'vitest';
import {
  decodeClientMemory,
  encodeClientMemory,
} from '../../../../src/view/runtime/save-load/client-memory.js';
import type { FogMemory } from '../../../../src/view/runtime/save-load/fog-memory.js';

const MEMORY: FogMemory = {
  mapId: 'magiczny_las',
  seat: 0,
  statics: {
    player: 0,
    reconSeeded: true,
    ghosts: [
      { ref: 4, kind: 'building', tileX: 5, tileY: 4, typeId: 7, tribe: 1, builtPct: 40, owner: 2 },
      {
        ref: 9,
        kind: 'palisade',
        tileX: 8.5,
        tileY: 6,
        shiftX: -17,
        palisadeSite: 'claimed',
        palisadePosts: [{ dx: 3, dy: -2, gfxIndex: 11, variantStep: 1, builtPct: 80 }],
      },
    ],
  },
  roads: [33, 34],
  layer: {
    removed: [1, 2],
    held: [
      [40, 3, 12],
      [41, 5, 'ripe'],
      [42, 6, null],
    ],
  },
};

const NAMES = [{ entity: 12, pool: 'viking-male', raw: 'Harald', name: 'Ada' }];

describe('client memory in a save', () => {
  it('reads back what it wrote', () => {
    expect(decodeClientMemory(encodeClientMemory({ fog: MEMORY, names: NAMES }))).toEqual({
      fog: MEMORY,
      names: NAMES,
    });
    const blank = { mapId: null, seat: null, statics: null, roads: [], layer: null };
    expect(decodeClientMemory(encodeClientMemory({ fog: blank, names: [] }))).toEqual({
      fog: blank,
      names: [],
    });
  });

  it('reads absent, foreign or malformed text as no memory instead of failing the load', () => {
    const none = { fog: null, names: [] };
    expect(decodeClientMemory(null)).toEqual(none);
    expect(decodeClientMemory('not json')).toEqual(none);
    const raw = JSON.parse(encodeClientMemory({ fog: MEMORY, names: NAMES }));
    expect(decodeClientMemory(JSON.stringify({ ...raw, version: 0 }))).toEqual(none);
  });

  it('drops a malformed fog memory and keeps the names beside it', () => {
    const raw = JSON.parse(encodeClientMemory({ fog: MEMORY, names: NAMES }));
    const withFog = (fog: unknown) => decodeClientMemory(JSON.stringify({ ...raw, fog }));
    expect(withFog({ ...raw.fog, roads: [-1] })).toEqual({ fog: null, names: NAMES });
    const ghost = (extra: object) => ({
      ...raw.fog,
      statics: { ...raw.fog.statics, ghosts: [{ ...raw.fog.statics.ghosts[0], ...extra }] },
    });
    expect(withFog(ghost({ kind: 'settler' })).fog).toBeNull();
    expect(withFog(ghost({ typeId: 'house' })).fog).toBeNull();
    expect(withFog(ghost({ unknownField: 1 })).fog).toBeNull();
    expect(withFog({ ...raw.fog, layer: { ...raw.fog.layer, held: [[40, 3]] } }).fog).toBeNull();
  });

  it('drops a malformed name row and keeps the rest', () => {
    const raw = JSON.parse(encodeClientMemory({ fog: null, names: NAMES }));
    const rows = [...raw.names, [-1, 'viking-male', 'Bjarni', 'X'], [3, 'viking-male', 'Bjarni'], 'Ada'];
    expect(decodeClientMemory(JSON.stringify({ ...raw, names: rows })).names).toEqual(NAMES);
  });
});
