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
import type { World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { canonicalById } from '../spatial/nodes.js';
import { goodEnabled, jobEnabled, settlerMeetsNeed, typeAllowed } from './unlocks.js';

const signatures = new WeakMap<World, Map<number, string>>();

/** Discoveries belong to the player and survive losing or retraining the worker who earned them. */
export const technologySystem: System = (world, ctx) => {
  if (!professionProgressionEnabled(world)) return;
  let previous = signatures.get(world);
  if (previous === undefined) {
    previous = new Map();
    signatures.set(world, previous);
  }
  let changed = false;
  const present = new Set<number>();
  const permissionVersion = `${world.componentGeneration(AiPlayer)}:${world.componentValueGeneration(AiPlayer)}:${world.componentGeneration(ScriptUnlocks)}:${world.componentValueGeneration(ScriptUnlocks)}:${world.componentGeneration(MapPermissions)}:${world.componentValueGeneration(MapPermissions)}`;
  const discover = (
    owner: number | undefined,
    tribe: number,
    kind: 'job' | 'good' | 'house',
    typeId: number,
  ): boolean => {
    if (!discoverTechnology(world, owner, tribe, kind, typeId)) return false;
    if (owner !== undefined && ctx.tick > 1)
      ctx.events.emit({ kind: 'technologyDiscovered', player: owner, tribe, technology: kind, typeId });
    return true;
  };
  const participants = new Map<number | undefined, Set<number>>();
  for (const entity of canonicalById(world.query(Person, Settler))) {
    const s = world.get(entity, Settler);
    if (s.jobType === null) continue;
    const owner = ownerOf(world, entity);
    const tribe = contentIndex(ctx.content).tribes.get(s.tribe);
    if (tribe === undefined || tribe.jobEnables.length === 0) continue;
    let tribes = participants.get(owner);
    if (tribes === undefined) {
      tribes = new Set();
      participants.set(owner, tribes);
    }
    tribes.add(s.tribe);
    present.add(entity);
    const signature = `${owner}:${s.tribe}:${s.jobType}:${permissionVersion}:${[...s.experience].flat().join(',')}:${s.learned?.job.join(',')}:${s.learned?.good.join(',')}`;
    if (previous.get(entity) === signature) continue;
    previous.set(entity, signature);
    changed = true;
    discover(owner, s.tribe, 'job', s.jobType);
    const subject = { owner, tribe: s.tribe, experience: s.experience, learned: s.learned };
    for (const edge of tribe.jobEnables) {
      if (edge.jobType !== s.jobType || edge.kind === 'vehicle') continue;
      if (!typeAllowed(world, ctx, owner, s.tribe, edge.kind, edge.targetId)) continue;
      if (edge.kind === 'house' && tribe.technology !== undefined) continue;
      if (edge.kind !== 'house' && !settlerMeetsNeed(world, ctx, subject, edge.kind, edge.targetId)) continue;
      discover(owner, s.tribe, edge.kind, edge.targetId);
      if (edge.kind === 'job') {
        for (const product of tribe.jobEnables) {
          if (product.kind !== 'good' || product.jobType !== edge.targetId) continue;
          if (settlerMeetsNeed(world, ctx, subject, 'good', product.targetId))
            discover(owner, s.tribe, 'good', product.targetId);
        }
      }
    }
  }
  for (const entity of previous.keys()) if (!present.has(entity)) previous.delete(entity);
  if (!changed) return;
  for (const [owner, tribes] of participants) {
    for (const tribeId of tribes) {
      const tribe = contentIndex(ctx.content).tribes.get(tribeId);
      if (tribe?.technology === undefined) continue;
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
          advanced = discover(owner, tribeId, 'house', row.house) || advanced;
          for (const good of houseDiscoveryGoods(ctx.content, row.house))
            discover(owner, tribeId, 'good', good);
        }
      } while (advanced);
    }
  }
};
