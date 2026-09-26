import {
  LISTEN_ATOMIC_ID,
  needsEnabled,
  Position,
  Rider,
  Settler,
  TALK_ATOMIC_ID,
  VehicleStock,
  vehicleStockEntries,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { applyNeedUnits, carriesNeeds, NEED_DRIVE_THRESHOLD } from '../lifecycle/needs/index.js';
import { atomicClipName, atomicDuration, atomicEventChannelDelta } from '../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, isFood, jobIgnoresHomeHouse } from '../readviews/index.js';
import { isAboardShip } from '../readviews/vehicles.js';
import { EAT_ATOMIC_ID, SLEEP_ATOMIC_ID } from '../settlers/atomics/start.js';
import { canonicalById } from '../spatial/nodes.js';
import { consumeVehicleGood } from './stock.js';

const { REST, HUNGER, LEISURE } = ATOMIC_EVENT_CHANNEL;

/**
 * SHIPBOARD NEEDS - a settler riding inside a ship answers its needs aboard (owner's choice; whether the
 * original serves a rider aboard is unconfirmed): hungry, it eats a unit of food out of the ship's hold;
 * tired, it sleeps; short of company, it chats with a fellow passenger. Each is worth what the clip the
 * settler would play on land pays in, rest counting half as out of doors, and a rider is served at most
 * once per length of that clip, phased by its id, so a voyage paces its meals as a day ashore would.
 * Piety waits for land.
 */
export const shipboardNeedsSystem: System = (world, ctx) => {
  if (!needsEnabled(world)) return;
  const aboard = new Map<Entity, Entity[]>();
  for (const e of world.query(Rider, Settler)) {
    if (world.has(e, Position) || !isAboardShip(world, ctx.content, e)) continue;
    const vehicle = world.get(e, Rider).vehicle;
    const riders = aboard.get(vehicle);
    if (riders === undefined) aboard.set(vehicle, [e]);
    else riders.push(e);
  }
  for (const vehicle of canonicalById([...aboard.keys()])) {
    const riders = canonicalById(aboard.get(vehicle) ?? []);
    for (const e of riders) {
      if (!carriesNeeds(world, ctx.content, e)) continue;
      eatAboard(world, ctx, e, vehicle) || sleepAboard(world, ctx, e) || chatAboard(world, ctx, e, riders);
    }
  }
};

/** Whether `e` is due a round of `atomicId` this tick: once per the clip's length, phased by its id. */
function due(ctx: SystemContext, e: Entity, duration: number): boolean {
  return (ctx.tick + e) % Math.max(1, duration) === 0;
}

/** The bar one full play of `atomicId` moves on `channel` for this settler, out in the field. */
function clipWorth(ctx: SystemContext, world: World, e: Entity, atomicId: number, channel: number): number {
  const clip = atomicClipName(ctx.content, world.get(e, Settler), atomicId);
  return clip === undefined ? 0 : atomicEventChannelDelta(ctx.content, clip, channel);
}

function eatAboard(world: World, ctx: SystemContext, e: Entity, vehicle: Entity): boolean {
  const settler = world.get(e, Settler);
  if (settler.hunger < NEED_DRIVE_THRESHOLD) return false;
  const food = vehicleStockEntries(world.get(vehicle, VehicleStock)).find(
    ([good, line]) => line.current > 0 && isFood(ctx, good),
  );
  if (food === undefined || !due(ctx, e, atomicDuration(ctx.content, settler, EAT_ATOMIC_ID))) return false;
  const worth = clipWorth(ctx, world, e, EAT_ATOMIC_ID, HUNGER);
  if (worth <= 0 || !consumeVehicleGood(world, vehicle, ctx.content, food[0])) return false;
  const s = world.mut(e, Settler);
  s.hunger = applyNeedUnits(s.hunger, worth);
  return true;
}

function sleepAboard(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.get(e, Settler);
  if (settler.fatigue < NEED_DRIVE_THRESHOLD) return false;
  if (!due(ctx, e, atomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID))) return false;
  const rest = clipWorth(ctx, world, e, SLEEP_ATOMIC_ID, REST);
  const worth = jobIgnoresHomeHouse(ctx.content, settler.jobType) ? rest : Math.trunc(rest / 2);
  if (worth <= 0) return false;
  const s = world.mut(e, Settler);
  s.fatigue = applyNeedUnits(s.fatigue, worth);
  return true;
}

/** A talk with the first other passenger aboard, who listens: each gets what its half of a chat pays. */
function chatAboard(world: World, ctx: SystemContext, e: Entity, riders: readonly Entity[]): boolean {
  const settler = world.get(e, Settler);
  if (settler.enjoyment < NEED_DRIVE_THRESHOLD) return false;
  const listener = riders.find((other) => other !== e);
  if (listener === undefined) return false;
  if (!due(ctx, e, atomicDuration(ctx.content, settler, TALK_ATOMIC_ID))) return false;
  const talked = clipWorth(ctx, world, e, TALK_ATOMIC_ID, LEISURE);
  if (talked <= 0) return false;
  const s = world.mut(e, Settler);
  s.enjoyment = applyNeedUnits(s.enjoyment, talked);
  if (carriesNeeds(world, ctx.content, listener)) {
    const heard = clipWorth(ctx, world, listener, LISTEN_ATOMIC_ID, LEISURE);
    const l = world.mut(listener, Settler);
    l.enjoyment = applyNeedUnits(l.enjoyment, heard);
  }
  return true;
}
