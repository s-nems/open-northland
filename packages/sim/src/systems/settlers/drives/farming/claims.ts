import { FarmTask } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';

/** Tick-shared field claims: nodes held by live in-flight tasks plus the picks made earlier in this
 *  planner pass, so two farmers never converge on the same field, sheaf, or sow spot. */
export interface FarmClaims {
  readonly nodes: Set<NodeId>;
  readonly targets: Set<Entity>;
  readonly byFarm: Map<Entity, number>;
  /** The sow spot each farmer replanning this tick set out for, so the replan on arrival keeps that spot
   *  while it stays free instead of drawing a fresh one. */
  readonly sowIntent: Map<Entity, NodeId>;
}

/** Seed claims from farmers whose field task is still in flight. */
export function collectFarmClaims(world: World): FarmClaims {
  const claims: FarmClaims = {
    nodes: new Set(),
    targets: new Set(),
    byFarm: new Map(),
    sowIntent: new Map(),
  };
  for (const entity of world.query(FarmTask)) {
    const task = world.get(entity, FarmTask);
    claims.nodes.add(task.node);
    if (task.target !== undefined) claims.targets.add(task.target);
    if (task.sow) claims.byFarm.set(task.farm, (claims.byFarm.get(task.farm) ?? 0) + 1);
  }
  return claims;
}

/** Release a replanning settler's stale field claim. */
export function releaseFarmTask(world: World, entity: Entity, claims: FarmClaims): void {
  const task = world.tryGet(entity, FarmTask);
  if (task === undefined) return;
  claims.nodes.delete(task.node);
  if (task.target !== undefined) claims.targets.delete(task.target);
  if (task.sow) {
    const count = (claims.byFarm.get(task.farm) ?? 0) - 1;
    if (count > 0) claims.byFarm.set(task.farm, count);
    else claims.byFarm.delete(task.farm);
    claims.sowIntent.set(entity, task.node);
  }
  world.remove(entity, FarmTask);
}
