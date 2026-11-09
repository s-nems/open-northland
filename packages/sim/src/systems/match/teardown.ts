import {
  Building,
  DraughtAnimal,
  FarmAnimal,
  Livestock,
  Owner,
  Person,
  ReleasedFrom,
  Signpost,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { removeBuildingSilently } from '../lifecycle/cleanup.js';
import { removeSettlerSilently } from '../lifecycle/death.js';
import { entityPoint } from '../missions/targets.js';
import { clearNavState } from '../movement/nav-state.js';
import { razeSignpost } from '../signposts/placement.js';
import { spawnAnimalHerd, stampWildRange } from '../spawn/animals.js';
import { isLand, removeVehiclesOf } from '../vehicles/remove.js';

/** The creature left where each of the loser's humans stood: the `chicken` tribe's adult. */
const LOSER_CHICKEN_TRIBE_SLUG = 'chicken';

/**
 * Take a seat the goal table lost off the map, the way the original does on the check after the verdict:
 * every house, human, vehicle and signpost goes as a script removal (no death, no tally), a wild chicken
 * is left in place of each human that stood on land, and the seat's animals turn wild where they graze.
 * Content without a `chicken` tribe leaves nothing in the humans' place.
 */
export function tearDownLoser(world: World, ctx: SystemContext, player: number): void {
  const owned = (e: Entity): boolean => world.get(e, Owner).player === player;
  for (const e of [...world.canonicalQuery(Building, Owner)].filter(owned)) {
    if (world.isAlive(e)) removeBuildingSilently(world, ctx, e);
  }
  const chicken = contentIndex(ctx.content).tribeTypeBySlug.get(LOSER_CHICKEN_TRIBE_SLUG);
  for (const e of [...world.canonicalQuery(Person, Owner)].filter(owned)) {
    if (!world.isAlive(e)) continue;
    const stood = entityPoint(world, e);
    const onLand = stood !== undefined && isLand(ctx, stood);
    removeSettlerSilently(world, e);
    if (onLand && chicken !== undefined) {
      spawnAnimalHerd(world, ctx, {
        kind: 'spawnAnimalHerd',
        tribe: chicken,
        x: stood.hx,
        y: stood.hy,
        count: 1,
      });
    }
  }
  removeVehiclesOf(world, ctx, player, 'script');
  for (const e of [...world.canonicalQuery(Signpost, Owner)].filter(owned)) {
    if (world.isAlive(e)) razeSignpost(world, e);
  }
  for (const e of [...world.canonicalQuery(Livestock, Owner)].filter(owned)) {
    if (world.isAlive(e)) turnWild(world, ctx, e);
  }
}

/** Drop the claim and whatever bound the animal to the seat: its farm or the farm that let it go, a summons
 *  to its door, a cart's recruitment. It takes a fresh wild range where it stands and grazes on from there. */
function turnWild(world: World, ctx: SystemContext, e: Entity): void {
  world.remove(e, Owner);
  let walking = false;
  if (world.has(e, FarmAnimal)) {
    walking = world.get(e, FarmAnimal).summoner !== null;
    world.remove(e, FarmAnimal);
  }
  if (world.has(e, ReleasedFrom)) world.remove(e, ReleasedFrom);
  if (world.has(e, DraughtAnimal)) {
    world.remove(e, DraughtAnimal);
    walking = true;
  }
  if (walking) clearNavState(world, e);
  stampWildRange(world, ctx, e);
}
