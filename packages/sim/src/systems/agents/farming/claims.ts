import { FarmTask } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain.js';

/** Tick-shared field claims and lazily built sow-search state. */
export interface FarmClaims {
  readonly nodes: Set<NodeId>;
  readonly byFarm: Map<Entity, number>;
  readonly fieldCrew: Map<Entity, number>;
  sowScan?: SowScan;
}

export interface SowScan {
  readonly blocked: ReadonlySet<NodeId>;
  readonly occupied: ReadonlySet<NodeId>;
}

/** Seed claims from farmers whose field task is still in flight. */
export function collectFarmClaims(world: World): FarmClaims {
  const claims: FarmClaims = { nodes: new Set(), byFarm: new Map(), fieldCrew: new Map() };
  for (const entity of world.query(FarmTask)) {
    const task = world.get(entity, FarmTask);
    claims.nodes.add(task.node as NodeId);
    if (task.sow) claims.byFarm.set(task.farm, (claims.byFarm.get(task.farm) ?? 0) + 1);
  }
  return claims;
}

/** Release a replanning settler's stale field claim. */
export function releaseFarmTask(world: World, entity: Entity, claims: FarmClaims): void {
  const task = world.tryGet(entity, FarmTask);
  if (task === undefined) return;
  claims.nodes.delete(task.node as NodeId);
  if (task.sow) {
    const count = (claims.byFarm.get(task.farm) ?? 0) - 1;
    if (count > 0) claims.byFarm.set(task.farm, count);
    else claims.byFarm.delete(task.farm);
  }
  world.remove(entity, FarmTask);
}
