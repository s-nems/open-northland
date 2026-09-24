import type { ContentSet } from '@open-northland/data';
import { Building, Health, isValidPlayer, Owner, Position } from '../../components/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import { isLowPriorityBuildingTarget } from '../readviews/index.js';
import { buildingBodyNodes } from './target-node.js';

/** Coarse cell edge (half-cell nodes). A sight- or defend-radius query (≤ ~20 nodes) spans three or four
 *  cells per axis, a box about 2.5× the diamond it scans for; a coarser cell scans more members outside the
 *  band, a finer one walks more cells. Only query cost depends on it, never a winner. */
const COARSE_CELL_NODES = 16;

/** The first capacity of a band scan's key buffer; it doubles whenever a band outgrows it. */
const BAND_SCAN_INITIAL_KEYS = 64;

/** The stores whose membership decides the building layer: a building is indexed while it holds a Position
 *  and a Health pool, at the presence bit of its Owner. */
const LAYER_STORES: readonly Component<unknown>[] = [Building, Health, Position, Owner];

/** A player's slot bit, or 0 for a player outside the slots. */
export function playerBit(player: number): number {
  return isValidPlayer(player) ? 1 << player : 0;
}

/** An unowned animal's presence class, or null for anything owned or non-animal. */
export type WildClass = 'passive' | 'hostile' | null;

/**
 * One coarse cell: its early-out tallies and its members with the node each was admitted at. Counts are per
 * member, not per node - both queries reduce to "does a member of some class exist here?", which no
 * weighting can change. The member arrays keep their longest length and {@link count} is the live one, so a
 * build's reset allocates nothing.
 */
export interface CoarseCell {
  count: number;
  total: number;
  passive: number;
  hostileAnimal: number;
  /** Members no diplomacy can discount: unowned ones other than passive wildlife, and any owned outside the
   *  player slots. */
  undiscounted: number;
  /** The {@link playerBit}s of the players owning a member here. */
  ownerMask: number;
  readonly members: Entity[];
  readonly memberX: number[];
  readonly memberY: number[];
  /** The member's owner as a {@link playerBit}, 0 when unowned. */
  readonly memberBit: number[];
  /** The last member tallied, so a building's several nodes in one cell count once. */
  countedLast: Entity | null;
  /** The building layer's share, which each build's reset restores. A building is never wildlife, so the
   *  animal tallies restore to zero. */
  baseCount: number;
  baseTotal: number;
  baseUndiscounted: number;
  baseOwnerMask: number;
  /** Whether this build's units appended here, so the next reset visits only such cells. */
  unitsAdmitted: boolean;
}

/** One nesting depth's sorted candidate keys and the band they answer, reused by the next query at that
 *  depth that asks the same band. */
export interface BandScan {
  valid: boolean;
  x: number;
  y: number;
  minDist: number;
  maxDist: number;
  seeker: number | null;
  count: number;
  keys: Float64Array;
}

/** A building as the layer admitted it, for the staleness checks and the verifier. */
interface HeldBuilding {
  readonly type: number;
  readonly bit: number;
  readonly nodes: readonly NodeId[];
}

const grids = new WeakMap<World, CombatGrid>();

/**
 * The per-world cell grid under the combat tick's target index. Buildings form a layer held across ticks,
 * rebuilt only when a building is placed, removed, retyped, re-owned or gains or loses its Position or Health
 * pool; units are appended each tick on top of it. A building's hitpoints are not a key: one felled this tick
 * stays in the layer until cleanup removes it, which only over-counts the presence tallies, and every target
 * filter already rejects a dead target. The cells hold owner bits only, never a stance, so a diplomacy change
 * needs no rebuild. Derived state, never hashed; the registered verifier re-derives the layer.
 */
export function combatGridOf(world: World, ctx: SystemContext, terrain: TerrainGraph): CombatGrid {
  const held = grids.get(world);
  if (held !== undefined && held.terrain === terrain && held.content === ctx.content) return held;
  const grid = new CombatGrid(terrain, ctx.content);
  grids.set(world, grid);
  for (const store of LAYER_STORES) world.journalMembership(store);
  world.registerCacheVerifier('combatBuildingLayer', () => grids.get(world)?.verify(world) ?? []);
  return grid;
}

export class CombatGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: (CoarseCell | undefined)[];
  private readonly unitCells: CoarseCell[] = [];
  private readonly buildings = new Map<Entity, HeldBuilding>();
  /** Members on the deprioritized siege tier, classified by type when the layer is built. */
  private readonly lowPriority = new Set<Entity>();
  /** The {@link LAYER_STORES} membership generations the layer is known current at; null before the first
   *  build. */
  private generations: number[] | null = null;
  private buildingValueGeneration = 0;
  private ownerValueGeneration = 0;
  private readonly bandScans: BandScan[] = [];

  constructor(
    readonly terrain: TerrainGraph,
    readonly content: ContentSet,
  ) {
    this.cols = Math.ceil(terrain.width / COARSE_CELL_NODES);
    this.rows = Math.ceil(terrain.height / COARSE_CELL_NODES);
    this.cells = new Array<CoarseCell | undefined>(this.cols * this.rows).fill(undefined);
  }

  /** Bring the building layer up to date and drop the previous build's units, leaving the grid ready for
   *  this build's unit admissions. */
  startBuild(world: World, ctx: SystemContext): void {
    for (const scan of this.bandScans) scan.valid = false;
    if (!this.buildingsCurrent(world)) {
      this.rebuildBuildings(world, ctx);
      return;
    }
    for (const cell of this.unitCells) {
      cell.count = cell.baseCount;
      cell.total = cell.baseTotal;
      cell.passive = 0;
      cell.hostileAnimal = 0;
      cell.undiscounted = cell.baseUndiscounted;
      cell.ownerMask = cell.baseOwnerMask;
      cell.countedLast = null;
      cell.unitsAdmitted = false;
    }
    this.unitCells.length = 0;
  }

  /** Append a unit at node (x, y) for this build. */
  admitUnit(e: Entity, x: number, y: number, bit: number, wild: WildClass): void {
    const cell = this.cellFor(x, y);
    if (!cell.unitsAdmitted) {
      cell.unitsAdmitted = true;
      this.unitCells.push(cell);
    }
    admit(cell, e, x, y, bit, wild);
  }

  /** Whether `e` is a plain building - the siege tier a warrior turns on only when nothing better is in
   *  sight. */
  isLowPriorityBuilding(e: Entity): boolean {
    return this.lowPriority.has(e);
  }

  /** The cell at coarse (cx, cy), or undefined for an empty or off-map one. */
  cellAt(cx: number, cy: number): CoarseCell | undefined {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return undefined;
    return this.cells[cy * this.cols + cx];
  }

  /** The band scan scratch for nesting depth `depth`. */
  bandScanAt(depth: number): BandScan {
    let scan = this.bandScans[depth];
    if (scan === undefined) {
      scan = {
        valid: false,
        x: 0,
        y: 0,
        minDist: 0,
        maxDist: 0,
        seeker: null,
        count: 0,
        keys: new Float64Array(BAND_SCAN_INITIAL_KEYS),
      };
      this.bandScans[depth] = scan;
    }
    return scan;
  }

  /** Whether the layer still holds for `world`, advancing the held generations past the changes that
   *  touched no building so the next check replays only newer ones. */
  private buildingsCurrent(world: World): boolean {
    if (this.buildingsChanged(world)) return false;
    this.generations = LAYER_STORES.map((store) => world.componentGeneration(store));
    this.buildingValueGeneration = world.componentValueGeneration(Building);
    return true;
  }

  /** Whether a building joined, left, changed type or owner, or gained or lost a layer store since the last
   *  build. Pure, so the verifier asks it too. */
  private buildingsChanged(world: World): boolean {
    const generations = this.generations;
    if (generations === null) return true;
    for (let i = 0; i < LAYER_STORES.length; i++) {
      const store = LAYER_STORES[i];
      const since = generations[i];
      if (store === undefined || since === undefined) return true;
      if (world.componentGeneration(store) === since) continue;
      const changed = world.membershipDeltasSince(store, since);
      if (changed === null) return true;
      for (const e of changed) if (this.buildings.has(e) || isLayerMember(world, e)) return true;
    }
    // No system writes an Owner in place today; one that does rebuilds rather than going unseen.
    if (world.componentValueGeneration(Owner) !== this.ownerValueGeneration) return true;
    // A Building value write is mostly construction progress; only a type swap moves a body.
    if (world.componentValueGeneration(Building) !== this.buildingValueGeneration) {
      for (const [e, held] of this.buildings) {
        if (world.tryGet(e, Building)?.buildingType !== held.type) return true;
      }
    }
    return false;
  }

  private rebuildBuildings(world: World, ctx: SystemContext): void {
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.count = 0;
      cell.total = 0;
      cell.passive = 0;
      cell.hostileAnimal = 0;
      cell.undiscounted = 0;
      cell.ownerMask = 0;
      cell.countedLast = null;
      cell.unitsAdmitted = false;
    }
    this.unitCells.length = 0;
    this.buildings.clear();
    this.lowPriority.clear();
    for (const b of world.query(Building, Health, Position)) {
      const held = heldBuilding(world, ctx, this.terrain, b);
      for (const node of held.nodes) {
        const x = this.terrain.xOf(node);
        const y = this.terrain.yOf(node);
        admit(this.cellFor(x, y), b, x, y, held.bit, null);
      }
      this.buildings.set(b, held);
      if (isLowPriorityBuildingTarget(world, ctx, b)) this.lowPriority.add(b);
    }
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.baseCount = cell.count;
      cell.baseTotal = cell.total;
      cell.baseUndiscounted = cell.undiscounted;
      cell.baseOwnerMask = cell.ownerMask;
      cell.countedLast = null;
    }
    this.generations = LAYER_STORES.map((store) => world.componentGeneration(store));
    this.buildingValueGeneration = world.componentValueGeneration(Building);
    this.ownerValueGeneration = world.componentValueGeneration(Owner);
  }

  /** The `verifyCaches` tripwire: a layer no journaled change calls stale must match a fresh derivation. */
  verify(world: World): string[] {
    // A seen change rebuilds at the next build, before any query reads the layer.
    if (this.buildingsChanged(world)) return [];
    const ctx = { content: this.content, terrain: this.terrain };
    let live = 0;
    for (const b of world.query(Building, Health, Position)) {
      live++;
      const held = this.buildings.get(b);
      const fresh = heldBuilding(world, ctx, this.terrain, b);
      if (
        held === undefined ||
        held.type !== fresh.type ||
        held.bit !== fresh.bit ||
        held.nodes.length !== fresh.nodes.length ||
        fresh.nodes.some((n, i) => held.nodes[i] !== n)
      ) {
        return [
          `combatBuildingLayer holds a stale entry for building ${b} - it changed without a generation bump`,
        ];
      }
    }
    if (live !== this.buildings.size) {
      return [`combatBuildingLayer holds ${this.buildings.size} buildings but re-derived ${live}`];
    }
    return [];
  }

  private cellFor(x: number, y: number): CoarseCell {
    const i = coarseOf(y) * this.cols + coarseOf(x);
    let cell = this.cells[i];
    if (cell === undefined) {
      cell = {
        count: 0,
        total: 0,
        passive: 0,
        hostileAnimal: 0,
        undiscounted: 0,
        ownerMask: 0,
        members: [],
        memberX: [],
        memberY: [],
        memberBit: [],
        countedLast: null,
        baseCount: 0,
        baseTotal: 0,
        baseUndiscounted: 0,
        baseOwnerMask: 0,
        unitsAdmitted: false,
      };
      this.cells[i] = cell;
    }
    return cell;
  }
}

/** Whether `e` belongs in the building layer: a building with a Position and a Health pool. */
function isLayerMember(world: World, e: Entity): boolean {
  return world.has(e, Building) && world.has(e, Health) && world.has(e, Position);
}

function heldBuilding(world: World, ctx: MapContext, terrain: TerrainGraph, b: Entity): HeldBuilding {
  const owner = world.tryGet(b, Owner);
  return {
    type: world.get(b, Building).buildingType,
    bit: owner === undefined ? 0 : playerBit(owner.player),
    nodes: buildingBodyNodes(world, ctx, terrain, b),
  };
}

/** Tally `e` into `cell` and hold its node for the cell's member scan. */
function admit(cell: CoarseCell, e: Entity, x: number, y: number, bit: number, wild: WildClass): void {
  const i = cell.count++;
  cell.members[i] = e;
  cell.memberX[i] = x;
  cell.memberY[i] = y;
  cell.memberBit[i] = bit;
  if (cell.countedLast === e) return;
  cell.countedLast = e;
  cell.total++;
  if (wild === 'passive') cell.passive++;
  else if (wild === 'hostile') cell.hostileAnimal++;
  if (bit !== 0) cell.ownerMask |= bit;
  else if (wild !== 'passive') cell.undiscounted++;
}

export function coarseOf(node: number): number {
  return Math.floor(node / COARSE_CELL_NODES);
}
