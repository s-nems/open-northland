import { diplomacyStance, MAX_PLAYERS, Position, seatPeaceEndTick } from '../../../components/index.js';
import { isPlayerDead } from '../../../components/match.js';
import type { World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import { TOWER_POST_STRENGTH } from '../../ai-shared/military/census.js';
import { isManningPost } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { ownedFightersOf } from '../../movement/collision/owned-fighters.js';
import { fogHides, playerSeesNode } from '../../vision/gates.js';
import {
  believedEnemyBuildings,
  believedFighterPoints,
  believedFighterStrength,
} from '../knowledge/intel/index.js';
import { armyWearsArmour, isFitSoldier } from './fit.js';
import { waveBandAt } from './plan.js';
import { type ArmyPoints, armyPointsOf, COUNTED_ONCE, isLiveFighter, unitPoints } from './points.js';

/** `player`'s own fighters and points, tower garrisons counted once: the army the seat commands, its fit
 *  soldiers alone ({@link isFitSoldier}). */
export function ownArmyPoints(
  world: World,
  ctx: SystemContext,
  player: number,
  wearsArmour: boolean = armyWearsArmour(world, ctx, player),
): ArmyPoints {
  return armyPointsOf(world, ctx, player, COUNTED_ONCE, NEVER_POSTED, (e) =>
    isFitSoldier(world, ctx, e, wearsArmour),
  );
}

/**
 * The points the seat expects a wave to meet at `owner`'s settlement, each man holding a tower post weighed
 * `postedWeight` times. With nothing hidden that is the live army. An enemy the seat knows nothing of
 * counts as `own`: parity, so the launch rule neither benches a wave nor sends one into odds it has seen.
 */
export function believedDefendingPoints(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
  own: number,
  postedWeight: number = TOWER_POST_STRENGTH,
): number {
  return knownDefendingPoints(world, ctx, seat, owner, postedWeight) ?? own;
}

/** {@link believedDefendingPoints}, null for an enemy the seat knows nothing of. */
export function knownDefendingPoints(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
  postedWeight: number = TOWER_POST_STRENGTH,
): number | null {
  if (!fogHides(ctx.fog)) {
    return armyPointsOf(world, ctx, owner, postedWeight, (e) => isManningPost(world, ctx, e)).points;
  }
  return knownArmy(world, ctx, seat, owner, postedWeight)?.points ?? null;
}

/** The strongest enemy as the seat believes him: his men, and his points, null when it knows none. */
export interface BelievedArmy {
  readonly men: number;
  readonly points: number | null;
}

/**
 * The strongest enemy the seat knows of, by points, his tower posts counted once; with nothing hidden the
 * live armies, and none with no live enemy. Enemies it knows nothing of are left out while it knows
 * another; when it knows none, they count as the opening band of a wave sent at the seat's own phase of
 * the game, points unknown, so a blind seat still arms. Seats in `skip` are left out. Costs the enemies'
 * fighters.
 */
export function strongestBelievedEnemy(
  world: World,
  ctx: SystemContext,
  seat: number,
  skip: ReadonlySet<number> = NOBODY,
): BelievedArmy {
  const hidden = fogHides(ctx.fog);
  let strongest: ArmyPoints | null = null;
  let anyEnemy = false;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || skip.has(other) || diplomacyStance(world, seat, other) !== 'enemy') continue;
    if (hidden && isPlayerDead(world, other)) continue;
    anyEnemy = true;
    const army = hidden
      ? knownArmy(world, ctx, seat, other, COUNTED_ONCE)
      : armyPointsOf(world, ctx, other, COUNTED_ONCE, NEVER_POSTED);
    if (army !== null && (strongest === null || army.points > strongest.points)) strongest = army;
  }
  if (strongest !== null) return strongest;
  if (!hidden || !anyEnemy) return NO_ARMY;
  return { men: waveBandAt(ctx.tick - seatPeaceEndTick(world, seat)).min, points: null };
}

const NO_ARMY: BelievedArmy = { men: 0, points: 0 };
const NOBODY: ReadonlySet<number> = new Set();

const NEVER_POSTED = (): boolean => false;

/**
 * `owner`'s army as `seat` knows it, each man holding a post weighed `postedWeight`: the larger of those in
 * sight now (a man aboard a vehicle has no `Position` and is never in sight) and the remembered peak with
 * the posts it saw manned; null when it has neither. Costs `owner`'s fighters and the seat's memory.
 */
function knownArmy(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
  postedWeight: number,
): ArmyPoints | null {
  let men = 0;
  let points = 0;
  for (const e of ownedFightersOf(world, ctx.content, owner)) {
    if (!isLiveFighter(world, e)) continue;
    const pos = world.tryGet(e, Position);
    if (pos === undefined) continue;
    if (!playerSeesNode(ctx.fog, seat, nodeHxOfPosition(pos.x, pos.y), nodeHyOfPosition(pos.x, pos.y)))
      continue;
    men++;
    const value = unitPoints(world, ctx, e);
    points += postedWeight !== COUNTED_ONCE && isManningPost(world, ctx, e) ? value * postedWeight : value;
  }
  const peakPoints = believedFighterPoints(world, seat, owner, ctx.tick);
  if (peakPoints === null) return men > 0 ? { men, points } : null;
  let postedPoints = 0;
  for (const b of believedEnemyBuildings(world, seat)) if (b.owner === owner) postedPoints += b.postedPoints;
  // The peak counts each posted man once already.
  return {
    men: Math.max(men, believedFighterStrength(world, seat, owner, ctx.tick) ?? 0),
    points: Math.max(points, peakPoints + postedPoints * (postedWeight - COUNTED_ONCE)),
  };
}
