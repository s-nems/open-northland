import { LATE_GAME_FROM_TICKS, LATE_LATE_GAME_SETTLERS } from '../game-phase.js';
import { BARRACKS_LEAD_TICKS, UPPER_TOWER_LEAD_TICKS } from '../military/deadline.js';
import type { BuildLine, BuildOrderEntry } from './entries.js';

/** The late tail's denser tower ring, in world-metric nodes (authored): tighter than the opening
 *  tower circle (`./tower-coverage.ts`), so the finished settlement stands under overlapping towers. */
const DENSE_TOWER_RADIUS_NODES = 14;

/** How many of the seat's towers stand at the upper tier (authored): about the ring a settlement of medium
 *  room stands under. A tower the rings raised straight at the upper tier counts, so the upgrades only lift
 *  the lower towers of a seat whose attacks came early (`./direct-tier.ts`). */
const UPGRADED_TOWERS = 6;

/** One upgrade step per tower, so each upgrade is its own site and the line's lookahead paces them. */
const TOWER_UPGRADES: readonly BuildOrderEntry[] = Array.from({ length: UPGRADED_TOWERS }, (_, i) => ({
  kind: 'upgrade',
  building: 'tower_01',
  count: i + 1,
}));

/** Owner ruling: the catapult joinery belongs to the late late game, so it waits for its settlement and
 *  for the late game's clock: magiczny_las seats reached that settlement by game minute 71-85, which the
 *  owner still found too early. */
const CATAPULT_JOINERY_FROM_SETTLERS = LATE_LATE_GAME_SETTLERS;

/** The army line: the tower ring, the barracks, the towers' upgrades and the catapult joinery
 *  (`./entries.ts`). */
export const MILITARY_LINE: BuildLine = {
  id: 'military',
  // Owner ruling: the economy first, the army shortly before the military deadline. The tower ring and
  // the barracks wait for their leads before it; the seat's defence coming first lifts the waits at once.
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
    // The ring runs as a lane, so no later step of the line ever waits on it. Owner ruling: a tower rises at
    // the upper tier once the seat may raise it, the cheap lower one only while that tier is locked or
    // unsourced, or where the attacks come early (`./direct-tier.ts`). Owner ruling: the barracks goes up
    // before the ring, since it shoots like a tower and trains the army, so the ring waits for its site
    // past its own lead; a seat whose defence comes first raises its towers at once, the barracks beside
    // them.
    {
      kind: 'towerCoverage',
      building: 'tower_00',
      lane: true,
      holdUntil: {
        kind: 'all',
        holds: [
          { kind: 'deadline', leadTicks: UPPER_TOWER_LEAD_TICKS },
          { kind: 'placedUnlessDefending', building: 'barracks' },
        ],
      },
    },
    // On the settlement's edge toward the nearest enemy, where the attacks come from, or by the base while
    // enemies surround the seat (`./front.ts`); the barracks also holds the line in defence. Owner ruling:
    // it opens at its own lead, the economy growing until then.
    {
      kind: 'place',
      building: 'barracks',
      count: 1,
      near: [{ kind: 'front' }],
      holdUntil: { kind: 'deadline', leadTicks: BARRACKS_LEAD_TICKS },
    },
    // From the late game the denser ring runs as a second lane (authored): a tower wherever the first
    // leaves a building out. A filled settlement with no room for a tower holds the lane, not the line.
    {
      kind: 'towerCoverage',
      building: 'tower_00',
      radius: DENSE_TOWER_RADIUS_NODES,
      lane: true,
      fromTick: LATE_GAME_FROM_TICKS,
    },
    // Owner ruling: the standing towers go up to the upper tier slowly, once the seat makes the bricks and
    // pillars its bill asks for; an upgrade step holds its line until its bill has a source.
    ...TOWER_UPGRADES,
    // The catapult joinery stands by the barracks, where the army musters. A land map gets one top-tier
    // joinery, a sea map two. Last in the line, so its hold keeps no tower waiting.
    {
      kind: 'place',
      building: 'work_joinery_03',
      count: 1,
      near: [{ kind: 'building', id: 'barracks' }],
      role: 'catapult',
      holdUntil: {
        kind: 'all',
        holds: [
          { kind: 'settlers', count: CATAPULT_JOINERY_FROM_SETTLERS },
          { kind: 'tick', tick: LATE_GAME_FROM_TICKS },
        ],
      },
    },
  ],
};
