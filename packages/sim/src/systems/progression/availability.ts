import type { JobEnablesKind, Recipe, VehicleType } from '@open-northland/data';
import {
  isAiPlayer,
  mapPermission,
  ownerOf,
  Person,
  professionProgressionEnabled,
  Settler,
  scriptAllows,
  scriptEnables,
  technologyDiscovered,
  type UnlockKind,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { aliveTribeJobs } from './alive-jobs.js';
import { needSubjectOf, settlerMeetsNeed } from './unlocks.js';

export function buildingEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  buildingType: number,
): boolean {
  if (!typeAllowed(world, ctx, owner, tribe, 'house', buildingType)) return false;
  if (!professionProgressionEnabled(world)) return true;
  return (
    scriptEnables(world, owner, tribe, 'house', buildingType) ||
    tribeUnlockEnabled(world, ctx, tribe, 'house', buildingType, owner)
  );
}

export function goodEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  goodType: number,
): boolean {
  if (!typeAllowed(world, ctx, owner, tribe, 'good', goodType)) return false;
  if (!professionProgressionEnabled(world)) return true;
  return (
    scriptEnables(world, owner, tribe, 'good', goodType) ||
    tribeUnlockEnabled(world, ctx, tribe, 'good', goodType, owner)
  );
}

export function recipeOutputsEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  recipe: Recipe,
): boolean {
  for (const output of recipe.outputs) {
    if (!goodEnabled(world, ctx, owner, tribe, output.goodType)) return false;
  }
  return true;
}

export function jobEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  jobType: number,
): boolean {
  if (!typeAllowed(world, ctx, owner, tribe, 'job', jobType)) return false;
  if (!professionProgressionEnabled(world)) return true;
  return (
    scriptEnables(world, owner, tribe, 'job', jobType) ||
    tribeUnlockEnabled(world, ctx, tribe, 'job', jobType, owner)
  );
}

/** Discovery state supplements prerequisite reads while a world is being assembled. */
function tribeUnlockEnabled(
  world: World,
  ctx: ContentContext,
  tribe: number,
  kind: JobEnablesKind,
  targetId: number,
  owner?: number,
): boolean {
  if (kind !== 'vehicle' && technologyDiscovered(world, owner, tribe, kind, targetId)) return true;
  const definition = contentIndex(ctx.content).tribes.get(tribe);
  if (definition?.technology !== undefined && kind !== 'vehicle') {
    if (owner !== undefined && isAiPlayer(world, owner)) return true;
    if (kind === 'house') {
      const requirement = definition.technology.houses.find((r) => r.house === targetId);
      return (
        requirement === undefined ||
        (requirement.jobs.every((id) => jobEnabled(world, ctx, owner, tribe, id)) &&
          requirement.goods.every((id) => goodEnabled(world, ctx, owner, tribe, id)))
      );
    }
    if (
      kind === 'job' &&
      !definition.jobRequirements.some(
        (r) => r.target === 'job' && r.targetId === targetId && r.requirement === 'need' && r.amount > 0,
      )
    )
      return true;
    for (const entity of world.query(Person, Settler)) {
      const worker = world.get(entity, Settler);
      if (worker.tribe !== tribe || ownerOf(world, entity) !== owner) continue;
      if (kind === 'job' && worker.jobType === targetId) return true;
      if (
        !definition.jobEnables.some(
          (edge) => edge.jobType === worker.jobType && edge.kind === kind && edge.targetId === targetId,
        )
      )
        continue;
      if (settlerMeetsNeed(world, ctx, needSubjectOf(world, entity), kind, targetId)) return true;
    }
    return kind === 'good' && !definition.jobEnables.some((e) => e.kind === kind && e.targetId === targetId);
  }
  const enablingJobs = contentIndex(ctx.content).enablingJobsByTribe.get(tribe)?.get(kind)?.get(targetId);
  if (enablingJobs === undefined) return true;

  const trades = aliveTribeJobs(world, owner).get(tribe);
  if (trades === undefined) return false; // the tribe holds no trade at all
  for (const jobType of enablingJobs) {
    if (trades.has(jobType)) return true;
  }
  return false;
}

/**
 * The ship types `tribe` has currently unlocked, sorted ascending by `typeId` so the order cannot depend
 * on `content.vehicles` declaration order. Composes the extracted `passengerSlots` ship classification
 * with the `vehicle`-kind tech gate.
 */
export function tribeShipsUnlocked(
  world: World,
  ctx: ContentContext,
  tribe: number,
  owner?: number,
): VehicleType[] {
  return ctx.content.vehicles
    .filter((v) => isShipVehicle(v) && tribeUnlockEnabled(world, ctx, tribe, 'vehicle', v.typeId, owner))
    .sort((a, b) => a.typeId - b.typeId);
}

/** Map grants override authored bans; otherwise the tribe's initial allow table is authoritative. */
export function typeAllowed(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  if (scriptAllows(world, owner, tribe, kind, typeId) || scriptEnables(world, owner, tribe, kind, typeId))
    return true;
  return (
    mapPermission(world, owner, tribe, kind, typeId) ??
    contentIndex(ctx.content).tribes.get(tribe)?.permissions?.[kind].includes(typeId) ??
    true
  );
}

export function unlockStatus(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): {
  allowed: boolean;
  enabled: boolean;
  enablingJobs: number[];
  requiredJobs: number[];
  requiredGoods: number[];
} {
  const allowed = typeAllowed(world, ctx, owner, tribe, kind, typeId);
  const enabled =
    kind === 'house'
      ? buildingEnabled(world, ctx, owner, tribe, typeId)
      : kind === 'good'
        ? goodEnabled(world, ctx, owner, tribe, typeId)
        : jobEnabled(world, ctx, owner, tribe, typeId);
  const house =
    kind === 'house'
      ? contentIndex(ctx.content)
          .tribes.get(tribe)
          ?.technology?.houses.find((r) => r.house === typeId)
      : undefined;
  return {
    requiredJobs: house?.jobs.filter((id) => !jobEnabled(world, ctx, owner, tribe, id)) ?? [],
    requiredGoods: house?.goods.filter((id) => !goodEnabled(world, ctx, owner, tribe, id)) ?? [],
    allowed,
    enabled,
    enablingJobs: [
      ...(contentIndex(ctx.content).enablingJobsByTribe.get(tribe)?.get(kind)?.get(typeId) ?? []),
    ],
  };
}
