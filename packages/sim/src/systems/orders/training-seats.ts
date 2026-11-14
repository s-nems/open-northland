import { Building, CoinDrillOrder, TrainingOrder } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/**
 * One man's place on a house's seat list: his `TrainingOrder`, or his `CoinDrillOrder` while it walks to or
 * drills at its barracks. Recruits, pupils and coin-drillers share the house's seats and one queue. Our rule.
 */
interface SeatClaim {
  readonly house: Entity;
  readonly enrolled: number;
  readonly seated: boolean;
}

/** The settlers `house` trains at once, its `logicSchoolSize`; undefined seats everyone sent there. */
export function trainingSeats(world: World, ctx: SystemContext, house: Entity): number | undefined {
  const building = world.tryGet(house, Building);
  if (building === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(building.buildingType)?.schoolSize;
}

/** `e`'s claim on a seat, if he holds one; a man holds at most one order of the two, the training first. */
function seatClaimOf(world: World, e: Entity): SeatClaim | undefined {
  const training = world.tryGet(e, TrainingOrder);
  if (training !== undefined) return training;
  const drill = world.tryGet(e, CoinDrillOrder);
  return drill?.stage === 'drill' ? drill : undefined;
}

/** Whether `a` joined its house's list before `b`: the earlier tick, then the lower id. */
export function enrolledBefore(
  a: { readonly id: number; readonly enrolled: number },
  b: { readonly id: number; readonly enrolled: number },
): boolean {
  return a.enrolled < b.enrolled || (a.enrolled === b.enrolled && a.id < b.id);
}

/** The claims on `house`'s seats but `self`'s: with `self`, only those seated or enrolled before him. The
 *  work scales with the men holding either order. */
function claimsAhead(
  world: World,
  house: Entity,
  self: { readonly id: Entity; readonly enrolled: number } | null,
): number {
  let count = 0;
  const tally = (other: Entity, claim: SeatClaim): void => {
    if (claim.house !== house || other === self?.id) return;
    if (self === null || claim.seated || enrolledBefore({ id: other, enrolled: claim.enrolled }, self))
      count++;
  };
  for (const e of world.query(TrainingOrder)) tally(e, world.get(e, TrainingOrder));
  for (const e of world.query(CoinDrillOrder)) {
    const claim = seatClaimOf(world, e);
    if (claim !== undefined && !world.has(e, TrainingOrder)) tally(e, claim);
  }
  return count;
}

/**
 * Seat `e` at the house of his training or coin drill when a seat is free and nobody enrolled before him
 * still waits; true when he holds one. A seated claim never loses its seat, so the scan runs only for the
 * ones still waiting.
 */
export function takeSeat(world: World, ctx: SystemContext, e: Entity): boolean {
  const claim = seatClaimOf(world, e);
  if (claim === undefined) return false;
  if (claim.seated) return true;
  const capacity = trainingSeats(world, ctx, claim.house);
  if (
    capacity !== undefined &&
    claimsAhead(world, claim.house, { id: e, enrolled: claim.enrolled }) >= capacity
  )
    return false;
  if (world.has(e, TrainingOrder)) world.mut(e, TrainingOrder).seated = true;
  else world.mut(e, CoinDrillOrder).seated = true;
  return true;
}

/** The seats of `house` no claim holds, seated or waiting; infinite for a house without a size. */
export function unclaimedSeats(world: World, ctx: SystemContext, house: Entity): number {
  const capacity = trainingSeats(world, ctx, house);
  if (capacity === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, capacity - claimsAhead(world, house, null));
}

/** Whether `house` still has a seat no claim holds; a house without a size has. */
export function hasUnclaimedSeat(world: World, ctx: SystemContext, house: Entity): boolean {
  return unclaimedSeats(world, ctx, house) > 0;
}
