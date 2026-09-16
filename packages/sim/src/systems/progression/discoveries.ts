import { houseDiscoveryGoods } from '@open-northland/data';
import {
  AiPlayer,
  discoverTechnology,
  isAiPlayer,
  MapPermissions,
  ownerOf,
  Person,
  professionProgressionEnabled,
  ScriptUnlocks,
  Settler,
  technologyDiscovered,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { canonicalById } from '../spatial/nodes.js';
import { goodEnabled, jobEnabled, settlerMeetsNeed, typeAllowed } from './unlocks.js';

/** What a settler's last discovery walk saw of it: the walk repeats only when one of these moves.
 *  Experience and the learned lists only grow, so their sums and lengths tell every change. */
interface DiscoveryInput {
  readonly owner: number | undefined;
  readonly tribe: number;
  readonly jobType: number;
  readonly experience: number;
  readonly learnedJobs: number;
  readonly learnedGoods: number;
  readonly permissions: string;
}

const inputs = new WeakMap<World, Map<number, DiscoveryInput>>();

function experienceSum(experience: ReadonlyMap<number, number>): number {
  let sum = 0;
  for (const amount of experience.values()) sum += amount;
  return sum;
}

function sameInput(a: DiscoveryInput | undefined, b: DiscoveryInput): boolean {
  return (
    a !== undefined &&
    a.owner === b.owner &&
    a.tribe === b.tribe &&
    a.jobType === b.jobType &&
    a.experience === b.experience &&
    a.learnedJobs === b.learnedJobs &&
    a.learnedGoods === b.learnedGoods &&
    a.permissions === b.permissions
  );
}

/** Discoveries belong to the player and survive losing or retraining the worker who earned them. */
export const technologySystem: System = (world, ctx) => {
  if (!professionProgressionEnabled(world)) return;
  let previous = inputs.get(world);
  if (previous === undefined) {
    previous = new Map();
    inputs.set(world, previous);
  }
  const present = new Set<number>();
  const permissions = `${world.componentGeneration(AiPlayer)}:${world.componentValueGeneration(AiPlayer)}:${world.componentGeneration(ScriptUnlocks)}:${world.componentValueGeneration(ScriptUnlocks)}:${world.componentGeneration(MapPermissions)}:${world.componentValueGeneration(MapPermissions)}`;
  const discover = (
    entity: Entity | undefined,
    owner: number | undefined,
    tribe: number,
    kind: 'job' | 'good' | 'house',
    typeId: number,
  ): boolean => {
    if (!discoverTechnology(world, owner, tribe, kind, typeId)) return false;
    if (entity !== undefined && owner !== undefined && ctx.tick > 1)
      ctx.events.emit({
        kind: 'technologyDiscovered',
        entity,
        player: owner,
        tribe,
        technology: kind,
        typeId,
      });
    return true;
  };
  const advanceHouses = (entity: Entity, owner: number | undefined, tribeId: number): void => {
    const tribe = contentIndex(ctx.content).tribes.get(tribeId);
    if (tribe?.technology === undefined) return;
    let advanced: boolean;
    do {
      advanced = false;
      for (const row of tribe.technology.houses) {
        if (technologyDiscovered(world, owner, tribeId, 'house', row.house)) continue;
        if (!typeAllowed(world, ctx, owner, tribeId, 'house', row.house)) continue;
        if (
          !(owner !== undefined && isAiPlayer(world, owner)) &&
          (!row.jobs.every((id) => jobEnabled(world, ctx, owner, tribeId, id)) ||
            !row.goods.every((id) => goodEnabled(world, ctx, owner, tribeId, id)))
        )
          continue;
        advanced = discover(entity, owner, tribeId, 'house', row.house) || advanced;
        for (const good of houseDiscoveryGoods(ctx.content, row.house))
          discover(entity, owner, tribeId, 'good', good);
      }
    } while (advanced);
  };
  for (const entity of canonicalById(world.query(Person, Settler))) {
    const s = world.get(entity, Settler);
    if (s.jobType === null) continue;
    const owner = ownerOf(world, entity);
    const tribe = contentIndex(ctx.content).tribes.get(s.tribe);
    if (tribe === undefined || tribe.jobEnables.length === 0) continue;
    present.add(entity);
    const input: DiscoveryInput = {
      owner,
      tribe: s.tribe,
      jobType: s.jobType,
      experience: experienceSum(s.experience),
      learnedJobs: s.learned?.job.length ?? 0,
      learnedGoods: s.learned?.good.length ?? 0,
      permissions,
    };
    if (sameInput(previous.get(entity), input)) continue;
    previous.set(entity, input);
    const subject = { owner, tribe: s.tribe, experience: s.experience, learned: s.learned };
    if (settlerMeetsNeed(world, ctx, subject, 'job', s.jobType)) {
      discover(entity, owner, s.tribe, 'job', s.jobType);
    }
    for (const edge of tribe.jobEnables) {
      if (edge.jobType !== s.jobType || edge.kind === 'vehicle') continue;
      if (!typeAllowed(world, ctx, owner, s.tribe, edge.kind, edge.targetId)) continue;
      if (edge.kind === 'house' && tribe.technology !== undefined) continue;
      if (edge.kind !== 'house' && !settlerMeetsNeed(world, ctx, subject, edge.kind, edge.targetId)) continue;
      discover(entity, owner, s.tribe, edge.kind, edge.targetId);
      if (edge.kind === 'job') {
        for (const product of tribe.jobEnables) {
          if (product.kind !== 'good' || product.jobType !== edge.targetId) continue;
          if (settlerMeetsNeed(world, ctx, subject, 'good', product.targetId))
            discover(entity, owner, s.tribe, 'good', product.targetId);
        }
      }
    }
    advanceHouses(entity, owner, s.tribe);
  }
  for (const entity of previous.keys()) if (!present.has(entity)) previous.delete(entity);
};
