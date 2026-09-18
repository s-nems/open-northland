import type { ContentSet } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import {
  type Entity,
  entityById,
  type PlayerCommand,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  commandedVehicleOf,
  isVehicle,
  num,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
} from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import { clampTile, nodeBounds, pickTopAt, type Tile, worldToTile } from '../picking.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

export interface VehicleOrderDeps {
  readonly selected: () => ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField | undefined;
  /** Whose vehicles the orders command: the viewer seat's, or any when the viewer watches the whole map. */
  readonly viewer: ViewerSeat;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  /** The sim's attach rule; absent, every own vehicle under the cursor takes the attach click. */
  readonly canAttachToVehicle?: ((settler: number, vehicle: number) => boolean) | undefined;
  /** The sim's mooring rule (`Simulation.mooringProbe`); absent, every spot takes the dock click and a
   *  ship's right-click is always a goto. */
  readonly canMoorAt?: ((vehicle: number, x: number, y: number) => boolean) | undefined;
}

/**
 * The orders a selected vehicle takes from the world view: the right-click defaults and the resolutions
 * of the vehicle window's armed picks. Every order reports whether it commanded the vehicle, for the
 * caller's click feedback.
 */
export interface VehicleOrderController {
  /** The one owned vehicle the selection holds, itself or through its commander aboard it, when it
   *  holds nothing else that takes orders. */
  selectedVehicle(): number | null;
  /**
   * The original's default right-click for a vehicle: an enemy human, vehicle or house is attacked, an
   * own moored ship is boarded by a land vehicle, anything else is driven to. Named approximations: the
   * attack defaults apply to an armed vehicle only, since the sim drops an unarmed one's attack order
   * silently, the original's per-vehicle gate not being read; a ship's right-click on a shore its
   * mooring rule accepts docks there, where the original's goto is refused.
   */
  issueRightClick(event: MouseEvent): boolean;
  issueMoveTo(vehicle: number, target: Tile): boolean;
  /** Moor `vehicle` at `target`; a spot the mooring rule rejects orders nothing. */
  issueDock(vehicle: number, target: Tile): boolean;
  issueAttackPosition(vehicle: number, target: Tile): boolean;
  /** Aim `vehicle` at the enemy of `kind` under the cursor; a click that hits none orders nothing. */
  issueAttackTarget(event: MouseEvent, vehicle: number, kind: UnitTargetKind): boolean;
  /** Load `vehicle` into the own ship under the cursor. */
  issueLoadInto(event: MouseEvent, vehicle: number): boolean;
  /** Attach `settler` to the own vehicle under the cursor (the ring's "Assign Vehicle"); a vehicle the
   *  attach rule refuses orders nothing, the way a red building cancels a building pick. */
  issueAttach(event: MouseEvent, settler: number): boolean;
}

export function createVehicleOrderController(deps: VehicleOrderDeps): VehicleOrderController {
  const ours = (e: SnapshotEntity): boolean => {
    const owner = ownerPlayerOf(e);
    const seat = pickableSeat(deps.viewer);
    return owner !== undefined && (seat === null || owner === seat);
  };

  const vehicleTypeOf = (e: SnapshotEntity): ContentSet['vehicles'][number] | undefined => {
    const typeId = num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
    return typeId === undefined ? undefined : deps.content.vehicles.find((v) => v.typeId === typeId);
  };

  const selectedVehicle = (): number | null => {
    const snapshot = deps.snapshot();
    let found: number | null = null;
    for (const id of deps.selected()) {
      const e = entityById(snapshot, id);
      if (e === undefined) continue;
      let vehicle = id;
      if (!isVehicle(e)) {
        if (e.components.Settler === undefined) continue; // a building or signpost takes no orders
        // A settler standing on the map takes the click itself (the sim hands a commander's walk order
        // to its vehicle); one aboard the vehicle it commands stands for that vehicle, so the click
        // drives it either way. Any other settler aboard is nobody's to order from here.
        const commanded = positionOf(e) === undefined ? commandedVehicleOf(snapshot, e) : undefined;
        if (commanded === undefined) return null;
        vehicle = commanded;
      }
      const self = entityById(snapshot, vehicle);
      if (self === undefined || !ours(self) || (found !== null && found !== vehicle)) return null;
      found = vehicle;
    }
    return found;
  };

  const clampNode = (target: Tile): Tile => {
    const { width, height } = nodeBounds(deps.mapSize);
    return clampTile(target, width, height);
  };

  const issueMoveTo = (vehicle: number, target: Tile): boolean => {
    const node = clampNode(target);
    deps.enqueue({ kind: 'moveVehicle', vehicle: vehicle as Entity, x: node.col, y: node.row });
    return true;
  };

  const canMoorAt = (vehicle: number, node: Tile): boolean =>
    deps.canMoorAt === undefined || deps.canMoorAt(vehicle, node.col, node.row);

  const issueDock = (vehicle: number, target: Tile): boolean => {
    const node = clampNode(target);
    if (!canMoorAt(vehicle, node)) return false;
    deps.enqueue({ kind: 'dockVehicle', vehicle: vehicle as Entity, x: node.col, y: node.row });
    return true;
  };

  const issueAttackPosition = (vehicle: number, target: Tile): boolean => {
    const node = clampNode(target);
    deps.enqueue({
      kind: 'attackWithVehicle',
      vehicle: vehicle as Entity,
      target: { kind: 'ground', hx: node.col, hy: node.row },
    });
    return true;
  };

  const strike = (vehicle: number, enemy: number): boolean => {
    deps.enqueue({
      kind: 'attackWithVehicle',
      vehicle: vehicle as Entity,
      target: { kind: 'entity', entity: enemy as Entity },
    });
    return true;
  };

  const issueAttackTarget = (event: MouseEvent, vehicle: number, kind: UnitTargetKind): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemy = pickTopAt(
      deps.targets.enemies().filter((p) => p.kind === kind),
      world.x,
      world.y,
    );
    return enemy !== null && strike(vehicle, enemy);
  };

  /** Whether `carrier` is one of our moored ships, the only thing a land vehicle may be loaded into. */
  const isMooredShip = (carrier: number): boolean => {
    const e = entityById(deps.snapshot(), carrier);
    if (e === undefined || !isVehicle(e) || !ours(e)) return false;
    const type = vehicleTypeOf(e);
    if (type === undefined || !systems.isShipVehicle(type)) return false;
    return (e.components.Vehicle as { moored?: unknown } | undefined)?.moored === true;
  };

  const loadInto = (vehicle: number, carrier: number): boolean => {
    if (vehicle === carrier || !isMooredShip(carrier)) return false;
    deps.enqueue({ kind: 'loadIntoVehicle', vehicle: vehicle as Entity, carrier: carrier as Entity });
    return true;
  };

  const issueLoadInto = (event: MouseEvent, vehicle: number): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const carrier = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
    return carrier !== null && loadInto(vehicle, carrier);
  };

  const issueAttach = (event: MouseEvent, settler: number): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const vehicle = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
    if (vehicle === null) return false;
    if (deps.canAttachToVehicle !== undefined && !deps.canAttachToVehicle(settler, vehicle)) return false;
    deps.enqueue({ kind: 'attachToVehicle', entity: settler as Entity, vehicle: vehicle as Entity });
    return true;
  };

  const issueRightClick = (event: MouseEvent): boolean => {
    const vehicle = selectedVehicle();
    if (vehicle === null) return false;
    const self = entityById(deps.snapshot(), vehicle);
    const type = self === undefined ? undefined : vehicleTypeOf(self);
    const armed = type !== undefined && systems.isSiegeVehicle(type);
    const land = type !== undefined && !systems.isShipVehicle(type);
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemies = deps.targets.enemies();
    if (armed) {
      const human = pickTopAt(
        enemies.filter((p) => p.kind === 'settler'),
        world.x,
        world.y,
      );
      if (human !== null) return strike(vehicle, human);
    }
    if (land) {
      const carrier = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
      if (carrier !== null && loadInto(vehicle, carrier)) return true;
    }
    if (armed) {
      const enemy = pickTopAt(enemies, world.x, world.y);
      if (enemy !== null) return strike(vehicle, enemy);
    }
    const target = worldToTile(world.x, world.y, deps.elevation);
    if (!land && deps.canMoorAt !== undefined && canMoorAt(vehicle, clampNode(target))) {
      return issueDock(vehicle, target);
    }
    return issueMoveTo(vehicle, target);
  };

  return {
    selectedVehicle,
    issueRightClick,
    issueMoveTo,
    issueDock,
    issueAttackPosition,
    issueAttackTarget,
    issueLoadInto,
    issueAttach,
  };
}
