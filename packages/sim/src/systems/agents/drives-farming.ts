import { Building, Crop, FarmTask, JobAssignment, Position, Stockpile } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { type FarmingSpec, farmWorkGood } from '../economy/farming.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { buildingEnabled, carrierCarryCapacity } from '../progression.js';
import { atomicDuration } from '../readviews/animations.js';
import { manhattan } from '../spatial.js';
import { buildingWorkerJobs, lowestStockedGood } from '../stores.js';
import { atOrWalk, startAtomic, startPickup } from './actions.js';
import { type TargetCandidates, interactionCell, jobAtomics, nearestStoreFor } from './ai-targets.js';

// The FARMER drive — the field-cultivation rung of the planner ladder: a worker bound to a FARM (a
// workplace producing a field-farmed good, `farmWorkGood`) walks its farm's surroundings sowing,
// watering and reaping wheat fields and carries each cut sheaf home. The field lifecycle itself
// (growth, the sow/water/reap effects) lives in ../economy/farming.ts; this module decides WHAT the
// farmer does next. Source basis: the actions and their animations are the original's own farmer
// vocabulary (atomics 34/35/29); the loop's ORDERING is engine-side and not decoded, so the priority
// below (reap > carry > sow > water > wait) is a named approximation of the observed original.

/** The settler-shape the drive reads (the planner's Worker view — jobType non-null by construction). */
interface Worker {
  readonly tribe: number;
  readonly jobType: number;
}

/**
 * The tick's FARM claims — which nodes farmers are already committed to working (reap / sheaf pickup /
 * sow / water), and how many sow-walks are in flight per farm (they reserve `maxFields` slots before
 * the field exists). Seeded each tick from every live {@link FarmTask} (farmers still WALKING to or
 * SWINGING at a target from an earlier tick — {@link collectFarmClaims}), then extended live as this
 * tick's farmers plan — so two farmers never shadow each other to the same field, the work-division
 * the "dwóch farmerów robi dokładnie to samo" report was about. A replanning settler's own stale task
 * is released first ({@link releaseFarmTask}), so it never blocks itself from re-choosing its target.
 * Membership tests and commutative counts only (no iteration picks a winner) — deterministic without
 * canonical ordering.
 */
export interface FarmClaims {
  readonly nodes: Set<NodeId>;
  readonly byFarm: Map<Entity, number>;
}

/** Seed the tick's {@link FarmClaims} from every live {@link FarmTask} — O(in-flight farm actions). */
export function collectFarmClaims(world: World): FarmClaims {
  const claims: FarmClaims = { nodes: new Set(), byFarm: new Map() };
  for (const e of world.query(FarmTask)) {
    const task = world.get(e, FarmTask);
    claims.nodes.add(task.node as NodeId);
    if (task.sow) claims.byFarm.set(task.farm, (claims.byFarm.get(task.farm) ?? 0) + 1);
  }
  return claims;
}

/** Release a replanning settler's stale {@link FarmTask} (if any) from the claim set and the world —
 *  the drive re-stamps a fresh one if it takes the settler again this tick. */
export function releaseFarmTask(world: World, e: Entity, claims: FarmClaims): void {
  const task = world.tryGet(e, FarmTask);
  if (task === undefined) return;
  claims.nodes.delete(task.node as NodeId);
  if (task.sow) {
    const count = (claims.byFarm.get(task.farm) ?? 0) - 1;
    if (count > 0) claims.byFarm.set(task.farm, count);
    else claims.byFarm.delete(task.farm);
  }
  world.remove(e, FarmTask);
}

/**
 * The FARM a bound settler should work as a field-farmer, with the farmed good's resolved spec — or
 * null when the settler isn't a field-farmer here (it then falls through to the producer/gatherer
 * rungs). The farm twin of `boundWorkplaceTarget`, differing in the workplace test: a producing
 * workplace carries a `recipe`, a FARM produces a `farming` good ({@link farmWorkGood}); the settler
 * must also be permitted the good's PLANT atomic (the data-driven "is the field trade" gate — the
 * farm's carrier slot shares the building but may not sow, so it falls through to the porter rung).
 */
function boundFarmTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): { farm: Entity; spec: FarmingSpec } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null; // unassigned — no farm to work
  const b = binding.workplace;
  const building = world.tryGet(b, Building);
  if (building === undefined || building.tribe !== tribe) return null; // gone / wrong tribe
  const spec = farmWorkGood(world, ctx, b);
  if (spec === null) return null; // not a farm
  if (!jobAtomics(ctx, jobType).has(spec.plantAtomic)) return null; // not the field trade (a carrier)
  if (!buildingWorkerJobs(world, ctx, b).has(jobType)) return null; // doesn't employ this job
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null; // not tech-enabled yet
  if (!world.has(b, Position)) return null; // a position-less farm has no fields to ring
  return { farm: b, spec };
}

/**
 * 2. FARMER — the field-cultivation loop for a settler bound to a FARM, in priority order (each step
 * targets the NEAREST candidate, Manhattan + ascending-cell-id tie-break over the canonical lists):
 *
 *  a. **Reap** a RIPE field of this farm (the scythe swing — the good's harvest atomic; the cut wheat
 *     drops as a ground sheaf where the field stood).
 *  b. **Carry a sheaf home** — pick up a cut-wheat {@link import('../../components/index.js').GroundDrop}
 *     lying within the farm's field radius (the delivery rung then routes the load into the farm's own
 *     store — the farm is the bound storage sink).
 *  c. **Water** a not-yet-watered field (the cultivate atomic) — watering is the GROWTH GATE (an
 *     unwatered field stands still), so the can comes before the next seed bag: the farmer plants a
 *     field, waters it, plants the next — the original's plant→cultivate work rhythm.
 *  d. **Sow** a new field while the farm holds fewer than its `maxFields` — walk to the next free node
 *     of the jittered field lattice around the farm and run the plant atomic.
 *  e. **Wait at the farm** — everything sown, watered and growing: hold at the farm's door.
 *
 * Always returns true once bound to a farm (a farmer is spoken for, like the flag-bound gatherer — it
 * never ferries other trades' goods); returns false only for a settler that isn't a field-farmer here.
 * Water-before-sow follows from the growth gate (a sown-but-dry field produces nothing, so tending
 * beats expanding); the original's engine-side ordering has no oracle.
 *
 * WORK DIVISION: every candidate scan skips nodes in `claims` (a colleague is en route — its live
 * {@link FarmTask}, or planned earlier this tick), and every issued action claims its node + stamps
 * this settler's own FarmTask — so N farmers spread over N different fields instead of walking in
 * lockstep to the same one, and field throughput scales with the crew.
 *
 * STORE-FULL PAUSE: reap + sheaf-carry only run while SOME store can still take the crop (the farm's
 * own wheat slot, or any warehouse — {@link nearestStoreFor}); with every sink full, ripe fields stand
 * and sheaves lie until space frees (a carrier hauling the farm's stock out, the player spending it),
 * then the loop resumes by itself. Sowing/watering continue meanwhile (bounded by `maxFields`), so a
 * paused farm keeps a ripe buffer ready — a named approximation, the original's full-store farmer
 * behavior has no readable oracle.
 */
export function planFarmer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  targets: TargetCandidates,
  claims: FarmClaims,
): boolean {
  const bound = boundFarmTarget(world, ctx, e, settler.jobType, settler.tribe);
  if (bound === null) return false;
  const { farm, spec } = bound;
  const fp = world.get(farm, Position);
  const fn = nodeOfPosition(fp.x, fp.y);
  const anchor = terrain.nodeAtClamped(fn.hx, fn.hy);

  /** Claim `node` for this settler's next action and record the in-flight intent (see FarmTask). */
  const take = (node: NodeId, sow: boolean): void => {
    claims.nodes.add(node);
    if (sow) claims.byFarm.set(farm, (claims.byFarm.get(farm) ?? 0) + 1);
    world.add(e, FarmTask, { farm, node, sow });
  };

  // One pass over this farm's fields: count them (the max-fields gate) and pick the nearest UNCLAIMED
  // ripe one (to reap) + unwatered growing one (to water). Canonical list + (dist, cell) tie-break.
  let fields = 0;
  let ripe: Entity | null = null;
  let ripeCell = 0 as NodeId;
  let ripeDist = Number.POSITIVE_INFINITY;
  let thirsty: Entity | null = null;
  let thirstyCell = 0 as NodeId;
  let thirstyDist = Number.POSITIVE_INFINITY;
  for (const c of targets.crops) {
    const crop = world.get(c, Crop);
    if (crop.farm !== farm) continue; // another farm's field — never worked from here
    fields++;
    const cell = interactionCell(world, ctx, terrain, c, here);
    if (claims.nodes.has(cell)) continue; // a colleague is already on this field
    const dist = manhattan(terrain, here, cell);
    if (crop.stage >= crop.stages) {
      if (dist < ripeDist || (dist === ripeDist && cell < ripeCell)) {
        ripe = c;
        ripeDist = dist;
        ripeCell = cell;
      }
    } else if (!crop.watered) {
      if (dist < thirstyDist || (dist === thirstyDist && cell < thirstyCell)) {
        thirsty = c;
        thirstyDist = dist;
        thirstyCell = cell;
      }
    }
  }

  // The store-full gate for the CROP-MOVING steps (reap/carry): some store can still take the good —
  // the farm's own slot, or any warehouse (then the delivery rung overflows the load there). Checked
  // lazily, only when a ripe field or sheaf actually exists this tick.
  const cropSinkExists = (): boolean =>
    nearestStoreFor(targets.stockpiles, world, ctx, terrain, here, spec.goodType) !== null;

  // a. Reap the nearest ripe field (the scythe swing; the yield drops as a sheaf where it stood).
  if (ripe !== null && cropSinkExists()) {
    const node = ripe;
    take(ripeCell, false);
    atOrWalk(world, e, here, ripeCell, () =>
      startAtomic(
        world,
        e,
        spec.harvestAtomic,
        { kind: 'harvest', resource: node, goodType: spec.goodType },
        atomicDuration(ctx.content, settler, spec.harvestAtomic),
        node,
      ),
    );
    return true;
  }

  // b. Carry a sheaf home — the delivery rung then routes the load into the farm's own store (or, with
  // the farm full, overflows it to the nearest warehouse that still has room).
  const sheaf = nearestFarmSheaf(world, ctx, terrain, targets, anchor, here, spec, claims);
  if (sheaf !== null && cropSinkExists()) {
    const cell = interactionCell(world, ctx, terrain, sheaf, here);
    take(cell, false);
    atOrWalk(world, e, here, cell, () =>
      startPickup(
        world,
        ctx,
        e,
        settler,
        sheaf,
        spec.goodType,
        carrierCarryCapacity(world, ctx, settler.tribe),
      ),
    );
    return true;
  }

  // c. Water the nearest unwatered field — the growth GATE: a dry field stands still, so the can
  // beats the next seed bag (the plant→water→plant rhythm).
  if (thirsty !== null) {
    const crop = thirsty;
    take(thirstyCell, false);
    atOrWalk(world, e, here, thirstyCell, () =>
      startAtomic(
        world,
        e,
        spec.cultivateAtomic,
        { kind: 'water', crop },
        atomicDuration(ctx.content, settler, spec.cultivateAtomic),
        crop,
      ),
    );
    return true;
  }

  // d. Sow the next field while the farm is under its max (in-flight sow-walks counted in).
  if (fields + (claims.byFarm.get(farm) ?? 0) < spec.farming.maxFields) {
    const node = nextSowNode(world, ctx, terrain, targets, anchor, spec, claims);
    if (node !== null) {
      take(node, true);
      const at = terrain.coordsOf(node);
      atOrWalk(world, e, here, node, () =>
        startAtomic(
          world,
          e,
          spec.plantAtomic,
          { kind: 'sow', farm, goodType: spec.goodType, x: at.x, y: at.y },
          atomicDuration(ctx.content, settler, spec.plantAtomic),
          farm,
        ),
      );
      return true;
    }
  }

  // e. Everything sown, watered and growing — wait at the farm's door for the fields to ripen.
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, farm, here), () => {});
  return true;
}

/**
 * The nearest cut-sheaf {@link import('../../components/index.js').GroundDrop} of the farmed good lying
 * within the farm's field radius (measured from the FARM's anchor — a farmer never chases a sheaf
 * across the map), by Manhattan distance from the farmer, ascending-cell-id tie-break, canonical scan.
 * The pile's good is its lowest-id stocked good (an emptied, about-to-reap pile is skipped); a sheaf a
 * colleague already claimed is skipped too. Returns the pile entity or null.
 */
function nearestFarmSheaf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  anchor: NodeId,
  here: NodeId,
  spec: FarmingSpec,
  claims: FarmClaims,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of targets.groundDrops) {
    if (lowestStockedGood(world.get(e, Stockpile)) !== spec.goodType) continue; // not this farm's crop
    const cell = interactionCell(world, ctx, terrain, e, here);
    if (claims.nodes.has(cell)) continue; // a colleague is already carrying this one off
    if (manhattan(terrain, anchor, cell) > spec.farming.fieldRadius) continue; // beyond the farm's fields
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/** Base sow-lattice pitch in half-cell nodes: one field per CELL before jitter, so fields sit about a
 *  tile apart — the original's packed-but-not-hex-stacked wheat spread (observed). */
const FIELD_LATTICE_STEP = 2;
/** 32-bit coordinate-mix constants for the per-field jitter hash (the golden-ratio / murmur3 mixers —
 *  any fixed odd constants serve; the hash only has to be deterministic and spatially uncorrelated). */
const JITTER_HASH_X = 0x9e3779b1;
const JITTER_HASH_Y = 0x85ebca6b;

/** The deterministic ±1-node jitter of one base lattice point — a pure coordinate hash (never
 *  `world.rng`: a field position must not consume the command-stream's RNG), so the same point always
 *  jitters the same way and the sowing pattern is byte-stable across runs and replays. */
function sowJitter(bx: number, by: number): { dx: number; dy: number } {
  const h = (Math.imul(bx, JITTER_HASH_X) ^ Math.imul(by, JITTER_HASH_Y)) >>> 0;
  return { dx: h & 1, dy: (h >>> 1) & 1 };
}

/**
 * The node the farm should sow NEXT: the free jittered-lattice node nearest the farm's anchor (fields
 * grow outward from the farm), or null when the whole radius is taken. The lattice is one base point
 * per {@link FIELD_LATTICE_STEP} nodes, each shifted by its own deterministic {@link sowJitter} — the
 * user-specified "minimally scattered, not hex-stacked" field spread. A candidate must be on the map,
 * walkable (the farmer stands ON the field to work it — wheat is walkable in the data), PLANTABLE
 * ground (the original's `biocanplanton` triangle flag — only grass/land carries it, so no field ever
 * lands on sand/desert/snow), clear of the walk-block overlays (building walls, standing resources),
 * not occupied by any resource/field/heap, and not claimed by another farmer's in-flight action.
 *
 * Cost: O(radius² / step²) candidates + an O(resources + stockpiles) occupancy index, only when a
 * farmer actually reaches its sow step — bounded by the farm's own radius, never the map.
 */
function nextSowNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  anchor: NodeId,
  spec: FarmingSpec,
  claims: FarmClaims,
): NodeId | null {
  const blocked = dynamicBlockedCells(world, ctx, terrain);
  const occupied = new Set<NodeId>();
  const occupy = (e: Entity): void => {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    occupied.add(terrain.nodeAtClamped(n.hx, n.hy));
  };
  for (const e of targets.resources) occupy(e); // standing nodes + every sown field
  for (const e of targets.stockpiles) occupy(e); // stores, loose heaps, dropped sheaves

  const at = terrain.coordsOf(anchor);
  const radius = spec.farming.fieldRadius;
  const first = (v: number): number => Math.floor((v - radius) / FIELD_LATTICE_STEP) * FIELD_LATTICE_STEP;
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let by = first(at.y); by <= at.y + radius; by += FIELD_LATTICE_STEP) {
    for (let bx = first(at.x); bx <= at.x + radius; bx += FIELD_LATTICE_STEP) {
      const j = sowJitter(bx, by);
      const hx = bx + j.dx;
      const hy = by + j.dy;
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      const dist = manhattan(terrain, anchor, node);
      if (dist > radius) continue; // outside the farm's field ring
      if (!terrain.isWalkable(node) || blocked.has(node)) continue; // water/walls/standing bodies
      if (!terrain.isPlantable(node)) continue; // barren ground (sand/desert/snow) — grain needs grass
      if (occupied.has(node) || claims.nodes.has(node)) continue; // taken, or claimed by a colleague
      if (dist < bestDist || (dist === bestDist && (best === null || node < best))) {
        best = node;
        bestDist = dist;
      }
    }
  }
  return best;
}
