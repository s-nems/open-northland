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
  WorkFlag,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { collectInboundSupply } from '../../stores/index.js';
import type { PlannerContext } from '../planner-context.js';
import { collectTargets } from '../targets/index.js';
import { porterPickupTarget } from './haul-targets.js';

/**
 * Dormancy for the porter rung: a porter whose pickup scan came up empty skips the re-scan until
 * something the scan reads could have changed. The elided scan is provably null — the gate compares
 * every input the scan depends on (via the version below plus the per-settler fields), so behavior is
 * byte-identical to always re-scanning; only the provably-empty work is skipped (the AGENTS.md
 * scaling contract). Without it, every confined idle porter re-walks the pile list and the store
 * sinks per tick — measured 84% of the sandbox settlement's late-run tick cost.
 */

/** What a dormant porter's failed scan saw — re-scan only when some field differs. */
interface DormantEntry {
  /** {@link porterScanVersion} at the failed scan. */
  readonly version: number;
  /** The porter's node — the scan's confinement circle recentres on it, so a displaced porter re-scans. */
  readonly node: NodeId;
  readonly jobType: number;
  readonly tribe: number;
  readonly owner: number | undefined;
  readonly workplace: Entity;
  /** {@link signpostNavigationEnabled} at the failed scan — the rules singleton is written in place
   *  (no generation bump), so the toggle is compared directly. */
  readonly confined: boolean;
}

interface PorterDormancy {
  readonly entries: Map<Entity, DormantEntry>;
  /** The latest planner deps, refreshed on every mark, read only by the coherence verifier. `ctx` is
   *  rebuilt each tick, so the stored one may be stale by the time the verifier runs — safe only
   *  because the pickup-scan path consults `ctx`'s stable content/terrain reads and never `ctx.tick`
   *  or the RNG (a future such read would silently verify a different question). */
  ctx: SystemContext;
  terrain: TerrainGraph;
}

const dormancyByWorld = new WeakMap<World, PorterDormancy>();

/**
 * Combined generation of every store the porter pickup scan reads: stock contents (the Stockpile value
 * channel) and the membership of piles/stores/sites/flags/bindings/errands/signposts the scan or its
 * delivery-routing probe walks. Generations only grow, so the sum is strictly monotonic — any tracked
 * change moves it. The settler-local inputs (its node, job, tribe, owner, binding, the confinement
 * toggle) are compared per entry instead.
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
    world.componentGeneration(Owner)
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

/** Whether `plan`'s porter scan is provably still null — true elides the scan for this tick. */
export function porterDormant(plan: PlannerContext): boolean {
  const memo = dormancyByWorld.get(plan.world)?.entries.get(plan.entity);
  return memo !== undefined && sameEntry(memo, entryFor(plan));
}

/** Record a failed porter scan so the identical re-scan is skipped until an input changes. */
export function markPorterDormant(plan: PlannerContext): void {
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

/** The `cachesCoherent` re-derivation: every entry the gate would still honour must describe a scan
 *  that really does still return null — a live porter with a non-null pick behind a matching entry
 *  means a scan input changed without moving {@link porterScanVersion}. */
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
      // A dead/unbound porter's entry is never consulted again (ids are never reused) — prune it here
      // so the memo doesn't grow with every porter that died dormant. Cache-internal; no sim decision
      // can observe the deletion, so invariant-checked and unchecked runs stay byte-identical.
      record.entries.delete(entity);
      continue;
    }
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
      limit: navigationLimitFor(world, terrain, entity),
    };
    if (!sameEntry(entry, entryFor(plan))) continue; // the gate would re-scan — nothing elided
    if (porterPickupTarget(plan) !== null) {
      errors.push(
        `porter ${entity} is dormant but its pickup scan finds work — a scan input missed the version`,
      );
    }
  }
  return errors;
}
