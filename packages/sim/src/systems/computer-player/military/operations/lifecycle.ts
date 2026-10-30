import {
  isOperationOpen,
  type Operation,
  type OperationEndReason,
  type OperationState,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import type { MilitaryOrders } from '../../strategy/military.js';

// A seat's military operations: bodies of men sent somewhere for a purpose, each with a lifecycle
// (forming, moving, acting, withdrawing, then done or failed). An operation's men are its own: the home
// defence, the muster and every other operation leave them alone until it ends.

/** What one decision of the seat's operations reads. */
export interface OperationEnv {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly seat: number;
  /** The seat's barracks door: where bands form and come home to. */
  readonly home: NodeId;
  readonly orders: MilitaryOrders;
}

/**
 * One kind of operation. `beforeCampaign` kinds step and open before the wave muster sorts the free men,
 * so the men they take never reach it; `afterCampaign` kinds mirror what the campaign itself decided.
 */
export interface OperationHandler<O extends Operation = Operation> {
  readonly phase: 'beforeCampaign' | 'afterCampaign';
  /** Ticks after one ends before the kind may open again. */
  readonly cooldownTicks: number;
  /** One decision for an open operation: its orders. It updates `op` in place through {@link enter}, and
   *  may take reinforcements from `free`, the men no operation holds, in which case it removes them. */
  readonly step: (env: OperationEnv, op: O, free: Entity[]) => readonly PlayerCommand[];
  /** A new operation of this kind from `free` when its trigger holds, with the orders that start it. */
  readonly open: (env: OperationEnv, free: readonly Entity[], id: number) => Opened<O> | null;
}

export interface Opened<O extends Operation> {
  readonly op: O;
  readonly commands: readonly PlayerCommand[];
}

export const isOpen = isOperationOpen;

/** Moves `op` to `state` from this tick, with `reason` when it turns back or ends. */
export function enter(
  op: Operation,
  state: OperationState,
  tick: number,
  reason: OperationEndReason | null = null,
): void {
  op.state = state;
  op.since = tick;
  if (reason !== null) op.reason = reason;
}
