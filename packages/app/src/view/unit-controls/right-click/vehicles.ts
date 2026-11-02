import type { ContentSet } from '@open-northland/data';
import { entityById, MAX_UNIT_ORDER_MEMBERS, systems } from '@open-northland/sim';
import {
  commandedVehicleOf,
  isVehicle,
  num,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
} from '../../../game/snapshot/index.js';
import { pickableSeat } from '../../../game/viewer-seat.js';
import type { Tile } from '../../picking.js';
import type { FormationUnit } from '../orders/formation.js';
import {
  contentLookups,
  type PendingAnswer,
  type RightClickAsks,
  type RightClickContext,
  type RightClickHit,
  type RightClickMods,
} from './context.js';

type VehicleContext = Pick<RightClickContext, 'snapshot' | 'content' | 'viewer'>;

export function ownsVehicle(ctx: Pick<RightClickContext, 'viewer'>, e: SnapshotEntity): boolean {
  const owner = ownerPlayerOf(e);
  const seat = pickableSeat(ctx.viewer);
  return owner !== undefined && (seat === null || owner === seat);
}

export function vehicleTypeOf(
  content: ContentSet,
  e: SnapshotEntity,
): ContentSet['vehicles'][number] | undefined {
  const typeId = num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
  return typeId === undefined ? undefined : contentLookups(content).vehicles.get(typeId);
}

export function isShip(content: ContentSet, e: SnapshotEntity): boolean {
  const type = vehicleTypeOf(content, e);
  return type !== undefined && systems.isShipVehicle(type);
}

export function isSiege(content: ContentSet, e: SnapshotEntity): boolean {
  const type = vehicleTypeOf(content, e);
  return type !== undefined && systems.isSiegeVehicle(type);
}

/** The one owned vehicle the selection holds, itself or through its commander aboard it, when it holds
 *  nothing else that takes orders. */
export function selectedVehicle(ctx: VehicleContext, selected: ReadonlySet<number>): number | null {
  const { snapshot } = ctx;
  let found: number | null = null;
  for (const id of selected) {
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
    if (self === undefined || !ownsVehicle(ctx, self) || (found !== null && found !== vehicle)) return null;
    found = vehicle;
  }
  return found;
}

/** The owned vehicles selected themselves, in id order. */
export function selectedVehicles(ctx: VehicleContext, selected: ReadonlySet<number>): SnapshotEntity[] {
  const vehicles: SnapshotEntity[] = [];
  for (const id of selected) {
    const e = entityById(ctx.snapshot, id);
    if (e !== undefined && isVehicle(e) && ownsVehicle(ctx, e)) vehicles.push(e);
  }
  return vehicles.sort((a, b) => a.id - b.id);
}

/** The selection's ships a right-click docks: the one selected ship, or a group's ships. */
export function rightClickShips(ctx: VehicleContext, selected: ReadonlySet<number>): number[] {
  const vehicle = selectedVehicle(ctx, selected);
  if (vehicle !== null) {
    const self = entityById(ctx.snapshot, vehicle);
    return self !== undefined && isShip(ctx.content, self) ? [vehicle] : [];
  }
  const group = selectedVehicles(ctx, selected);
  return group.length > MAX_UNIT_ORDER_MEMBERS
    ? []
    : group.filter((e) => isShip(ctx.content, e)).map((e) => e.id);
}

/** Whether `carrier` is one of our moored ships a trader's route does not hold, the only thing a land
 *  vehicle may be loaded into. */
export function isMooredShip(ctx: VehicleContext, carrier: number): boolean {
  const e = entityById(ctx.snapshot, carrier);
  if (e === undefined || !isVehicle(e) || !ownsVehicle(ctx, e) || !isShip(ctx.content, e)) return false;
  const ship = e.components.Vehicle as { moored?: unknown; hauler?: unknown } | undefined;
  return ship?.moored === true && num(ship.hauler) === undefined;
}

export type VehicleIntent =
  | { readonly kind: 'strike'; readonly enemy: number }
  | { readonly kind: 'loadInto'; readonly carrier: number }
  /** The one selected vehicle drives there; a ship docks where its mooring rule accepts the shore within
   *  a right click's reach, and sails there otherwise. */
  | { readonly kind: 'drive'; readonly tile: Tile; readonly lands: boolean }
  /** A group drives to its own slots of a spaced formation there. */
  | { readonly kind: 'driveFormation'; readonly tile: Tile }
  /** A group's ships dock along the shore there, each at its own berth; one with no berth sails with
   *  the formation. */
  | { readonly kind: 'dock'; readonly tile: Tile; readonly lands: boolean };

export interface VehicleGroup {
  readonly vehicles: readonly number[];
  readonly intent: VehicleIntent;
  readonly pending?: PendingAnswer;
}

export type VehiclePlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'orderLimit' }
  | { readonly kind: 'orders'; readonly groups: readonly VehicleGroup[] };

/**
 * The original's default right-click for a vehicle: an enemy human, vehicle or house is attacked, an
 * own moored ship is boarded by a land vehicle, anything else is driven to. Named approximations: the
 * attack defaults apply to an armed vehicle only, since the sim drops an unarmed one's attack order
 * silently, the original's per-vehicle gate not being read; a ship's right-click on a shore its
 * mooring rule accepts docks there, where the original's goto is refused.
 *
 * A marquee's group of vehicles, or vehicles selected beside settlers, is an addition: the armed ones
 * attack the enemy under the cursor, its ships dock along the shore there, and the rest drive in
 * formation. A group never boards, and leaves an own settler under the cursor to the settlers' click.
 */
export function resolveVehicleRightClick(
  ctx: VehicleContext & { readonly asks: Pick<RightClickAsks, 'mooring'> },
  selected: ReadonlySet<number>,
  hit: RightClickHit,
  mods: RightClickMods,
): VehiclePlan {
  const vehicle = selectedVehicle(ctx, selected);
  if (vehicle === null) return groupPlan(ctx, selected, hit, mods);
  const self = entityById(ctx.snapshot, vehicle);
  const type = self === undefined ? undefined : vehicleTypeOf(ctx.content, self);
  const armed = type !== undefined && systems.isSiegeVehicle(type);
  const land = type !== undefined && !systems.isShipVehicle(type);
  const one = (intent: VehicleIntent, pending?: PendingAnswer): VehiclePlan => ({
    kind: 'orders',
    groups: [{ vehicles: [vehicle], intent, ...(pending === undefined ? {} : { pending }) }],
  });
  if (armed && hit.enemySettler !== null) return one({ kind: 'strike', enemy: hit.enemySettler });
  const carrier = hit.ownVehicle;
  if (land && carrier !== null && carrier !== vehicle && isMooredShip(ctx, carrier))
    return one({ kind: 'loadInto', carrier });
  if (armed && hit.enemy !== null) return one({ kind: 'strike', enemy: hit.enemy });
  const drive: VehicleIntent = { kind: 'drive', tile: hit.tile, lands: mods.landsCrew };
  return one(drive, !land && ctx.asks.mooring ? 'mooring' : undefined);
}

function groupPlan(
  ctx: VehicleContext & { readonly asks: Pick<RightClickAsks, 'mooring'> },
  selected: ReadonlySet<number>,
  hit: RightClickHit,
  mods: RightClickMods,
): VehiclePlan {
  const group = selectedVehicles(ctx, selected);
  if (group.length === 0) return { kind: 'none' };
  if (group.length > MAX_UNIT_ORDER_MEMBERS) return { kind: 'orderLimit' };
  if (hit.ownSettler !== null) return { kind: 'none' };
  const groups: VehicleGroup[] = [];
  const enemy = hit.enemy;
  const striking = enemy === null ? [] : group.filter((e) => isSiege(ctx.content, e));
  if (enemy !== null && striking.length > 0)
    groups.push({ vehicles: striking.map((e) => e.id), intent: { kind: 'strike', enemy } });
  const driving = group.filter((e) => !striking.includes(e));
  const ships = driving.filter((e) => isShip(ctx.content, e)).map((e) => e.id);
  const drive = (vehicles: readonly SnapshotEntity[]): void => {
    if (vehicles.length > 0)
      groups.push({
        vehicles: vehicles.map((e) => e.id),
        intent: { kind: 'driveFormation', tile: hit.tile },
      });
  };
  if (ships.length === 0 || !ctx.asks.mooring) {
    drive(driving);
    return { kind: 'orders', groups };
  }
  // The ships wait on their mooring rules; the rest of the group drives off at once.
  drive(driving.filter((e) => !isShip(ctx.content, e)));
  groups.push({
    vehicles: ships,
    intent: { kind: 'dock', tile: hit.tile, lands: mods.landsCrew },
    pending: 'mooring',
  });
  return { kind: 'orders', groups };
}

/** The selected settlers' right-click on an own vehicle: each one the attach rule admits boards it. */
export interface AttachPlan {
  readonly vehicle: number;
  readonly settlers: readonly number[];
  readonly pending?: PendingAnswer;
}

/** Whether a trader's route holds the ship, which then seats nobody by an order. */
function pinnedShip(ctx: Pick<VehicleContext, 'snapshot' | 'content'>, vehicle: number): boolean {
  const e = entityById(ctx.snapshot, vehicle);
  const hauler = (e?.components.Vehicle as { hauler?: unknown } | undefined)?.hauler;
  return e !== undefined && isShip(ctx.content, e) && num(hauler) !== undefined;
}

/** Approximation, owner's choice: the original assigns a vehicle through the ring's pick only. Null when
 *  no own vehicle lies under the cursor, an own settler or an enemy drawn there takes the click first (a
 *  crew waiting by the door stands over the hull), the ship seats nobody, or nobody is selected. */
export function resolveAttachSelected(
  ctx: Pick<VehicleContext, 'snapshot' | 'content'> & { readonly asks: Pick<RightClickAsks, 'attach'> },
  settlers: readonly FormationUnit[],
  hit: RightClickHit,
): AttachPlan | null {
  const vehicle = hit.ownVehicle;
  if (vehicle === null || hit.ownSettler !== null || hit.enemy !== null || settlers.length === 0) return null;
  if (pinnedShip(ctx, vehicle)) return null;
  return {
    vehicle,
    settlers: settlers.map((unit) => unit.ref),
    ...(ctx.asks.attach ? { pending: 'attach' as const } : {}),
  };
}
