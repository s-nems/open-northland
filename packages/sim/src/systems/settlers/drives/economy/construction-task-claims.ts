import {
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathRequest,
  SiteAssignment,
  SupplyRun,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { remainingConstructionStrikes } from '../../../economy/construction.js';
import { atomicHoldsSettler } from '../../atomics/busy.js';
import type { PlannerSpacing } from '../../planner/spacing.js';

/**
 * Planner-tick reservations for hammer strikes. Existing work and routes seed the tally; idle builders
 * then claim only strikes that already-delivered material can absorb.
 */
export class ConstructionTaskClaims {
  private readonly hammerBySite = new Map<Entity, number>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    spacing: PlannerSpacing,
  ) {
    for (const e of world.query(CurrentAtomic)) {
      const effect = world.get(e, CurrentAtomic).effect;
      if (
        effect.kind === 'construct' &&
        atomicHoldsSettler(world, e) &&
        world.has(effect.site, UnderConstruction)
      ) {
        this.reserveHammer(effect.site);
      }
    }
    for (const e of world.query(SiteAssignment, MoveGoal)) {
      if (world.has(e, CurrentAtomic) || world.has(e, Carrying) || world.has(e, SupplyRun)) continue;
      if (world.tryGet(e, PathRequest)?.failed === true) continue;
      const site = world.get(e, SiteAssignment).site;
      if (!world.has(site, UnderConstruction)) continue;
      const goal = world.get(e, MoveGoal).cell;
      if (spacing.workCells(site).includes(goal)) this.reserveHammer(site);
    }
  }

  /** Whether at least one already-delivered strike remains unclaimed. */
  hasHammerWork(site: Entity): boolean {
    return (this.hammerBySite.get(site) ?? 0) < remainingConstructionStrikes(this.world, this.ctx, site);
  }

  /** Whether an active, in-flight, or newly planned builder already holds a hammer strike here. */
  hasHammerClaim(site: Entity): boolean {
    return (this.hammerBySite.get(site) ?? 0) > 0;
  }

  /** Claim one usable strike for this planner pass. */
  claimHammer(site: Entity): boolean {
    if (!this.hasHammerWork(site)) return false;
    this.reserveHammer(site);
    return true;
  }

  private reserveHammer(site: Entity): void {
    this.hammerBySite.set(site, (this.hammerBySite.get(site) ?? 0) + 1);
  }
}
