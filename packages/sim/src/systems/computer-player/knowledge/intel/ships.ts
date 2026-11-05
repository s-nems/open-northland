import { diplomacyStance, MAX_PLAYERS, Vehicle } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { SystemContext } from '../../../context.js';
import { isShipVehicle } from '../../../readviews/vehicles.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { playerSeesNode } from '../../../vision/gates.js';

/** An enemy ship a seat sees lying moored, and where. */
export interface SeenMooredShip {
  readonly owner: number;
  readonly at: HalfCellNode;
}

/** The ships of the seats `seat` holds an `enemy` stance toward that lie moored where it sees, ascending
 *  owner, then vehicle id. Costs the enemies' vehicles. */
export function visibleEnemyMooredShips(world: World, ctx: SystemContext, seat: number): SeenMooredShip[] {
  const vehicles = contentIndex(ctx.content).vehicles;
  const seen: SeenMooredShip[] = [];
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === seat || diplomacyStance(world, seat, owner) !== 'enemy') continue;
    for (const e of vehicleIndex(world).ownedBy(owner)) {
      const state = world.get(e, Vehicle);
      const at = state.mooring;
      if (!state.moored || at === null || !playerSeesNode(ctx.fog, seat, at.hx, at.hy)) continue;
      const type = vehicles.get(state.vehicleType);
      if (type !== undefined && isShipVehicle(type)) seen.push({ owner, at: { hx: at.hx, hy: at.hy } });
    }
  }
  return seen;
}
