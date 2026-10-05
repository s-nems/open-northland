import {
  CurrentAtomic,
  FarmTask,
  MoveGoal,
  PickupClaim,
  Sheltering,
  SiteAssignment,
  Stranded,
  SupplyRun,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { residentsOf } from '../../family/households.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import { redirectRoute } from '../../movement/nav-state.js';
import { anotherSystemOwns } from '../action-owner.js';

/** A raw home-door goal has no atomic yet; competing task owners must keep their own destination. */
export function retargetHomeErrands(
  world: World,
  ctx: SystemContext,
  home: Entity,
  previousDoor: NodeId | null,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || previousDoor === null) return;
  const door = interactionNodeId(world, ctx, terrain, home);
  if (door === null || door === previousDoor) return;
  for (const e of residentsOf(world, home)) {
    if (
      world.tryGet(e, MoveGoal)?.cell !== previousDoor ||
      anotherSystemOwns(world, e) ||
      world.has(e, CurrentAtomic) ||
      world.has(e, SupplyRun) ||
      world.has(e, PickupClaim) ||
      world.tryGet(e, SiteAssignment)?.site === home ||
      world.has(e, FarmTask) ||
      world.has(e, Sheltering)
    ) {
      continue;
    }
    redirectRoute(world, e, door);
    world.remove(e, Stranded);
  }
}
