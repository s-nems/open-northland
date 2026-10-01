import type { Recipe } from '@open-northland/data';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { BREEDING_PAIR } from '../economy/production/cycles.js';
import { herdRoom, speciesHerdOf } from '../livestock/index.js';
import { livestockTribeOfGood } from './tribes/livestock.js';

/**
 * Why a farm's herd keeps a breeder from breeding a species: no animal of it at all, fewer than the
 * {@link BREEDING_PAIR} even once the young grow up, enough animals but too few of them grown, or a herd
 * with no room left for a calf.
 */
export type HerdWait = 'noAnimals' | 'tooFew' | 'youngGrowing' | 'herdFull';

/** One species' herd holding its breeding recipe back. */
export interface HerdHold {
  /** The species good, the breeding recipe's product. */
  readonly goodType: number;
  readonly wait: HerdWait;
  readonly adults: number;
  readonly young: number;
}

/**
 * What `farm`'s herd makes of `recipe`: null for a recipe that breeds no species, or a pair with room for a
 * calf, where the inputs decide; `slaughter` while grown animals past the pair stand, which the breeder
 * slaughters before it breeds; otherwise the hold. The same herd gates the breeding cycle's start.
 */
export function herdHoldOf(
  world: World,
  ctx: SystemContext,
  farm: Entity,
  recipe: Recipe,
): HerdHold | 'slaughter' | null {
  const species = recipe.outputs[0]?.goodType;
  if (species === undefined || livestockTribeOfGood(ctx.content, species) === null) return null;
  const { all, adults } = speciesHerdOf(world, ctx, farm, species);
  if (adults > BREEDING_PAIR) return 'slaughter';
  const wait = herdWaitOf(all, adults, () => herdRoom(world, ctx, farm, species) > 0);
  return wait === null ? null : { goodType: species, wait, adults, young: all - adults };
}

function herdWaitOf(all: number, adults: number, hasRoom: () => boolean): HerdWait | null {
  if (all === 0) return 'noAnimals';
  if (all < BREEDING_PAIR) return 'tooFew';
  if (adults < BREEDING_PAIR) return 'youngGrowing';
  return hasRoom() ? null : 'herdFull';
}
