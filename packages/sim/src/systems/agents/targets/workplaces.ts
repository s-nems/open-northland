import { Building, JobAssignment, Position, Resource } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain.js';
import type { SystemContext } from '../../context.js';
import { interactionNode, positionedInteractionCell, resourceWorkCell } from '../../footprint/index.js';
import { buildingEnabled } from '../../progression.js';
import { buildingWorkerJobs, recipeOf } from '../../stores.js';

const EMPTY_ATOMICS: ReadonlySet<number> = new Set<number>();

/** The content-authored atomic ids a job may run. */
export function jobAtomics(ctx: SystemContext, jobType: number): ReadonlySet<number> {
  return contentIndex(ctx.content).atomicsByJob.get(jobType) ?? EMPTY_ATOMICS;
}

/** Resolve a settler's still-usable bound producing workplace. */
export function boundWorkplaceTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): Entity | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const workplace = binding.workplace;
  const building = world.tryGet(workplace, Building);
  if (building === undefined || building.tribe !== tribe) return null;
  if (recipeOf(world, ctx, workplace) === undefined) return null;
  if (!buildingWorkerJobs(world, ctx, workplace).has(jobType)) return null;
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null;
  if (!world.has(workplace, Position)) return null;
  return workplace;
}

/** Resolve a target entity to the node the settler can actually interact from. */
export function interactionCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  entity: Entity,
  from?: NodeId,
): NodeId {
  const interaction = interactionNode(world, ctx, entity);
  if (interaction !== null) return terrain.nodeAtClamped(interaction.x, interaction.y);
  if (world.has(entity, Resource)) return resourceWorkCell(world, terrain, entity, from);
  return positionedInteractionCell(world, terrain, entity, from);
}
