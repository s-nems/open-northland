import { Building, ownerOf, Position, Settler, SettlerProgress } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { bindEmployment, openWorkerJobFromList } from '../economy/jobs/index.js';
import { isAdultSettler, moveFamilyInto } from '../family/index.js';
import { isOrderableSettler, isTradeAssignable } from '../orders/guards.js';

type SpawnSettlerCommand = Extract<Command, { kind: 'spawnSettler' }>;

/**
 * Move a spawning settler into its authored home and onto its authored workplace - a decoded map's
 * `attachtohouse`, each target named by the anchor half-cell its building was placed on.
 *
 * Deliberately the housing and employment primitives, not the `assignHouse`/`assignWorker` orders: those
 * refuse a target outside the settler's signpost area, and many authored targets sit outside it. A map
 * loads as authored, the same reason `placeBuilding` takes `force`. Each half still applies every
 * admission rule its order does apart from area and building-technology gates, and refuses silently - the loader counts only
 * the attachments it could not resolve to a building at all.
 */
export function attachAuthoredBuildings(
  world: World,
  ctx: SystemContext,
  e: Entity,
  command: SpawnSettlerCommand,
): void {
  // Loose `!= null` because a command is the replay wire format, where an explicit `null` also means
  // "no attachment".
  if (command.home != null && isOrderableSettler(world, e) && isAdultSettler(world, e)) {
    const house = buildingAtAnchor(world, command.home.x, command.home.y);
    if (house !== null) moveFamilyInto(world, ctx, e, house);
  }
  if (command.workplace != null) {
    const building = buildingAtAnchor(world, command.workplace.x, command.workplace.y);
    if (building !== null) postToWorkplace(world, ctx, e, building);
  }
}

/** Employ `e` at `building` in its own trade - see the `workplace` payload doc for why only that trade. */
function postToWorkplace(world: World, ctx: SystemContext, e: Entity, building: Entity): void {
  if (!isTradeAssignable(world, e)) return;
  const settler = world.get(e, Settler);
  if (settler.jobType === null) return; // an idle spawn holds no trade to be posted in
  const progress = world.get(e, SettlerProgress);
  const jobType = openWorkerJobFromList(
    {
      world,
      ctx,
      authored: true,
      tribe: settler.tribe,
      owner: ownerOf(world, e),
      experience: progress.experience,
      learned: progress.learned,
      jobType: settler.jobType,
    },
    building,
    [settler.jobType],
  );
  if (jobType === null) return;
  bindEmployment(world, e, building);
}

/**
 * The building whose anchor node is (`x`,`y`), lowest entity id first. An authored attachment always names
 * an anchor exactly, so this compares nodes rather than searching a footprint. Scans every building, a
 * cost only a settler carrying an attachment pays.
 */
function buildingAtAnchor(world: World, x: number, y: number): Entity | null {
  let found: Entity | null = null;
  for (const b of world.query(Building)) {
    const p = world.tryGet(b, Position);
    if (p === undefined) continue;
    const node = nodeOfPosition(p.x, p.y);
    if (node.hx !== x || node.hy !== y) continue;
    if (found === null || b < found) found = b;
  }
  return found;
}
