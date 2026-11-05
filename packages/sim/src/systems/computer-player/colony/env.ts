import { type ColonyState, ComputerColony, type ComputerColonyState } from '../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { seatBaseLand } from '../base.js';

export type ColonyView = DeepReadonly<ColonyState>;

/** One seat's world for a colony decision. */
export interface SeatEnv {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly seat: number;
  readonly carrier: Entity;
}

/** One colony's decision. `edit` and `editSeat` acquire the state for a change, and only then: each write
 *  drops the seat's home view. */
export interface ColonyEnv extends SeatEnv {
  /** The colony itself, read-only and live: an edit shows through it. */
  readonly colony: ColonyView;
  readonly edit: () => ColonyState;
  readonly editSeat: () => ComputerColonyState;
}

/** The decision of the seat's `colony`, one of its live records. */
export function colonyEnv(seat: SeatEnv, colony: ColonyView): ColonyEnv {
  const editSeat = (): ComputerColonyState => seat.world.mut(seat.carrier, ComputerColony);
  const edit = (): ColonyState => {
    const live = editSeat().colonies.find((held) => held === colony);
    if (live === undefined) throw new Error(`seat ${seat.seat} no longer holds the colony it is editing`);
    return live;
  };
  return { ...seat, colony, edit, editSeat };
}

/** The land the seat's base stands on, or {@link NO_COMPONENT}. */
export function homeLandOf(env: SeatEnv): number {
  return seatBaseLand(env.world, env.ctx, env.terrain, env.seat);
}
