import { PRAYER_SITE, type StockSlot } from '@open-northland/data';
import {
  Building,
  Health,
  isScriptedEconomySeat,
  ownerOf,
  Stockpile,
  setStockAmount,
  TempleFire,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { ContentContext, SystemContext } from '../../context.js';
import { isFinishedPrayerSite, templeFuelSlotOf } from '../../readviews/index.js';
import type { SupplyTally } from '../../stores/index.js';

/** Game seconds one unit of fuel burns in a temple. Owner ruling: five game minutes, so a full store
 *  lasts its capacity times that. */
export const TEMPLE_FUEL_BURN_SECONDS = 300;

/**
 * The fuel slot `temple`'s fire burns, or undefined when it blesses unfed: its type stores nothing, or
 * a map-scripted seat owns it, whose temples need no fuel (owner ruling).
 */
function fuelBurnedBy(world: World, ctx: ContentContext, temple: Entity): StockSlot | undefined {
  const type = world.tryGet(temple, Building)?.buildingType;
  const slot = type === undefined ? undefined : templeFuelSlotOf(ctx.content, type);
  if (slot === undefined) return undefined;
  const owner = ownerOf(world, temple);
  return owner !== undefined && isScriptedEconomySeat(world, owner) ? undefined : slot;
}

/** Units of fuel `temple`'s store still takes beyond what it holds and the loads settlers are bringing it;
 *  0 for a temple that stores none. A scripted seat's temple fills once and then holds, burning none. */
export function templeFuelShortfall(
  world: World,
  ctx: ContentContext,
  supply: SupplyTally,
  temple: Entity,
): number {
  const type = world.tryGet(temple, Building)?.buildingType;
  const slot = type === undefined ? undefined : templeFuelSlotOf(ctx.content, type);
  if (slot === undefined) return 0;
  const stored = storedFuel(world, temple, slot);
  return Math.max(0, slot.capacity - stored - supply.inboundOf(temple, slot.goodType));
}

/**
 * One game second of `temple`'s fire, recorded on its {@link TempleFire}: it blesses while it has an
 * owner, stands unwounded and, when it burns fuel, holds a unit and its owner keeps the fire lit. The
 * oldest unit burns for {@link TEMPLE_FUEL_BURN_SECONDS} and then leaves the store; a wound or a fire put
 * out pauses the burn with the blessing.
 * True when the temple blesses this second. With `burn` off the fire is recorded and nothing burns: the
 * record a temple takes the tick it is finished, so what it shows is decided before its first second.
 */
export function tendTempleFire(world: World, ctx: ContentContext, temple: Entity, burn = true): boolean {
  const health = world.tryGet(temple, Health);
  const whole = health === undefined || health.hitpoints >= health.max;
  const slot = fuelBurnedBy(world, ctx, temple);
  const fuelGood = slot?.goodType ?? null;
  const stored = slot === undefined ? 0 : storedFuel(world, temple, slot);
  const held = world.tryGet(temple, TempleFire);
  const doused = slot !== undefined && held?.doused === true;
  const owned = ownerOf(world, temple) !== undefined;
  const blessing = owned && whole && !doused && (slot === undefined || stored > 0);
  let burned = held?.burnedSeconds ?? 0;
  if (burn && slot !== undefined && blessing) {
    burned += 1;
    if (burned >= TEMPLE_FUEL_BURN_SECONDS) {
      setStockAmount(world, temple, slot.goodType, stored - 1);
      burned = 0;
    }
  }
  if (held === undefined) {
    world.add(temple, TempleFire, { burnedSeconds: burned, blessing, doused: false, fuelGood });
  } else if (held.burnedSeconds !== burned || held.blessing !== blessing || held.fuelGood !== fuelGood) {
    const fire = world.mut(temple, TempleFire);
    fire.burnedSeconds = burned;
    fire.blessing = blessing;
    fire.fuelGood = fuelGood;
  }
  return blessing;
}

/**
 * A player's order to light `command.building`'s fire or put it out (owner ruling: a fire put out keeps
 * its oil). Refused for a site, an unowned temple and a house whose fire burns no fuel; the blessing
 * follows at the next game second.
 */
export function setTempleFire(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setTempleFire' }>,
): void {
  const temple = command.building;
  if (!world.isAlive(temple) || !isFinishedPrayerSite(world, ctx, temple, PRAYER_SITE.temple)) return;
  const slot = ownerOf(world, temple) === undefined ? undefined : fuelBurnedBy(world, ctx, temple);
  if (slot === undefined) return;
  const doused = !command.lit;
  const held = world.tryGet(temple, TempleFire);
  if (held === undefined) {
    world.add(temple, TempleFire, { burnedSeconds: 0, blessing: false, doused, fuelGood: slot.goodType });
  } else if (held.doused !== doused) {
    world.mut(temple, TempleFire).doused = doused;
  }
}

function storedFuel(world: World, temple: Entity, slot: StockSlot): number {
  return world.tryGet(temple, Stockpile)?.amounts.get(slot.goodType) ?? 0;
}
