import {
  Building,
  DeliveryFlag,
  GroundDrop,
  JobAssignment,
  Owner,
  ownerOf,
  Position,
  Settler,
  Signpost,
  SiteAssignment,
  Stockpile,
  SupplyRun,
  signpostNavigationEnabled,
  UnderConstruction,
  UnreachableGoals,
  WorkFlag,
} from '../../../../components/index.js';
import { landscapeTopologyRevision } from '../../../../components/landscape.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { navigationLimitFor } from '../../../signposts/index.js';
import { GossipCandidates } from '../../../social/index.js';
import { collectInboundSupply } from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import { collectTargets } from '../../targets/index.js';
import { unreachableGoals } from '../../unreachable-goals.js';
import { porterPickupTarget } from './haul-targets.js';

/**
 * Dormancy for the porter rung: a porter whose pickup scan came up empty skips the re-scan until something
 * the scan reads could have changed. The gate compares every input the scan depends on, so behavior stays
 * byte-identical to always re-scanning and only provably-empty work is skipped.
 */

/** What a dormant porter's failed scan saw - re-scan only when some field differs. */
interface DormantEntry {
  /** `porterScanVersion` at the failed scan. */
  readonly version: number;
  /** The porter's node; the scan's confinement range recentres on it, so a displaced porter re-scans. */
  readonly node: NodeId;
  readonly jobType: number;
  readonly tribe: number;
  readonly owner: number | undefined;
  readonly workplace: Entity;
  /** The confinement toggle at the failed scan; its rules singleton is written in place with no generation
   *  bump, so the toggle is compared directly. */
  readonly confined: boolean;
}

interface PorterDormancy {
  readonly entries: Map<Entity, DormantEntry>;
  /** The latest planner deps, read only by the coherence verifier. The stored `ctx` may be stale by then,
   *  which stays sound only while the verified scan path reads stable content and terrain, never
   *  `ctx.tick` or the RNG. */
  ctx: SystemContext;
  terrain: TerrainGraph;
}

const dormancyByWorld = new WeakMap<World, PorterDormancy>();

/**
 * Combined generation of everything the porter pickup scan and its delivery-routing probe read.
 * Generations only grow, so the sum is strictly monotonic and any tracked change moves it. Settler-local
 * inputs are compared per entry instead.
 */
function porterScanVersion(world: World): number {
  return (
    world.componentValueGeneration(Stockpile) +
    world.componentValueGeneration(Building) + // the home upgrade swaps buildingType in place
    world.componentGeneration(Stockpile) +
    world.componentGeneration(Building) +
    world.componentGeneration(UnderConstruction) +
    world.componentGeneration(GroundDrop) +
    world.componentGeneration(DeliveryFlag) +
    world.componentGeneration(WorkFlag) +
    world.componentGeneration(JobAssignment) +
    world.componentGeneration(SiteAssignment) +
    world.componentGeneration(SupplyRun) +
    world.componentGeneration(Signpost) +
    world.componentGeneration(Owner) +
    landscapeTopologyRevision(world)
  );
}

/** The entry the gate would store for `plan` right now (also the shape it compares against). */
function entryFor(plan: PlannerContext): DormantEntry {
  const { world, entity } = plan;
  return {
    version: porterScanVersion(world),
    node: plan.here,
    jobType: plan.jobType,
    tribe: plan.tribe,
    owner: plan.owner,
    workplace: world.get(entity, JobAssignment).workplace,
    confined: signpostNavigationEnabled(world),
  };
}

function sameEntry(a: DormantEntry, b: DormantEntry): boolean {
  return (
    a.version === b.version &&
    a.node === b.node &&
    a.jobType === b.jobType &&
    a.tribe === b.tribe &&
    a.owner === b.owner &&
    a.workplace === b.workplace &&
    a.confined === b.confined
  );
}

/** Whether `plan`'s porter scan is provably still null - true elides the scan for this tick. */
export function porterDormant(plan: PlannerContext): boolean {
  const memo = dormancyByWorld.get(plan.world)?.entries.get(plan.entity);
  return memo !== undefined && sameEntry(memo, entryFor(plan));
}

/** Record a failed porter scan so the identical re-scan is skipped until an input changes. */
export function markPorterDormant(plan: PlannerContext): void {
  // No entry while the porter remembers failed goals: that memo expires by tick with no tracked write, so
  // a null scan under it is not provably null once it expires. An entry banked memo-free stays sound
  // through later memo episodes, since the veto only removes candidates.
  if (unreachableGoals(plan.world, plan.ctx, plan.entity) !== null) return;
  let record = dormancyByWorld.get(plan.world);
  if (record === undefined) {
    record = { entries: new Map(), ctx: plan.ctx, terrain: plan.terrain };
    dormancyByWorld.set(plan.world, record);
    plan.world.registerCacheVerifier('porterDormancy', () => verifyDormancy(plan.world));
  }
  record.ctx = plan.ctx;
  record.terrain = plan.terrain;
  record.entries.set(plan.entity, entryFor(plan));
}

/** Drop a porter's dormancy on a successful pick, so the memo only ever holds failed scans. */
export function wakePorter(world: World, entity: Entity): void {
  dormancyByWorld.get(world)?.entries.delete(entity);
}

/** The `cachesCoherent` re-derivation: a dormant porter whose pickup scan finds work means a scan input
 *  changed without moving `porterScanVersion`. */
function verifyDormancy(world: World): string[] {
  const record = dormancyByWorld.get(world);
  if (record === undefined) return [];
  const { ctx, terrain } = record;
  const errors: string[] = [];
  let shared: { targets: PlannerContext['targets']; inbound: PlannerContext['inbound'] } | null = null;
  for (const [entity, entry] of record.entries) {
    const settler = world.tryGet(entity, Settler);
    const p = world.tryGet(entity, Position);
    const binding = world.tryGet(entity, JobAssignment);
    if (settler === undefined || settler.jobType === null || p === undefined || binding === undefined) {
      // Cache-internal prune of a dead or unbound porter; ids are never reused, so no sim decision can
      // observe the deletion and checked and unchecked runs stay byte-identical.
      record.entries.delete(entity);
      continue;
    }
    // A porter holding a failed-goal memo is skipped, not verified: its scan reads the memo's tick expiry,
    // which the stored stale ctx cannot evaluate. Sound, since a memo only removes candidates.
    if (world.has(entity, UnreachableGoals)) continue;
    const hereNode = nodeOfPosition(p.x, p.y);
    if (shared === null) {
      shared = { targets: collectTargets(world, ctx, terrain), inbound: collectInboundSupply(world) };
    }
    const plan: PlannerContext = {
      world,
      ctx,
      terrain,
      entity,
      tribe: settler.tribe,
      jobType: settler.jobType,
      experience: settler.experience,
      owner: ownerOf(world, entity),
      here: terrain.nodeAtClamped(hereNode.hx, hereNode.hy),
      targets: shared.targets,
      inbound: shared.inbound,
      limit: navigationLimitFor(world, ctx.content, terrain, entity),
      gossipCandidates: new GossipCandidates(world, ctx.content),
    };
    if (!sameEntry(entry, entryFor(plan))) continue; // the gate would re-scan - nothing elided
    if (porterPickupTarget(plan) !== null) {
      errors.push(
        `porter ${entity} is dormant but its pickup scan finds work - a scan input missed the version`,
      );
    }
  }
  return errors;
}
