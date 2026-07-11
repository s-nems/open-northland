import { Building, Crop, JobAssignment, Position, Stockpile } from '../../components/index.js';
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
import { type TargetCandidates, interactionCell, jobAtomics } from './ai-targets.js';

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
 * The per-tick SOW claims — which nodes (and how many fields per farm) this tick's earlier-planned
 * farmers already committed to sowing, so two farmers planned in the same tick never pick the same
 * node or overshoot the farm's `maxFields` together. Built fresh each tick by the atomic planner
 * (like the idle-spacing claim set). Cross-TICK races (a farmer still walking to its sow node when
 * another plans) are left to the sow effect's completion-time occupancy check — the second swing
 * plants nothing (the raced-target no-op), which is rare and self-corrects next plan.
 */
export interface SowClaims {
  readonly nodes: Set<NodeId>;
  readonly byFarm: Map<Entity, number>;
}

/** A fresh, empty per-tick claim set. */
export function emptySowClaims(): SowClaims {
  return { nodes: new Set(), byFarm: new Map() };
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
 *  c. **Sow** a new field while the farm holds fewer than its `maxFields` — walk to the next free node
 *     of the jittered field lattice around the farm and run the plant atomic.
 *  d. **Water** a growing, not-yet-watered field (the cultivate atomic — it then grows at double pace).
 *  e. **Wait at the farm** — everything sown, watered and growing: hold at the farm's door.
 *
 * Always returns true once bound to a farm (a farmer is spoken for, like the flag-bound gatherer — it
 * never ferries other trades' goods); returns false only for a settler that isn't a field-farmer here.
 * Sow-before-water is a named approximation (fill the field roster first, then speed it up); the
 * original's engine-side ordering has no oracle.
 */
export function planFarmer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  targets: TargetCandidates,
  claims: SowClaims,
): boolean {
  const bound = boundFarmTarget(world, ctx, e, settler.jobType, settler.tribe);
  if (bound === null) return false;
  const { farm, spec } = bound;
  const fp = world.get(farm, Position);
  const fn = nodeOfPosition(fp.x, fp.y);
  const anchor = terrain.nodeAtClamped(fn.hx, fn.hy);

  // One pass over this farm's fields: count them (the max-fields gate) and pick the nearest ripe one
  // (to reap) + the nearest unwatered growing one (to water). Canonical list + (dist, cell) tie-break.
  let fields = 0;
  let ripe: Entity | null = null;
  let ripeDist = Number.POSITIVE_INFINITY;
  let ripeCell = Number.POSITIVE_INFINITY;
  let thirsty: Entity | null = null;
  let thirstyDist = Number.POSITIVE_INFINITY;
  let thirstyCell = Number.POSITIVE_INFINITY;
  for (const c of targets.crops) {
    const crop = world.get(c, Crop);
    if (crop.farm !== farm) continue; // another farm's field — never worked from here
    fields++;
    const cell = interactionCell(world, ctx, terrain, c, here);
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

  // a. Reap the nearest ripe field (the scythe swing; the yield drops as a sheaf where it stood).
  if (ripe !== null) {
    const node = ripe;
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, node, here), () =>
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

  // b. Carry a cut sheaf home — the delivery rung then routes the load into the farm's own store.
  const sheaf = nearestFarmSheaf(world, ctx, terrain, targets, anchor, here, spec);
  if (sheaf !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, sheaf, here), () =>
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

  // c. Sow the next field while the farm is under its max (this tick's earlier claims counted in).
  if (fields + (claims.byFarm.get(farm) ?? 0) < spec.farming.maxFields) {
    const node = nextSowNode(world, ctx, terrain, targets, anchor, spec, claims);
    if (node !== null) {
      claims.nodes.add(node);
      claims.byFarm.set(farm, (claims.byFarm.get(farm) ?? 0) + 1);
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

  // d. Water the nearest unwatered growing field (it grows at double pace afterwards).
  if (thirsty !== null) {
    const crop = thirsty;
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, crop, here), () =>
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

  // e. Everything sown, watered and growing — wait at the farm's door for the fields to ripen.
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, farm, here), () => {});
  return true;
}

/**
 * The nearest cut-sheaf {@link import('../../components/index.js').GroundDrop} of the farmed good lying
 * within the farm's field radius (measured from the FARM's anchor — a farmer never chases a sheaf
 * across the map), by Manhattan distance from the farmer, ascending-cell-id tie-break, canonical scan.
 * The pile's good is its lowest-id stocked good (an emptied, about-to-reap pile is skipped). Returns
 * the pile entity or null.
 */
function nearestFarmSheaf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  anchor: NodeId,
  here: NodeId,
  spec: FarmingSpec,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of targets.groundDrops) {
    if (lowestStockedGood(world.get(e, Stockpile)) !== spec.goodType) continue; // not this farm's crop
    const cell = interactionCell(world, ctx, terrain, e, here);
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
 * walkable (the farmer stands ON the field to work it — wheat is walkable in the data), clear of the
 * walk-block overlays (building walls, standing resources), not occupied by any resource/field/heap,
 * and not already claimed by a farmer planned earlier this tick.
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
  claims: SowClaims,
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
      if (occupied.has(node) || claims.nodes.has(node)) continue; // taken, or claimed this tick
      if (dist < bestDist || (dist === bestDist && (best === null || node < best))) {
        best = node;
        bestDist = dist;
      }
    }
  }
  return best;
}
