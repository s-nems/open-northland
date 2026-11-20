import {
  Building,
  CARRIER_WALK_ROUTE_STEPS,
  DeliveryFlag,
  GroundDrop,
  HaulFlag,
  hasMissionBehaviour,
  JobAssignment,
  MISSION_BEHAVIOUR,
  Owner,
  ownerOf,
  PickupClaim,
  Position,
  Settler,
  SettlerProgress,
  Signpost,
  SiteAssignment,
  Stockpile,
  StorageMinimums,
  StorageRules,
  StorePriority,
  SupplyRun,
  signpostNavigationEnabled,
  UnderConstruction,
  UnreachableGoals,
  Upgrading,
  WorkFlag,
} from '../../../../components/index.js';
import { landscapeTopologyRevision } from '../../../../components/landscape.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type NodeArea, nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { towerFireRevision } from '../../../conflict/tower-reach.js';
import type { SystemContext } from '../../../context.js';
import { liveHaulFlag } from '../../../economy/work-flag.js';
import { roadRevision } from '../../../roads/index.js';
import { navigationLimitFor } from '../../../signposts/index.js';
import { goodsSearchLimitAt } from '../../../signposts/reach.js';
import { GOODS_SEARCH_SPAN, signpostMask } from '../../../signposts/terrain-reach.js';
import { GossipCandidates } from '../../../social/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { collectSupplyTally } from '../../../stores/index.js';
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
  /** The node of the porter's pickup flag, or null without one: moving the marker writes its position,
   *  which no generation tracks. */
  readonly flagNode: NodeId | null;
  /** The confinement toggle at the failed scan; its rules singleton is written in place with no generation
   *  bump, so the toggle is compared directly. */
  readonly confined: boolean;
  /** The porter's unlimited-walk-range bit, which lifts its confinement. */
  readonly unlimitedRange: boolean;
}

/** A failed scan with what its reach searches may have read: the nodes, or null for a scan no signpost
 *  reach bounds, and the walk-block mask version none of them flipped after. A flip among them may open
 *  or close a walk. */
interface DormantScan {
  readonly seen: DormantEntry;
  readonly searched: NodeArea | null;
  maskVersion: number;
}

/** Nodes a reach search reads past the box it marks: no search steps further than its budget. */
const SEARCH_READ_MARGIN = Math.max(GOODS_SEARCH_SPAN.budget, CARRIER_WALK_ROUTE_STEPS);

function anyNode(): boolean {
  return true;
}

/** The nodes the reach searches behind `plan`'s scan may read: the walk limit's box, which holds the goods
 *  search's, widened by {@link SEARCH_READ_MARGIN}. */
function searchedArea(plan: PlannerContext): NodeArea | null {
  const { world, ctx, terrain, here, owner } = plan;
  const gate =
    plan.limit ??
    goodsSearchLimitAt(world, ctx.content, terrain, owner, terrain.xOf(here), terrain.yOf(here));
  if (gate === null) return null;
  const { minX, maxX, minY, maxY } = gate.bounds;
  return {
    minHx: Math.max(0, minX - SEARCH_READ_MARGIN),
    maxHx: Math.min(terrain.width - 1, maxX + SEARCH_READ_MARGIN),
    minHy: Math.max(0, minY - SEARCH_READ_MARGIN),
    maxHy: Math.min(terrain.height - 1, maxY + SEARCH_READ_MARGIN),
  };
}

/** Whether no node the failed scan's searches may have read flipped on the walk-block mask since; a
 *  clean check moves the scan's version up, so the next one reads only the flips after it. */
function searchesHold(plan: PlannerContext, scan: DormantScan): boolean {
  if (scan.searched === null) return true;
  const mask = signpostMask(plan.world, plan.ctx.content, plan.terrain);
  const version = mask.version;
  if (version === scan.maskVersion) return true;
  if (mask.flippedSince(scan.searched, scan.maskVersion, anyNode)) return false;
  scan.maskVersion = version;
  return true;
}

interface PorterDormancy {
  readonly entries: Map<Entity, DormantScan>;
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
    world.componentValueGeneration(Upgrading) + // an upgrading workplace keeps its output in `savedStock`
    world.componentGeneration(Upgrading) +
    world.componentGeneration(UnderConstruction) +
    world.componentGeneration(GroundDrop) +
    world.componentGeneration(DeliveryFlag) +
    world.componentGeneration(WorkFlag) +
    world.componentGeneration(HaulFlag) +
    world.componentGeneration(JobAssignment) +
    world.componentGeneration(SiteAssignment) +
    world.componentGeneration(SupplyRun) +
    world.componentGeneration(PickupClaim) +
    world.componentGeneration(Signpost) +
    world.componentGeneration(StorageMinimums) +
    world.componentValueGeneration(StorageMinimums) +
    world.componentGeneration(StorePriority) +
    world.componentValueGeneration(StorePriority) +
    world.componentGeneration(StorageRules) + // the storage factor sizes every store's room
    world.componentValueGeneration(StorageRules) +
    world.componentGeneration(Owner) +
    landscapeTopologyRevision(world) +
    roadRevision(world) + // the goods search reach floods over road resistance
    towerFireRevision(world) // a pile under an enemy tower is passed over
  );
}

/** The entry the gate would store for `plan` right now (also the shape it compares against). */
function entryFor(plan: PlannerContext): DormantEntry {
  const { world, entity } = plan;
  const flag = liveHaulFlag(world, entity);
  return {
    version: porterScanVersion(world),
    node: plan.here,
    jobType: plan.jobType,
    tribe: plan.tribe,
    owner: plan.owner,
    workplace: world.get(entity, JobAssignment).workplace,
    flagNode: flag === undefined ? null : entityNode(world, plan.terrain, flag.flag),
    confined: signpostNavigationEnabled(world),
    unlimitedRange: hasMissionBehaviour(world, entity, MISSION_BEHAVIOUR.UNLIMITED_WALK_RANGE),
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
    a.flagNode === b.flagNode &&
    a.confined === b.confined &&
    a.unlimitedRange === b.unlimitedRange
  );
}

/** Whether `plan`'s porter scan is provably still null - true elides the scan for this tick. */
export function porterDormant(plan: PlannerContext): boolean {
  const memo = dormancyByWorld.get(plan.world)?.entries.get(plan.entity);
  return memo !== undefined && sameEntry(memo.seen, entryFor(plan)) && searchesHold(plan, memo);
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
  record.entries.set(plan.entity, {
    seen: entryFor(plan),
    searched: searchedArea(plan),
    maskVersion: signpostMask(plan.world, plan.ctx.content, plan.terrain).version,
  });
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
  let shared: { targets: PlannerContext['targets']; supply: PlannerContext['supply'] } | null = null;
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
      shared = { targets: collectTargets(world, ctx, terrain), supply: collectSupplyTally(world) };
    }
    const plan: PlannerContext = {
      world,
      ctx,
      terrain,
      entity,
      tribe: settler.tribe,
      jobType: settler.jobType,
      experience: world.get(entity, SettlerProgress).experience,
      owner: ownerOf(world, entity),
      here: terrain.nodeAtClamped(hereNode.hx, hereNode.hy),
      targets: shared.targets,
      supply: shared.supply,
      limit: navigationLimitFor(world, ctx.content, terrain, entity),
      gossipCandidates: new GossipCandidates(world, ctx.content),
    };
    // The gate would re-scan - nothing elided.
    if (!sameEntry(entry.seen, entryFor(plan)) || !searchesHold(plan, entry)) continue;
    if (porterPickupTarget(plan) !== null) {
      errors.push(
        `porter ${entity} is dormant but its pickup scan finds work - a scan input missed the version`,
      );
    }
  }
  return errors;
}
