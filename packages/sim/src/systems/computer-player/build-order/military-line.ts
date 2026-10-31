import { LATE_GAME_FROM_TICKS, LATE_LATE_GAME_SETTLERS, MID_GAME_FROM_TICKS } from '../game-phase.js';
import { BARRACKS_LEAD_TICKS, UPPER_TOWER_LEAD_TICKS } from '../military/deadline.js';
import type { BuildLine, BuildOrderEntry, DefenceWants, StepHold } from './entries.js';

/** The settled ring's wants once the seat's economy is safe (owner ruling: later in the game towers cover
 *  the whole settlement): every building under an upper tower's garrison (20 in content), the front under
 *  two upper towers or the headquarters and a lower one, double the opening ring's (`./tower-defence.ts`). */
const SETTLED_DEFENCE: DefenceWants = { village: 20, front: 40 };

/** When the seat's economy is safe for the denser ring (owner ruling: towers over the whole settlement
 *  come later in the game): the brewery and the upper bakery stand, the food stage the housing lane calls
 *  thriving (`HOUSING_THRIVING_BUILDINGS`), and the mid game has begun. */
const ECONOMY_SAFE: StepHold = {
  kind: 'all',
  holds: [
    { kind: 'built', building: 'work_brewery' },
    { kind: 'built', building: 'work_bakery_01' },
    { kind: 'tick', tick: MID_GAME_FROM_TICKS },
  ],
};

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

/** The catapult joinery stands by the barracks, where the army musters. A land map gets one top-tier
 *  joinery, a sea map two. */
export const CATAPULT_JOINERY: BuildOrderEntry = {
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
};

/** The ship joinery's steps where only a ship reaches the nearest rival: a joinery by the water, the
 *  upper pottery whose tiles the top tier's bill takes, that joinery lifted to the top tier, and a fresh
 *  top-tier joinery by the water where none could claim the shore. While a tier is locked each lets the
 *  barracks and the rest of the line pass rather than hold them. */
const SHIP_JOINERY_STEPS: readonly BuildOrderEntry[] = [
  {
    kind: 'place',
    building: 'work_joinery_00',
    count: 1,
    near: [{ kind: 'shore' }],
    onlyWhen: 'rivalOverSea',
    role: 'ship',
    lockPasses: true,
    core: true,
  },
  { kind: 'upgrade', building: 'work_pottery_01', count: 1, onlyWhen: 'rivalOverSea', lockPasses: true },
  {
    kind: 'upgrade',
    building: 'work_joinery_03',
    count: 1,
    onlyWhen: 'rivalOverSea',
    role: 'ship',
    lockPasses: true,
  },
  {
    kind: 'place',
    building: 'work_joinery_03',
    count: 1,
    near: [{ kind: 'shore' }],
    onlyWhen: 'rivalOverSea',
    role: 'ship',
    lockPasses: true,
  },
];

/** The army line: the tower ring, the barracks, the towers' upgrades and the catapult joinery
 *  (`./entries.ts`). */
export const MILITARY_LINE: BuildLine = {
  id: 'military',
  // Owner ruling: the economy first, the army shortly before the military deadline. The tower ring and
  // the barracks wait for their leads before it; the seat's defence coming first lifts the waits at once.
  steps: [
    // Where only a ship reaches the nearest rival, the joinery that builds it is the economy's way across,
    // not a wait for the deadline. The top tier waits on the tile and ship discoveries, which arabskie_wyspy
    // seats made at game minute 36-48 or later (seed 7), and by then the settlement had taken every shore
    // spot it fits (seats 0-2), so a joinery claims the shore at once, at the tier the seat may raise, or
    // the seat's own joinery serves where it already stands by the water (`../joinery-role.ts`).
    ...SHIP_JOINERY_STEPS,
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
    // Once the seat's economy is safe the settled ring runs as a second lane (owner ruling: later in the
    // game towers cover the whole settlement, so no flank is left open): a tower wherever the defence
    // stays short of its higher wants. Both rings count the same tower sites, so together they keep the
    // first ring's pace. A filled settlement with no room for a tower holds the lane, not the line.
    {
      kind: 'towerCoverage',
      building: 'tower_00',
      defence: SETTLED_DEFENCE,
      lane: true,
      holdUntil: ECONOMY_SAFE,
    },
    // Owner ruling: the standing towers go up to the upper tier slowly, once the seat makes the bricks and
    // pillars its bill asks for; an upgrade step holds its line until its bill has a source.
    ...TOWER_UPGRADES,
    // Last in the line, so its hold keeps no tower waiting.
    CATAPULT_JOINERY,
  ],
};
