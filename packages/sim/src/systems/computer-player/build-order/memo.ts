import { Building, Upgrading } from '../../../components/index.js';
import type { ContentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { seatBaseOf } from '../base.js';
import { seatHerdKept } from '../herd.js';
import { type JoineryRole, joineryRoles } from '../joinery-role.js';
import { seatNeedsShips } from '../sea-route.js';
import { grassScarce } from './grass-reserve.js';

/** One decision's answers, so the entries that ask the same question work it out once: whether the map
 *  holds a live resource, per good type, whether the seat needs ships, whether the seat is short of
 *  grass, and the top-tier joineries' roles. */
export interface DecisionMemo {
  readonly live: Map<number, boolean>;
  needsShips: boolean | undefined;
  grassScarce: boolean | undefined;
  /** Whether the seat keeps no pair of either livestock species (`../herd.ts`). */
  herdless: boolean | undefined;
  roleOf: ((joinery: Entity) => JoineryRole) | undefined;
  /** The seat's live flags by the one good each holder gathers. */
  flagsByGood: ReadonlyMap<number, number> | undefined;
  /** {@link OwnedTally} per owned-building list the decision asks about. */
  readonly tallies: Map<readonly Entity[], OwnedTally>;
}

/** One owned-building list counted once, so each entry sums its tiers instead of walking the list. */
export interface OwnedTally {
  readonly byType: ReadonlyMap<number, number>;
  readonly homes: number;
  /** Each building with an upgrade in flight: its type and the tier it is becoming. */
  readonly upgrading: readonly (readonly [type: number, becoming: number])[];
}

export function ownedTally(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  memo: DecisionMemo,
): OwnedTally {
  const known = memo.tallies.get(owned);
  if (known !== undefined) return known;
  const byType = new Map<number, number>();
  let homes = 0;
  const upgrading: (readonly [number, number])[] = [];
  for (const e of owned) {
    const type = world.get(e, Building).buildingType;
    byType.set(type, (byType.get(type) ?? 0) + 1);
    const ownedType = index.buildings.get(type);
    if (ownedType?.kind === 'home') homes++;
    const becoming = world.tryGet(e, Upgrading)?.target;
    if (becoming !== undefined) upgrading.push([type, becoming]);
  }
  const tally = { byType, homes, upgrading };
  memo.tallies.set(owned, tally);
  return tally;
}

export function decisionMemo(): DecisionMemo {
  return {
    live: new Map(),
    needsShips: undefined,
    grassScarce: undefined,
    herdless: undefined,
    roleOf: undefined,
    flagsByGood: undefined,
    tallies: new Map(),
  };
}

export function memoFlagsByGood(
  world: World,
  ctx: SystemContext,
  player: number,
  memo: DecisionMemo,
): ReadonlyMap<number, number> {
  if (memo.flagsByGood === undefined) {
    const flags = new Map<number, number>();
    for (const e of homeSettlers(world, ctx, player)) {
      if (liveWorkFlag(world, e) === undefined) continue;
      const good = heldGatherGood(world, ctx, e);
      if (good !== undefined) flags.set(good, (flags.get(good) ?? 0) + 1);
    }
    memo.flagsByGood = flags;
  }
  return memo.flagsByGood;
}

/** Whether the seat keeps no pair of either livestock species, asked once a decision. */
export function memoHerdless(world: World, ctx: SystemContext, player: number, memo: DecisionMemo): boolean {
  memo.herdless ??= seatHerdKept(world, ctx, player) === 'none';
  return memo.herdless;
}

/** {@link grassScarce} around the seat's base; false with no base or terrain. */
export function memoGrassScarce(
  world: World,
  ctx: SystemContext,
  player: number,
  memo: DecisionMemo,
): boolean {
  if (memo.grassScarce === undefined) {
    const base = seatBaseOf(world, ctx, player);
    const node = base === null ? null : anchorNodeOf(world, base);
    memo.grassScarce = node !== null && ctx.terrain !== undefined && grassScarce(ctx.terrain, node);
  }
  return memo.grassScarce;
}

export function memoNeedsShips(
  world: World,
  ctx: SystemContext,
  player: number,
  memo: DecisionMemo,
): boolean {
  memo.needsShips ??= seatNeedsShips(world, ctx, player);
  return memo.needsShips;
}

export function memoRoles(
  world: World,
  ctx: SystemContext,
  player: number,
  memo: DecisionMemo,
): (joinery: Entity) => JoineryRole {
  memo.roleOf ??= joineryRoles(world, ctx, player, () => memoNeedsShips(world, ctx, player, memo));
  return memo.roleOf;
}
