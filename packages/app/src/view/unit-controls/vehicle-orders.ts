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
import { formationTiles } from './formation.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

/** How far apart a group's goals lie: past a catapult's footprint disc (`logicsize 1`) and a lane
 *  beside it, so no two marched vehicles contend for one goal. */
const VEHICLE_FORMATION_SPACING_NODES = 4;

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
  /** The owned siege vehicles selected themselves, the ones an attack-move marches. */
  selectedSiegeVehicles(): number[];
  /**
   * The original's default right-click for a vehicle: an enemy human, vehicle or house is attacked, an
   * own moored ship is boarded by a land vehicle, anything else is driven to. Named approximations: the
   * attack defaults apply to an armed vehicle only, since the sim drops an unarmed one's attack order
   * silently, the original's per-vehicle gate not being read; a ship's right-click on a shore its
   * mooring rule accepts docks there, where the original's goto is refused.
   *
   * A marquee's group of vehicles, or vehicles selected beside settlers, is an addition: the armed ones
   * attack the enemy under the cursor and the rest drive to their own slots of a spaced formation
   * there. A group neither boards nor docks.
   */
  issueRightClick(event: MouseEvent): boolean;
  issueMoveTo(vehicle: number, target: Tile): boolean;
  /** March `vehicles` to `target`, each to its own slot of a spaced formation around it, fighting
   *  whatever they meet on the way. */
  issueAttackMove(vehicles: readonly number[], target: Tile): boolean;
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
  /** The selected settlers' right-click on an own vehicle: each one the attach rule admits is assigned
   *  to it (approximation, owner's choice: the original assigns through the ring's pick only). False when
   *  no vehicle lies under the cursor, an own settler or an enemy drawn there takes the click first (a
   *  crew waiting by the door stands over the hull), or nobody selected may board it. */
  issueAttachSelected(event: MouseEvent): boolean;
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

  /** The owned vehicles selected themselves, in id order. */
  const selectedVehicles = (): SnapshotEntity[] => {
    const snapshot = deps.snapshot();
    const vehicles: SnapshotEntity[] = [];
    for (const id of deps.selected()) {
      const e = entityById(snapshot, id);
      if (e !== undefined && isVehicle(e) && ours(e)) vehicles.push(e);
    }
    return vehicles.sort((a, b) => a.id - b.id);
  };

  const isSiege = (e: SnapshotEntity): boolean => {
    const type = vehicleTypeOf(e);
    return type !== undefined && systems.isSiegeVehicle(type);
  };

  const selectedSiegeVehicles = (): number[] =>
    selectedVehicles()
      .filter(isSiege)
      .map((e) => e.id);

  const clampNode = (target: Tile): Tile => {
    const { width, height } = nodeBounds(deps.mapSize);
    return clampTile(target, width, height);
  };

  const issueMoveTo = (vehicle: number, target: Tile): boolean => {
    const node = clampNode(target);
    deps.enqueue({ kind: 'moveVehicle', vehicle: vehicle as Entity, x: node.col, y: node.row });
    return true;
  };

  /** One goal per vehicle around `target`, formation slots on a lattice as wide as the group, each
   *  scaled out to the spacing. */
  const formationGoals = (count: number, target: Tile): Tile[] => {
    const slots = formationTiles(
      { col: count, row: count },
      count,
      2 * count + 1,
      2 * count + 1,
      () => false,
    );
    return Array.from({ length: count }, (_, i) => {
      const slot = slots[i] ?? { col: count, row: count };
      return clampNode({
        col: target.col + (slot.col - count) * VEHICLE_FORMATION_SPACING_NODES,
        row: target.row + (slot.row - count) * VEHICLE_FORMATION_SPACING_NODES,
      });
    });
  };

  const driveInFormation = (vehicles: readonly number[], target: Tile, attackMove: boolean): void => {
    const goals = formationGoals(vehicles.length, target);
    vehicles.forEach((vehicle, i) => {
      const node = goals[i] ?? clampNode(target);
      deps.enqueue({
        kind: 'moveVehicle',
        vehicle: vehicle as Entity,
        x: node.col,
        y: node.row,
        ...(attackMove ? { attackMove: true } : {}),
      });
    });
  };

  const issueAttackMove = (vehicles: readonly number[], target: Tile): boolean => {
    driveInFormation(vehicles, target, true);
    return vehicles.length > 0;
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

  const issueAttachSelected = (event: MouseEvent): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const vehicle = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
    if (vehicle === null) return false;
    if (pickTopAt(deps.targets.owned('settler'), world.x, world.y) !== null) return false;
    if (pickTopAt(deps.targets.enemies(), world.x, world.y) !== null) return false;
    let sent = false;
    for (const target of deps.targets.ownedSettlersIn(deps.selected())) {
      const settler = target.ref;
      if (deps.canAttachToVehicle !== undefined && !deps.canAttachToVehicle(settler, vehicle)) continue;
      deps.enqueue({ kind: 'attachToVehicle', entity: settler as Entity, vehicle: vehicle as Entity });
      sent = true;
    }
    return sent;
  };

  /** A group's right-click (see {@link VehicleOrderController.issueRightClick}). An own settler under
   *  the cursor is left to the settlers' click, which selects it. */
  const issueGroupRightClick = (event: MouseEvent): boolean => {
    const group = selectedVehicles();
    if (group.length === 0) return false;
    const world = deps.toWorld(event.clientX, event.clientY);
    if (pickTopAt(deps.targets.owned('settler'), world.x, world.y) !== null) return false;
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    const striking = enemy === null ? [] : group.filter(isSiege);
    if (enemy !== null) for (const e of striking) strike(e.id, enemy);
    const driving = group.filter((e) => !striking.includes(e)).map((e) => e.id);
    driveInFormation(driving, worldToTile(world.x, world.y, deps.elevation), false);
    return true;
  };

  const issueRightClick = (event: MouseEvent): boolean => {
    const vehicle = selectedVehicle();
    if (vehicle === null) return issueGroupRightClick(event);
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
    selectedSiegeVehicles,
    issueRightClick,
    issueMoveTo,
    issueAttackMove,
    issueDock,
    issueAttackPosition,
    issueAttackTarget,
    issueLoadInto,
    issueAttach,
    issueAttachSelected,
  };
}
