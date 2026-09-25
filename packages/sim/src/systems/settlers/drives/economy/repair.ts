import { Damaged, Palisade, Position, SiteAssignment } from '../../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { BattleFront } from '../../../conflict/battle-alert.js';
import type { SystemContext } from '../../../context.js';
import { REPAIR_CREW_LIMIT } from '../../../economy/repair.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, BUILD_WALL_ATOMIC_ID, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { claimWorkCell } from '../spacing.js';

/**
 * How long a building or wall must go unhit before an automatic crew comes to mend it, so builders are not sent
 * into an attack that is still landing - an archer out of sight included. Authored: a damaged house in the
 * original recruits builders whatever is going on around it, though its computer players hold their own
 * repair orders while an enemy soldier is near.
 */
export const REPAIR_CALM_TICKS = 10 * TICKS_PER_SECOND;

/**
 * The repair crews of one planner pass: which damaged buildings and walls are safe to send a builder to,
 * and how many builders each already has. A crew member is a builder whose {@link SiteAssignment} names
 * the site, counted on the first question and topped up by the pass's own picks.
 */
export class RepairCrews {
  private crews: Map<Entity, number> | null = null;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly front: BattleFront,
  ) {}

  /** Whether an automatic crew may walk to `site`: its last blow is {@link REPAIR_CALM_TICKS} behind it
   *  and no fight is on around it. A player's order skips this; the player chose the risk. */
  isSafe(site: Entity): boolean {
    const mark = this.world.tryGet(site, Damaged);
    if (mark === undefined) return false;
    if (mark.lastHitTick !== null && this.ctx.tick - mark.lastHitTick < REPAIR_CALM_TICKS) return false;
    const p = this.world.get(site, Position);
    return !this.front.fightNear(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  }

  /** Whether `builder` may join the crew at `site`: it already belongs to it, or the crew has room. */
  hasRoom(site: Entity, builder: Entity): boolean {
    if (this.world.tryGet(builder, SiteAssignment)?.site === site) return true;
    return (this.crewSizes().get(site) ?? 0) < REPAIR_CREW_LIMIT;
  }

  /** Count `builder` into the crew at `site` for the rest of the pass. */
  join(site: Entity, builder: Entity): void {
    if (this.world.tryGet(builder, SiteAssignment)?.site === site) return;
    const crews = this.crewSizes();
    crews.set(site, (crews.get(site) ?? 0) + 1);
  }

  private crewSizes(): Map<Entity, number> {
    if (this.crews !== null) return this.crews;
    const crews = new Map<Entity, number>();
    for (const builder of this.world.query(SiteAssignment)) {
      const site = this.world.get(builder, SiteAssignment).site;
      if (this.world.has(site, Damaged)) crews.set(site, (crews.get(site) ?? 0) + 1);
    }
    this.crews = crews;
    return crews;
  }
}

/** Start one repair swing at `site`, walking to a free perimeter cell first. A wall takes the hammer
 *  clip its segments are raised with. */
export function startRepair(plan: PlannerContext, spacing: PlannerSpacing, site: Entity): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const stand = claimWorkCell(world, terrain, e, here, site, spacing);
  if (stand === null) return false;
  const atomic = world.has(site, Palisade) ? BUILD_WALL_ATOMIC_ID : BUILD_HOUSE_ATOMIC_ID;
  atOrWalk(world, e, here, stand, () =>
    startAtomic(world, e, atomic, { kind: 'repair', site }, atomicDuration(ctx.content, plan, atomic), site),
  );
  return true;
}
