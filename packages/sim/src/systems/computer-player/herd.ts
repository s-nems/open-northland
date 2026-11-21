import { ownerOf } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { goodTypeByContentId } from '../ai-shared/content-lookup.js';
import type { SystemContext } from '../context.js';
import { freeStockOf, herdedFarms, herdOf, speciesGoodOf } from '../livestock/index.js';

/** Owner ruling: a seat keeps a species once it owns this many of it, a breeding pair. Under it the animal
 *  farm cannot breed the species and the clothing made from it stops. */
export const HERD_PAIR = 2;

/**
 * Which species the seat keeps at least a {@link HERD_PAIR} of (owner ruling): both, only cattle (the
 * leather for shoes and leather armour), only sheep (the wool for tunics), or none, when the animal farm and
 * the tailors stop.
 */
export type HerdKept = 'both' | 'cattle' | 'sheep' | 'none';

/**
 * The species `player` keeps ({@link HerdKept}), counting every animal it owns: the claimed stock no farm
 * holds and the herds of its farms, young ones included. A content without the sheep or the cattle good
 * reads `both`, since no breeder there raises the missing one.
 *
 * Cost: the seat's own animals and the farms holding a herd, both read off the livestock indexes.
 */
export function seatHerdKept(world: World, ctx: SystemContext, player: number): HerdKept {
  const sheepGood = goodTypeByContentId(ctx.content, 'sheep')?.typeId;
  const cattleGood = goodTypeByContentId(ctx.content, 'cattle')?.typeId;
  if (sheepGood === undefined || cattleGood === undefined) return 'both';
  let sheep = 0;
  let cattle = 0;
  const count = (good: number | null): void => {
    if (good === sheepGood) sheep += 1;
    else if (good === cattleGood) cattle += 1;
  };
  const freeStock = freeStockOf(world, player);
  for (let i = 0; i < freeStock.length; i++) {
    const animal = freeStock[i];
    if (animal === undefined) continue;
    count(speciesGoodOf(world, ctx, animal));
  }
  const farms = herdedFarms(world);
  for (let i = 0; i < farms.length; i++) {
    const farm = farms[i];
    if (farm === undefined) continue;
    if (ownerOf(world, farm) !== player) continue;
    const herd = herdOf(world, farm);
    for (let j = 0; j < herd.length; j++) {
      const animal = herd[j];
      if (animal === undefined) continue;
      count(speciesGoodOf(world, ctx, animal));
    }
  }
  const keepsSheep = sheep >= HERD_PAIR;
  const keepsCattle = cattle >= HERD_PAIR;
  if (keepsSheep && keepsCattle) return 'both';
  if (keepsCattle) return 'cattle';
  return keepsSheep ? 'sheep' : 'none';
}
