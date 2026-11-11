import type { ContentSet } from '@open-northland/data';
import type { WorldSnapshot } from '@open-northland/sim';
import type { UnitOrderController, UnitOrderDeps } from '../../src/view/unit-controls/orders/controller.js';
import type {
  VehicleOrderController,
  VehicleOrderDeps,
} from '../../src/view/unit-controls/orders/vehicle.js';
import {
  type RightClickHit,
  rightClickHitAt,
  rightClickMods,
} from '../../src/view/unit-controls/right-click/context.js';
import { resolveRiderTrade } from '../../src/view/unit-controls/right-click/riders.js';
import {
  type LadderContext,
  resolveSettlerRightClick,
} from '../../src/view/unit-controls/right-click/settler-ladder.js';
import {
  resolveAttachSelected,
  resolveVehicleRightClick,
} from '../../src/view/unit-controls/right-click/vehicles.js';
import type { PointHitTargets, UnitTargets } from '../../src/view/unit-controls/unit-targets.js';

/** What a press is resolved against: the controller deps a test built, its targets with point hits. */
interface PressDeps {
  readonly targets: UnitTargets & PointHitTargets;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly selected: () => ReadonlySet<number>;
}

type SettlerPressDeps = PressDeps &
  Pick<UnitOrderDeps, 'askAttachTradeHouse' | 'requestEquipPicks' | 'requestFormationSlots'>;
type VehiclePressDeps = PressDeps & Pick<VehicleOrderDeps, 'viewer' | 'askMooring' | 'askAttachToVehicle'>;

function hitOf(deps: PressDeps, event: MouseEvent): RightClickHit {
  return rightClickHitAt(deps.targets, deps.toWorld(event.clientX, event.clientY), undefined);
}

function ladderContext(deps: SettlerPressDeps): LadderContext {
  return {
    snapshot: deps.snapshot(),
    content: deps.content,
    asks: {
      tradeHouse: deps.askAttachTradeHouse !== undefined,
      equip: deps.requestEquipPicks !== undefined,
      formation: deps.requestFormationSlots !== undefined,
    },
  };
}

function vehicleContext(deps: VehiclePressDeps) {
  return {
    snapshot: deps.snapshot(),
    content: deps.content,
    viewer: deps.viewer,
    asks: { mooring: deps.askMooring !== undefined, attach: deps.askAttachToVehicle !== undefined },
  };
}

/** The settlers' part of a right press, resolved as the world view resolves it and issued. */
export function rightClickSettlers(
  orders: UnitOrderController,
  deps: SettlerPressDeps,
  event: MouseEvent,
  onBuilding: number | null = null,
): boolean {
  const plan = resolveSettlerRightClick(
    ladderContext(deps),
    deps.targets.ownedSettlersIn(deps.selected()),
    hitOf(deps, event),
    rightClickMods(event),
    onBuilding,
  );
  return orders.issueSettlerPlan(plan, event);
}

/** The riders' trade-route toggle of a right press, resolved and issued. */
export function rightClickRiders(
  orders: UnitOrderController,
  deps: SettlerPressDeps,
  event: MouseEvent,
  onNoneTook: () => void,
  onBuilding: number | null = null,
): boolean {
  const plan = resolveRiderTrade(
    ladderContext(deps),
    deps.selected(),
    hitOf(deps, event),
    event.shiftKey,
    onBuilding,
  );
  return orders.issueRiderPlan(plan, onNoneTook);
}

/** The vehicles' part of a right press, resolved and issued. */
export function rightClickVehicles(
  vehicles: VehicleOrderController,
  deps: VehiclePressDeps,
  event: MouseEvent,
): boolean {
  const mods = rightClickMods(event);
  const plan = resolveVehicleRightClick(vehicleContext(deps), deps.selected(), hitOf(deps, event), mods);
  return vehicles.issueVehiclePlan(plan, event.shiftKey);
}

/** The selected settlers' boarding of a right press, resolved and issued; false when it resolves none. */
export function rightClickAttach(
  vehicles: VehicleOrderController,
  deps: VehiclePressDeps,
  event: MouseEvent,
  onNoneBoards: () => void,
): boolean {
  const plan = resolveAttachSelected(
    vehicleContext(deps),
    deps.targets.ownedSettlersIn(deps.selected()),
    hitOf(deps, event),
  );
  return plan !== null && vehicles.issueAttachPlan(plan, event.shiftKey, onNoneBoards);
}

/** The work-flag chord's press: the flags move to the point, narrowed to the resource drawn there. */
export function rightClickWorkFlag(orders: UnitOrderController, deps: PressDeps, event: MouseEvent): boolean {
  const hit = hitOf(deps, event);
  return orders.issueWorkFlagAt(hit.tile, hit.resource?.goodType ?? null);
}
