import {
  CurrentAtomic,
  FarmAnimal,
  Frightened,
  JobAssignment,
  MoveGoal,
  Stranded,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { isTravelling } from '../movement/nav-state.js';
import { entityNode } from '../spatial/nodes.js';
import { farmStands } from './herd.js';
import { summonedAnimals } from './herd-index.js';

/**
 * Walk every summoned animal to its farm's door and hold it there, the original's house-interaction mode:
 * the breeder puts an animal into it from two map points away, and the slaughter runs once both stand on
 * the door tile. A summon whose breeder is gone from the farm is released, so no animal waits at a door
 * nobody will come to, and so is one whose walk in has failed (approximation: the original has no such
 * release, but without it a fenced-off animal would hold its breeder's whole cycle).
 */
export const livestockSummonSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  // The index is a snapshot: releasing a summon below rebuilds it on the next read, not under this loop.
  for (const e of summonedAnimals(world)) {
    const held = world.get(e, FarmAnimal);
    const summoner = held.summoner;
    if (summoner === null) continue;
    if (world.has(e, Stranded) || !summonHolds(world, ctx, held.farm, summoner)) {
      world.mut(e, FarmAnimal).summoner = null;
      continue;
    }
    if (terrain === undefined) continue; // mapless sim: no door to walk to
    const door = interactionNodeId(world, ctx, terrain, held.farm);
    if (door === null) continue;
    if (entityNode(world, terrain, e) === door) continue; // arrived - waits for the knife
    if (world.has(e, Frightened)) continue; // scattering: the fright drive owns its feet
    if (!isTravelling(world, e) && !world.has(e, CurrentAtomic)) world.add(e, MoveGoal, { cell: door });
  }
};

/** Whether the breeder that summoned an animal can still come for it: alive and still this farm's. */
function summonHolds(world: World, ctx: SystemContext, farm: Entity, summoner: Entity): boolean {
  if (!world.isAlive(summoner) || !farmStands(world, ctx, farm)) return false;
  return world.tryGet(summoner, JobAssignment)?.workplace === farm;
}
