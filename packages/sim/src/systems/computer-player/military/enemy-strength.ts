import {
  diplomacyStance,
  Health,
  MAX_PLAYERS,
  Person,
  Position,
  seatPeaceEndTick,
} from '../../../components/index.js';
import { isPlayerDead } from '../../../components/match.js';
import type { World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import {
  defendingStrength,
  strongestEnemyStrength,
  TOWER_POST_STRENGTH,
} from '../../ai-shared/military/census.js';
import { isManningPost } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { ownedFightersOf } from '../../movement/collision/owned-fighters.js';
import { fogHides, playerSeesNode } from '../../vision/gates.js';
import { believedEnemyBuildings, believedFighterStrength } from '../knowledge/intel/index.js';
import { waveBandAt } from './plan.js';

/**
 * The strength the seat expects a wave to meet at `owner`'s settlement, weighed like `census.ts`
 * `defendingStrength`. With nothing hidden that is the live count. An enemy the seat knows nothing of
 * counts as `own`: parity, so the launch rule neither benches a wave nor sends one into odds it has seen.
 */
export function believedDefendingStrength(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
  own: number,
): number {
  if (!fogHides(ctx.fog)) return defendingStrength(world, ctx, owner);
  return knownStrength(world, ctx, seat, owner, TOWER_POST_STRENGTH) ?? own;
}

/**
 * The fighters the strongest enemy the seat knows of fields, counted one to one like `census.ts`
 * `strongestEnemyStrength`, which is the live count read with nothing hidden; 0 with no live enemy.
 * Enemies it knows nothing of are left out while it knows another; when it knows none, they count as
 * the opening band of a wave sent at the seat's own phase of the game, so a blind seat still arms.
 */
export function strongestBelievedEnemy(world: World, ctx: SystemContext, seat: number): number {
  if (!fogHides(ctx.fog)) return strongestEnemyStrength(world, ctx, seat);
  let strongest: number | null = null;
  let anyEnemy = false;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || diplomacyStance(world, seat, other) !== 'enemy' || isPlayerDead(world, other))
      continue;
    anyEnemy = true;
    const known = knownStrength(world, ctx, seat, other, COUNTED_ONCE);
    if (known !== null) strongest = Math.max(strongest ?? 0, known);
  }
  if (strongest !== null) return strongest;
  return anyEnemy ? waveBandAt(ctx.tick - seatPeaceEndTick(world, seat)).min : 0;
}

/** A posted man's weight when men are counted one to one. */
const COUNTED_ONCE = 1;

/**
 * `owner`'s fighters as `seat` knows them, each man holding a post weighed `postedWeight`: the larger of
 * those in sight now and the remembered peak with the posts it saw manned; null when it has neither.
 * Costs `owner`'s fighters and the seat's memory.
 */
function knownStrength(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
  postedWeight: number,
): number | null {
  let seen = 0;
  let inSight = 0;
  for (const e of ownedFightersOf(world, ctx.content, owner)) {
    if (!world.has(e, Person) || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    const pos = world.tryGet(e, Position);
    if (pos === undefined) continue;
    if (!playerSeesNode(ctx.fog, seat, nodeHxOfPosition(pos.x, pos.y), nodeHyOfPosition(pos.x, pos.y)))
      continue;
    inSight++;
    seen += isManningPost(world, ctx, e) ? postedWeight : 1;
  }
  const peak = believedFighterStrength(world, seat, owner, ctx.tick);
  if (peak === null) return inSight > 0 ? seen : null;
  let posted = 0;
  for (const b of believedEnemyBuildings(world, seat)) if (b.owner === owner) posted += b.posted;
  // The peak counts each posted man once already.
  return Math.max(seen, peak + posted * (postedWeight - 1));
}
