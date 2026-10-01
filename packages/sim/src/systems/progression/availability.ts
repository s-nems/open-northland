import type { ContentSet, JobEnablesKind, Recipe, TribeType, VehicleType } from '@open-northland/data';
import {
  AiPlayer,
  Building,
  isAiPlayer,
  MAX_PLAYERS,
  MapPermissions,
  mapPermission,
  ownerOf,
  PlayerPlacementRules,
  ProgressionRules,
  professionProgressionEnabled,
  ScriptUnlocks,
  SeatTribeUnlocks,
  Settler,
  scriptAllows,
  scriptEnables,
  TechnologyDiscoveries,
  technologyDiscovered,
  tribeUnlockedFor,
  type UnlockKind,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { assignedWorkers } from '../stores/assigned-workers.js';
import { aliveTribeJobs } from './alive-jobs.js';

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

/**
 * Whether a standing workplace of the type may take a worker. Under a technology table the trade
 * itself is gated, so the house needs no discovery of its own; without one the house's unlock decides
 * (`PROGRESSION.md`).
 */
export function workplaceStaffable(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  buildingType: number,
): boolean {
  if (contentIndex(ctx.content).tribes.get(tribe)?.technology !== undefined) return true;
  return buildingEnabled(world, ctx, owner, tribe, buildingType);
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

/** Whether the workplace's owner has `recipe`'s products enabled for the operator's own tribe. Original
 *  behavior (read from the original's logic, unconfirmed against the running game): a product is
 *  enabled per worker, by `(player, that worker's tribe)`, never by the house's tribe. It is also a yard
 *  turn's whole start gate, since a vehicle is never a cycle and `canStartCycle` refuses it outright. */
export function operatorRecipeEnabled(
  world: World,
  ctx: ContentContext,
  building: Entity,
  operator: Entity,
  recipe: Recipe,
): boolean {
  return recipeOutputsEnabled(
    world,
    ctx,
    ownerOf(world, building),
    world.get(operator, Settler).tribe,
    recipe,
  );
}

/**
 * {@link recipeOutputsEnabled} for a gate that reads a whole workplace rather than one worker: enabled
 * for the tribe of any worker bound to it, or for the building's own tribe while nobody is. A gate
 * that knows its worker asks {@link operatorRecipeEnabled} instead.
 */
export function workplaceRecipeEnabled(
  world: World,
  ctx: ContentContext,
  workplace: Entity,
  recipe: Recipe,
): boolean {
  const owner = ownerOf(world, workplace);
  const workers = assignedWorkers(world, workplace);
  if (workers.length === 0) {
    return recipeOutputsEnabled(world, ctx, owner, world.get(workplace, Building).tribe, recipe);
  }
  let refused: number | undefined;
  for (const worker of workers) {
    const tribe = world.tryGet(worker, Settler)?.tribe;
    if (tribe === undefined || tribe === refused) continue;
    if (recipeOutputsEnabled(world, ctx, owner, tribe, recipe)) return true;
    refused = tribe;
  }
  return false;
}

/** Every store {@link recipeOutputsEnabled} reads for a tribe with a technology table. */
const TECHNOLOGY_UNLOCK_STORES: readonly Component<unknown>[] = [
  ScriptUnlocks,
  MapPermissions,
  ProgressionRules,
  TechnologyDiscoveries,
  AiPlayer,
  PlayerPlacementRules,
  SeatTribeUnlocks,
];

/**
 * A number that changes whenever an unlock {@link recipeOutputsEnabled} reads for a tribe with a
 * technology table may have changed: the sum of those stores' generations, each monotonic. A tribe
 * without a table is gated by its alive trades, which this does not cover.
 */
export function technologyUnlockGeneration(world: World): number {
  return storesGeneration(world, TECHNOLOGY_UNLOCK_STORES);
}

/** Every store {@link typeAllowed} reads. */
const PERMISSION_STORES: readonly Component<unknown>[] = [ScriptUnlocks, MapPermissions];

function storesGeneration(world: World, stores: readonly Component<unknown>[]): number {
  let generation = 0;
  for (const store of stores) {
    generation += world.componentGeneration(store) + world.componentValueGeneration(store);
  }
  return generation;
}

/** One world's memoized unlock verdicts, valid while the content and the read stores' generation hold.
 *  Derived read state, never hashed or saved. */
interface UnlockVerdicts {
  content: ContentSet | null;
  generation: number;
  readonly verdicts: Map<number, boolean>;
}

const allowedVerdicts = new WeakMap<World, UnlockVerdicts>();
const technologyVerdicts = new WeakMap<World, UnlockVerdicts>();

const VERDICT_KINDS: readonly JobEnablesKind[] = ['job', 'house', 'good', 'vehicle'];
/** Tribe ids a packed verdict key holds; a larger id is answered unmemoized. */
const VERDICT_TRIBE_SLOTS = 256;
/** Owner slots: every player plus "no owner". */
const VERDICT_OWNER_SLOTS = MAX_PLAYERS + 1;

/** One number per (owner, tribe, kind, type), or null when an id falls outside the packed ranges. */
function verdictKey(
  owner: number | undefined,
  tribe: number,
  kind: JobEnablesKind,
  typeId: number,
): number | null {
  const ownerSlot = owner === undefined ? 0 : owner + 1;
  if (!Number.isInteger(ownerSlot) || ownerSlot < 0 || ownerSlot >= VERDICT_OWNER_SLOTS) return null;
  if (!Number.isInteger(tribe) || tribe < 0 || tribe >= VERDICT_TRIBE_SLOTS) return null;
  if (!Number.isSafeInteger(typeId) || typeId < 0) return null;
  const packed =
    ((typeId * VERDICT_KINDS.length + VERDICT_KINDS.indexOf(kind)) * VERDICT_TRIBE_SLOTS + tribe) *
      VERDICT_OWNER_SLOTS +
    ownerSlot;
  return Number.isSafeInteger(packed) ? packed : null;
}

/** `memo`'s verdicts for `world`, emptied when the content or `generation` moved since they were taken. */
function currentVerdicts(
  memo: WeakMap<World, UnlockVerdicts>,
  world: World,
  content: ContentSet,
  generation: number,
): Map<number, boolean> {
  let held = memo.get(world);
  if (held === undefined) {
    held = { content, generation, verdicts: new Map() };
    memo.set(world, held);
  } else if (held.content !== content || held.generation !== generation) {
    held.verdicts.clear();
    held.content = content;
    held.generation = generation;
  }
  return held.verdicts;
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

/**
 * Whether the tribe's tech tree opens the target for the owner. A tribe the owner has not unlocked
 * ({@link tribeUnlockedFor}) opens nothing; only a script line enables one of its items. Original
 * behavior (unconfirmed against the running game): at init a player gets enabled flags for its own
 * tribe alone. Under a technology table the
 * player's discoveries decide, which the discovery system records at the end of every tick's commands,
 * missions and work: a job with no `needforjob` row, a good no job produces, and everything for an AI
 * seat are open from the start (reading of the original's per-player init). Without the table the
 * trades the tribe holds alive decide.
 */
function tribeUnlockEnabled(
  world: World,
  ctx: ContentContext,
  tribe: number,
  kind: JobEnablesKind,
  targetId: number,
  owner?: number,
): boolean {
  // A technology tribe's verdict reads only the stores technologyUnlockGeneration sums; a vehicle and a
  // tribe without a table read the alive trades, which that number does not cover.
  const key = verdictKey(owner, tribe, kind, targetId);
  if (
    key === null ||
    kind === 'vehicle' ||
    contentIndex(ctx.content).tribes.get(tribe)?.technology === undefined
  )
    return tribeUnlockVerdict(world, ctx, tribe, kind, targetId, owner);
  const verdicts = currentVerdicts(technologyVerdicts, world, ctx.content, technologyUnlockGeneration(world));
  let verdict = verdicts.get(key);
  if (verdict === undefined) {
    verdict = tribeUnlockVerdict(world, ctx, tribe, kind, targetId, owner);
    verdicts.set(key, verdict);
  }
  return verdict;
}

function tribeUnlockVerdict(
  world: World,
  ctx: ContentContext,
  tribe: number,
  kind: JobEnablesKind,
  targetId: number,
  owner?: number,
): boolean {
  if (!tribeUnlockedFor(world, owner, tribe)) return false;
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
    if (kind === 'job' && !needsExperienceForJob(definition, targetId)) return true;
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

function needsExperienceForJob(definition: TribeType, jobType: number): boolean {
  return definition.jobRequirements.some(
    (r) => r.target === 'job' && r.targetId === jobType && r.requirement === 'need' && r.amount > 0,
  );
}

/**
 * Whether the tribe's tech tree keeps a job closed until someone discovers it: under a technology table
 * a job with a `needforjob` threshold, otherwise one a `jobEnablesJob` edge opens. Every other job, the
 * life stages and the civilist among them, is open from the start, so discovering it is no news.
 */
export function jobAwaitsDiscovery(ctx: ContentContext, tribe: number, jobType: number): boolean {
  const index = contentIndex(ctx.content);
  const definition = index.tribes.get(tribe);
  if (definition === undefined) return false;
  if (definition.technology !== undefined) return needsExperienceForJob(definition, jobType);
  return index.enablingJobsByTribe.get(tribe)?.get('job')?.has(jobType) ?? false;
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

/** A script's `Allow*` overrides authored bans; otherwise the map's permission table, then the tribe's
 *  initial allow table, is authoritative. `Enable*` never lifts a ban (reading: the original
 *  requires the allowed flag beside the enabled one). */
export function typeAllowed(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  const key = verdictKey(owner, tribe, kind, typeId);
  if (key === null) return typeVerdict(world, ctx, owner, tribe, kind, typeId);
  const verdicts = currentVerdicts(
    allowedVerdicts,
    world,
    ctx.content,
    storesGeneration(world, PERMISSION_STORES),
  );
  let verdict = verdicts.get(key);
  if (verdict === undefined) {
    verdict = typeVerdict(world, ctx, owner, tribe, kind, typeId);
    verdicts.set(key, verdict);
  }
  return verdict;
}

function typeVerdict(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  if (scriptAllows(world, owner, tribe, kind, typeId)) return true;
  return (
    mapPermission(world, owner, tribe, kind, typeId) ??
    contentIndex(ctx.content).tribes.get(tribe)?.permissions?.[kind].includes(typeId) ??
    true
  );
}

/** Whether a tribe may have a job, house or good at all, and whether `owner` has unlocked it yet. */
export interface UnlockStatus {
  allowed: boolean;
  enabled: boolean;
  enablingJobs: number[];
  requiredJobs: number[];
  /** Each good the house still waits on, with the jobs whose work discovers it. */
  requiredGoods: { good: number; jobs: number[] }[];
}

export function unlockStatus(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): UnlockStatus {
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
  const enablers = contentIndex(ctx.content).enablingJobsByTribe.get(tribe);
  return {
    requiredJobs: house?.jobs.filter((id) => !jobEnabled(world, ctx, owner, tribe, id)) ?? [],
    requiredGoods:
      house?.goods
        .filter((id) => !goodEnabled(world, ctx, owner, tribe, id))
        .map((good) => ({ good, jobs: [...(enablers?.get('good')?.get(good) ?? [])] })) ?? [],
    allowed,
    enabled,
    enablingJobs: [...(enablers?.get(kind)?.get(typeId) ?? [])],
  };
}
