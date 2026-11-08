import { entityById, MAX_UNIT_ORDER_MEMBERS, ONE, systems } from '@open-northland/sim';
import { buildingTypeOf, isSettler, isVehicle, num, ownerPlayerOf } from '../../../game/snapshot/index.js';
import { ownedByAnotherSeat, pickableSeat } from '../../../game/viewer-seat.js';
import type { Tile } from '../../picking.js';
import type { DoorMarkerHit } from '../click-hits.js';
import type { FormationUnit } from '../orders/formation.js';
import {
  contentLookups,
  type RightClickContext,
  type RightClickHit,
  type RightClickMods,
} from './context.js';
import { type RiderPlan, resolveRiderTrade } from './riders.js';
import { resolveSettlerRightClick, type SettlerPlan } from './settler-ladder.js';
import {
  type AttachPlan,
  resolveAttachSelected,
  resolveShipPin,
  resolveVehicleRightClick,
  rightClickShips,
  type ShipPinPlan,
  selectedVehicle,
  type VehiclePlan,
} from './vehicles.js';

/** One right press on the world view, as it landed. */
export interface RightClickInput {
  readonly hit: RightClickHit;
  readonly doorMarker: DoorMarkerHit | null;
  readonly selected: ReadonlySet<number>;
  /** The selection's settlers that take orders (`UnitTargets.ownedSettlersIn`). */
  readonly settlers: readonly FormationUnit[];
  readonly mods: RightClickMods;
  /** The work-flag chord (`workFlagOrder`) is held. */
  readonly workFlag: boolean;
}

export type RightClickPlan =
  /** The selected gatherers' work flags move there; a resource there narrows their gathered good. */
  | {
      readonly kind: 'workFlag';
      readonly units: readonly number[];
      readonly tile: Tile;
      readonly goodType: number | null;
    }
  /** A door marker stands for the person inside, so it takes the right click the figure would. */
  | { readonly kind: 'doorSettler'; readonly settler: number }
  /** The lone selected barracks plants or moves its rally flag on the ground the press names. */
  | { readonly kind: 'rallyPoint'; readonly building: number; readonly tile: Tile }
  /** A whole mixed gesture past the order cap is refused before anyone submits anything. */
  | { readonly kind: 'orderLimit' }
  /** The lone trader pins the ship or lets it go; once the sim refused a pin, the press boards or
   *  orders as it would without one (`resolveBoardOrOrders`). */
  | { readonly kind: 'pinShip'; readonly pin: ShipPinPlan; readonly onBuilding: number | null }
  /** The selected settlers board the vehicle; once its rule refused every one, the press is resolved
   *  again without this step and takes its `orders`. */
  | { readonly kind: 'attach'; readonly attach: AttachPlan; readonly onBuilding: number | null }
  /**
   * Settlers and vehicles selected together both take the click. The riders' trade toggle takes the
   * vehicles' turn; the vehicles take the click when there is no toggle, or once the sim refused every
   * trader it asked about.
   */
  | {
      readonly kind: 'orders';
      readonly onBuilding: number | null;
      readonly settlers: SettlerPlan;
      readonly riders: RiderPlan;
      readonly vehicles: VehiclePlan;
    };

const NO_RIDERS: RiderPlan = { kind: 'none' };
const NO_VEHICLES: VehiclePlan = { kind: 'none' };

/**
 * What a right press does with this selection over this point, without issuing anything: the click
 * executes it, and a hover over the same point can name it. Pure, and screen-bounded through the hit.
 */
export function resolveRightClick(ctx: RightClickContext, input: RightClickInput): RightClickPlan {
  const { hit, selected, settlers } = input;
  // A selection of ships alone takes the work-flag chord as its dock-and-land.
  const shipsOnly =
    rightClickShips(ctx, selected).length > 0 &&
    (selectedVehicle(ctx, selected) !== null || settlers.length === 0);
  if (input.workFlag && !shipsOnly) {
    return {
      kind: 'workFlag',
      units: settlers.map((unit) => unit.ref),
      tile: hit.tile,
      goodType: hit.resource?.goodType ?? null,
    };
  }
  const marker = input.doorMarker;
  if (marker?.kind === 'settler') return { kind: 'doorSettler', settler: marker.ref };
  // The rally pick comes before the unit orders: with a barracks selected they would all be no-ops, so
  // the ground press is free to plant the flag - only a person under the press keeps its select.
  if (hit.ownSettler === null) {
    const rally = selectedRallyBuilding(ctx, selected);
    if (rally !== null) return { kind: 'rallyPoint', building: rally, tile: hit.tile };
  }
  if (hit.ownSettler === null && unitCount(ctx, selected) > MAX_UNIT_ORDER_MEMBERS)
    return { kind: 'orderLimit' };
  const onBuilding = marker?.kind === 'building' ? marker.ref : null;
  const pin = resolveShipPin(ctx, settlers, hit, input.mods.queued);
  if (pin !== null) return { kind: 'pinShip', pin, onBuilding };
  return resolveBoardOrOrders(ctx, input, onBuilding);
}

export type RightClickOrders = Extract<RightClickPlan, { kind: 'orders' }>;
export type BoardOrOrdersPlan = Extract<RightClickPlan, { kind: 'attach' | 'orders' }>;

/** The selection boards the vehicle under the press, else takes its orders: every press past a ship pin,
 *  and a refused pin's fallback. */
export function resolveBoardOrOrders(
  ctx: RightClickContext,
  input: Pick<RightClickInput, 'hit' | 'selected' | 'settlers' | 'mods'>,
  onBuilding: number | null,
): BoardOrOrdersPlan {
  const attach = resolveAttachSelected(ctx, input.settlers, input.hit);
  if (attach !== null) return { kind: 'attach', attach, onBuilding };
  return resolveRightClickOrders(ctx, input, onBuilding);
}

/** The press past the vehicle boarding: what a refused boarding falls back to. */
export function resolveRightClickOrders(
  ctx: RightClickContext,
  input: Pick<RightClickInput, 'hit' | 'selected' | 'settlers' | 'mods'>,
  onBuilding: number | null,
): RightClickOrders {
  const { hit, selected, settlers, mods } = input;
  const settlerPlan = resolveSettlerRightClick(ctx, settlers, hit, mods.queued, onBuilding);
  // Picking an own settler replaces the selection first, which leaves nobody else to take the click.
  if (settlerPlan.kind === 'select')
    return { kind: 'orders', onBuilding, settlers: settlerPlan, riders: NO_RIDERS, vehicles: NO_VEHICLES };
  return {
    kind: 'orders',
    onBuilding,
    settlers: settlerPlan,
    riders: resolveRiderTrade(ctx, selected, hit, mods.queued, onBuilding),
    vehicles: resolveVehicleRightClick(ctx, selected, hit, mods),
  };
}

/** The selected settlers and vehicles, whoever owns them: the members a gesture's cap counts. */
function unitCount(ctx: Pick<RightClickContext, 'snapshot'>, selected: ReadonlySet<number>): number {
  let count = 0;
  for (const id of selected) {
    const entity = entityById(ctx.snapshot, id);
    if (entity !== undefined && (isSettler(entity) || isVehicle(entity))) count++;
  }
  return count;
}

/** The lone finished barracks the selection holds, when it is the viewer's own, whose ground right click
 *  plants its rally flag; null for any other selection. A mixed selection keeps the usual orders, as the
 *  rally order is a building's alone. */
function selectedRallyBuilding(
  ctx: Pick<RightClickContext, 'snapshot' | 'content' | 'viewer'>,
  selected: ReadonlySet<number>,
): number | null {
  if (selected.size !== 1) return null;
  const id = selected.values().next().value;
  const entity = id === undefined ? undefined : entityById(ctx.snapshot, id);
  if (entity === undefined) return null;
  if (ownedByAnotherSeat(ownerPlayerOf(entity), pickableSeat(ctx.viewer))) return null;
  const building = entity.components.Building as { built?: unknown } | undefined;
  if (building === undefined || entity.components.UnderConstruction !== undefined) return null;
  const built = num(building.built);
  if (built === undefined || built < ONE) return null;
  const def = contentLookups(ctx.content).buildings.get(buildingTypeOf(entity) ?? -1);
  return def !== undefined && systems.isBarracksType(def) ? entity.id : null;
}
