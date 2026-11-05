import { footprintCellDx } from '@open-northland/data';
import { Building, Palisade, Position, RoadSite } from '../../../components/index.js';
import type { Fixed } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { type NodeArea, nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import { hasOpenSide } from '../../../nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { houseFootprintOf } from '../../footprint/geometry.js';
import { constructionWorkCells } from '../../footprint/index.js';
import { type WalkBlockMask, walkBlockMask } from '../../footprint/walk-block-mask.js';

/** A site's perimeter stand cells over `blocked` that keep an open side, so no builder is parked in a
 *  nook; every perimeter cell when all are wedged, so such a site still gets built. */
export function openWorkCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  site: Entity,
): readonly NodeId[] {
  const perimeter = constructionWorkCells(world, ctx, terrain, site, blocked);
  const open = perimeter.filter((cell) => hasOpenSide(terrain, cell, blocked));
  return open.length > 0 ? open : perimeter;
}

/** Nodes past a building's body its {@link openWorkCells} read: the one-node box margin the exterior
 *  flood scans, and a lattice step beyond it for each cell's open-side test, rounded up. */
const WORK_CELL_READ_MARGIN = 3;

/** Entries held before the first sweep of the buildings that are gone; doubled after each sweep. */
const FIRST_SWEEP_AT = 64;

const ANY_FLIP = (): boolean => true;

/** A building's open work cells and the inputs they were derived from. */
interface HeldCells {
  readonly cells: readonly NodeId[];
  readonly x: Fixed;
  readonly y: Fixed;
  readonly buildingType: number;
  readonly tribe: number;
  readonly record: string | undefined;
  readonly area: NodeArea;
  /** A walk-block mask version through which no walkable node of {@link area} flipped. */
  maskVersion: number;
}

/**
 * {@link openWorkCells} of the buildings that are neither a wall nor a road site, kept across planner
 * passes per walk-block mask. They are a function of the building's anchor and footprint, the static
 * terrain and the mask around the body, so an entry is served while the anchor, type, tribe and record
 * are unchanged and no walkable node of its area flipped since it was derived.
 */
export class HeldWorkCells {
  private readonly entries = new Map<Entity, HeldCells>();
  private sweepAt = FIRST_SWEEP_AT;

  private constructor(
    private readonly world: World,
    /** The context of the tick that last asked, refreshed like the mask's, never an older tick's. */
    private ctx: SystemContext,
    readonly mask: WalkBlockMask,
  ) {}

  /** The world's held cells over its walk-block mask on `terrain`. */
  static of(world: World, ctx: SystemContext, terrain: TerrainGraph): HeldWorkCells {
    const mask = walkBlockMask(world, ctx, terrain);
    let held = heldByMask.get(mask);
    if (held === undefined) {
      const created = new HeldWorkCells(world, ctx, mask);
      world.registerCacheVerifier('plannerWorkCells', () => created.verify());
      heldByMask.set(mask, created);
      held = created;
    }
    held.ctx = ctx;
    return held;
  }

  /** `site`'s {@link openWorkCells} over the mask, or undefined for a site this does not hold: a wall or
   *  road site, whose cells read more than its own body. */
  cellsOf(site: Entity): readonly NodeId[] | undefined {
    const { world } = this;
    const building = world.tryGet(site, Building);
    const p = world.tryGet(site, Position);
    if (building === undefined || p === undefined || world.has(site, Palisade) || world.has(site, RoadSite)) {
      return undefined;
    }
    const held = this.entries.get(site);
    if (held !== undefined && this.serves(held, building, p)) return held.cells;
    const maskVersion = this.mask.version;
    const cells = openWorkCells(world, this.ctx, this.mask.terrain, this.mask, site);
    if (held === undefined && this.entries.size >= this.sweepAt) this.sweep();
    this.entries.set(site, {
      cells,
      x: p.x,
      y: p.y,
      buildingType: building.buildingType,
      tribe: building.tribe,
      record: building.record,
      area: this.readArea(building, p.x, p.y),
      maskVersion,
    });
    return cells;
  }

  /** Whether `held` still answers for a building of `building` at `p`, moving its mask clock forward. */
  private serves(
    held: HeldCells,
    building: { buildingType: number; tribe: number; record?: string | undefined },
    p: { x: Fixed; y: Fixed },
  ): boolean {
    if (
      held.x !== p.x ||
      held.y !== p.y ||
      held.buildingType !== building.buildingType ||
      held.tribe !== building.tribe ||
      held.record !== building.record
    ) {
      return false;
    }
    const version = this.mask.version;
    if (held.maskVersion === version) return true;
    if (this.mask.flippedSince(held.area, held.maskVersion, ANY_FLIP)) return false;
    held.maskVersion = version;
    return true;
  }

  /** The body's box, the anchor included, grown by {@link WORK_CELL_READ_MARGIN}. */
  private readArea(
    building: { buildingType: number; tribe: number; record?: string | undefined },
    x: Fixed,
    y: Fixed,
  ): NodeArea {
    const ax = nodeHxOfPosition(x, y);
    const ay = nodeHyOfPosition(x, y);
    let minHx = ax;
    let maxHx = ax;
    let minHy = ay;
    let maxHy = ay;
    for (const c of houseFootprintOf(this.ctx.content, building)?.blocked ?? []) {
      const cx = ax + footprintCellDx(ay, c);
      const cy = ay + c.dy;
      minHx = Math.min(minHx, cx);
      maxHx = Math.max(maxHx, cx);
      minHy = Math.min(minHy, cy);
      maxHy = Math.max(maxHy, cy);
    }
    return {
      minHx: minHx - WORK_CELL_READ_MARGIN,
      minHy: minHy - WORK_CELL_READ_MARGIN,
      maxHx: maxHx + WORK_CELL_READ_MARGIN,
      maxHy: maxHy + WORK_CELL_READ_MARGIN,
    };
  }

  private sweep(): void {
    for (const site of this.entries.keys()) if (!this.world.isAlive(site)) this.entries.delete(site);
    this.sweepAt = Math.max(FIRST_SWEEP_AT, 2 * this.entries.size);
  }

  /** Every entry that would be served now matches a fresh derivation. */
  private verify(): string[] {
    const { world } = this;
    for (const [site, held] of this.entries) {
      const building = world.tryGet(site, Building);
      const p = world.tryGet(site, Position);
      if (building === undefined || p === undefined || !this.serves(held, building, p)) continue;
      const fresh = openWorkCells(world, this.ctx, this.mask.terrain, this.mask, site);
      if (fresh.length !== held.cells.length || fresh.some((cell, i) => held.cells[i] !== cell)) {
        return [`plannerWorkCells holds stale cells for building ${site}`];
      }
    }
    return [];
  }
}

const heldByMask = new WeakMap<WalkBlockMask, HeldWorkCells>();
