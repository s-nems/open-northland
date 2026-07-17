import type { TerrainMapFile } from '@open-northland/data';
import type { AuthoredJoinRows } from '../../src/slice/authored-placements.js';

/** The authored-entity fixtures the join tests and the `runAuthoredSlice` tests share: a decoded map's
 *  `StaticObjects` rows, and the narrow IR they resolve against. */

/** The narrow IR rows the joins read: two barracks levels, one job, one tribe — the same by-name keys
 *  the real ir.json carries (buildingBobs editName+level, jobs name, tribes id). */
export const AUTHORED_ROWS: AuthoredJoinRows = {
  buildingBobs: [
    { editName: 'viking barracks', level: 0, typeId: 30, tribeId: 1 },
    { editName: 'viking barracks', level: 1, typeId: 31, tribeId: 1 },
  ],
  buildings: [
    { typeId: 30, id: 'barracks', kind: 'workplace' },
    { typeId: 31, id: 'barracks_l1', kind: 'workplace' },
  ],
  jobs: [{ typeId: 7, id: 'builder', name: 'builder' }],
  tribes: [{ typeId: 1, id: 'viking' }],
  goods: [
    { typeId: 4, id: 'wheat', name: 'wheat' },
    { typeId: 9, id: 'stone', name: 'stone' },
  ],
};

export const AUTHORED_ENTITIES: NonNullable<TerrainMapFile['entities']> = {
  buildings: [
    // Resolves: editName+level → typeId 30; half-cell (8,4) passes VERBATIM; 0-based player 0 stays 0.
    // Its addgoods stock joins by good name ('wheat' → 4) or by the rare bare-typeId variant
    // ('9' → stone, Walhalla's `addgoods 49 1000` shape); the unknown name is dropped, house kept.
    {
      name: 'viking barracks',
      level: 0,
      player: 0,
      hx: 8,
      hy: 4,
      rot: 0,
      goods: [
        { name: 'wheat', count: 15 },
        { name: '9', count: 3 },
        { name: 'mystery_good', count: 3 },
      ],
    },
    // An out-of-range player (≥ MAX_PLAYERS) leaves the building neutral: owner omitted.
    { name: 'viking barracks', level: 1, player: 99, hx: 0, hy: 0 },
    { name: 'unknown house', level: 0, player: 0, hx: 2, hy: 2 }, // no buildingBobs row → skipped
    { name: 'viking barracks', level: 0, player: 0, hx: 99, hy: 0 }, // hx 99 ≥ node width 12 → skipped
  ],
  humans: [
    // Resolves: role → job typeId 7, tribe → typeId 1; node (3,5) verbatim; 0-based player 0 stays 0.
    { tribe: 'viking', role: 'builder', player: 0, hx: 3, hy: 5 },
    { tribe: 'viking', role: 'mystery_role', player: 0, hx: 3, hy: 5 }, // unknown role → skipped
  ],
  animals: [{ species: 'deer', hx: 1, hy: 1 }], // deferred (herd semantics) — never a placement
};
