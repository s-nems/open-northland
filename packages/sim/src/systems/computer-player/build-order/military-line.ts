import { LATE_GAME_FROM_TICKS } from '../game-phase.js';
import { BARRACKS_LEAD_TICKS, TOWER_LEAD_TICKS } from '../military/deadline.js';
import type { BuildLine } from './entries.js';

/** The late tail's denser tower ring, in world-metric nodes (authored): tighter than the opening
 *  tower circle (`./tower-coverage.ts`), so the finished settlement stands under overlapping towers. */
const DENSE_TOWER_RADIUS_NODES = 14;

/** The army line: the barracks, the tower ring and the catapult joinery (`./entries.ts`). */
export const MILITARY_LINE: BuildLine = {
  id: 'military',
  // Owner ruling: the economy first, the army shortly before the military deadline. The barracks and the
  // tower ring wait for their leads before it, the catapult joinery behind them; the seat's defence
  // coming first lifts the waits at once.
  steps: [
    // Where only a ship reaches the nearest rival, the joinery that builds it goes up by the water early:
    // it is the economy's way across, not a wait for the deadline.
    {
      kind: 'place',
      building: 'work_joinery_03',
      count: 1,
      near: [{ kind: 'shore' }],
      onlyWhen: 'rivalOverSea',
      role: 'ship',
    },
    // On the settlement's edge toward the nearest enemy, where the attacks come from; the barracks also
    // holds the line in defence.
    {
      kind: 'place',
      building: 'barracks',
      count: 1,
      near: [{ kind: 'front' }],
      holdUntil: { kind: 'deadline', leadTicks: BARRACKS_LEAD_TICKS },
    },
    {
      kind: 'towerCoverage',
      building: 'tower_01',
      holdUntil: { kind: 'deadline', leadTicks: TOWER_LEAD_TICKS },
    },
    // From the late game the denser ring runs as a lane behind the first, one site out of the four the
    // late game opens (authored): a tower wherever it leaves a building out. A filled settlement with no
    // room for a tower holds the lane, not the line.
    {
      kind: 'towerCoverage',
      building: 'tower_01',
      radius: DENSE_TOWER_RADIUS_NODES,
      lane: true,
      fromTick: LATE_GAME_FROM_TICKS,
    },
    // The catapult joinery stands by the barracks, where the army musters. A land map gets one top-tier
    // joinery, a sea map two.
    {
      kind: 'place',
      building: 'work_joinery_03',
      count: 1,
      near: [{ kind: 'building', id: 'barracks' }],
      role: 'catapult',
    },
  ],
};
