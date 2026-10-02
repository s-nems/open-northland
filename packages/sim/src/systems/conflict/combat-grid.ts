import type { ContentSet } from '@open-northland/data';
import {
  Anger,
  Building,
  Health,
  isValidPlayer,
  MAX_PLAYERS,
  Owner,
  Position,
  Settler,
} from '../../components/index.js';
import type { ChangeFeed, Component, Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import {
  isAggressiveAnimal,
  isAnimalTribe,
  isHuntablePrey,
  isLastResortPrey,
  isLowPriorityBuildingTarget,
} from '../readviews/index.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { entityNode } from '../spatial/nodes.js';
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

/** The stores whose membership or value re-classes a unit in the unit layer: a unit is indexed while it
 *  holds a Settler, a Health pool and a Position, and its Owner, tribe and Anger decide its tallies. The
 *  tribe never changes, and an Anger that lapses without a write is re-read every build. A Position write
 *  only moves a unit, so it has its own feed. */
const UNIT_MEMBERSHIP: readonly Component<unknown>[] = [Settler, Health, Position, Owner, Anger];
const UNIT_VALUES: readonly Component<unknown>[] = [Owner];

/** A player's slot bit, or 0 for a player outside the slots. */
export function playerBit(player: number): number {
  return isValidPlayer(player) ? 1 << player : 0;
}

/** The player slot a nonzero {@link playerBit} names. */
export function playerOfBit(bit: number): number {
  return 31 - Math.clz32(bit);
}

/** An unowned animal's presence class, or null for anything owned or non-animal. */
export type WildClass = 'passive' | 'hostile' | null;

/** A cell's members with the node each was admitted at. The arrays keep their longest length and
 *  {@link count} is the live one, so a reset allocates nothing. */
export interface MemberList {
  count: number;
  readonly members: Entity[];
  readonly x: number[];
  readonly y: number[];
  /** The member's owner as a {@link playerBit}, 0 when unowned. */
  readonly bit: number[];
}

/**
 * One coarse cell: its early-out tallies and its members. Counts are per member, not per node - every
 * query reduces to "does a member of some class exist here?", which no weighting can change. The tallies
 * the queries read are the sum of three layers, re-derived by {@link refresh}: the held buildings, the kept
 * units, and this build's vehicles and firing buildings.
 */
export interface CoarseCell {
  readonly index: number;
  total: number;
  passive: number;
  hostileAnimal: number;
  /** Unowned members of a huntable tribe that is not last-resort prey: a hunter's primary tier. */
  game: number;
  /** Members no diplomacy can discount: unowned ones other than passive wildlife, and any owned outside the
   *  player slots. */
  undiscounted: number;
  /** The {@link playerBit}s of the players owning a member here. */
  ownerMask: number;
  /** What a fleer might run from this build: the {@link playerBit}s owning a unit or a building able to fire
   *  here, and how many such members no diplomacy can discount. A plain building adds to neither. */
  threatMask: number;
  threatUndiscounted: number;
  /** The held buildings at each of their nodes, then this build's vehicles past {@link bodyBase}. */
  readonly bodies: MemberList;
  /** The kept units, one node each. */
  readonly units: MemberList;
  /** The building layer's share. A building is never wildlife. */
  bodyBase: number;
  baseTotal: number;
  baseUndiscounted: number;
  baseOwnerMask: number;
  /** The unit layer's share; a unit threatens where it stands, so its threat share is its owner share. */
  unitPassive: number;
  unitHostileAnimal: number;
  unitGame: number;
  unitUndiscounted: number;
  /** Per player slot, the units it owns here, which keep {@link unitOwnerMask} exact as units leave. */
  readonly unitOwners: number[];
  unitOwnerMask: number;
  /** This build's share: the vehicles, and the buildings able to fire. */
  buildTotal: number;
  buildUndiscounted: number;
  buildOwnerMask: number;
  buildThreatMask: number;
  buildThreatUndiscounted: number;
  /** The last body tallied, so a building's or vehicle's several nodes in one cell count once. */
  countedLast: Entity | null;
  /** Whether this build admitted a vehicle or a firing building here, so the next reset visits only such
   *  cells. */
  builtOn: boolean;
  /** Over the cells within the stranger reach of this one: the owner bits, and whether any holds an
   *  undiscounted member. Current unless {@link nearDirty}. */
  nearMask: number;
  nearUndiscounted: boolean;
  nearDirty: boolean;
}

/** How a combat search measures its band: Manhattan half-cell nodes, which work areas count in, or the
 *  original's map points ({@link hexDistanceBetween}), which weapon reach, search radii and leashes count
 *  in. A map-point disc of radius `r` lies inside the square box of radius `r`, as a Manhattan diamond
 *  does. */
export type SearchMetric = 'manhattan' | 'hex';

/** One nesting depth's sorted candidate keys and the band they answer, reused by the next query at that
 *  depth that asks the same band. */
export interface BandScan {
  valid: boolean;
  x: number;
  y: number;
  minDist: number;
  maxDist: number;
  metric: SearchMetric;
  seeker: number | null;
  count: number;
  keys: Float64Array;
  /** {@link metEpoch} on each member the running query over this scan has met, indexed by entity id and
   *  grown on demand, so a member recurring at a further node is skipped without a per-query set. */
  met: Uint32Array;
  metEpoch: number;
}

/** A building as the layer admitted it, for the staleness checks and the verifier. */
interface HeldBuilding {
  readonly type: number;
  readonly bit: number;
  readonly nodes: readonly NodeId[];
}

/** A unit as the layer holds it: where in which cell, and the classes its tallies counted. */
interface HeldUnit {
  cell: CoarseCell;
  slot: number;
  readonly bit: number;
  readonly wild: WildClass;
  readonly game: boolean;
}

const grids = new WeakMap<World, CombatGrid>();

/**
 * The per-world cell grid under the combat tick's target index. Buildings form a layer held across ticks,
 * rebuilt only when a building is placed, removed, retyped, re-owned or gains or loses its Position or Health
 * pool. Units form a layer kept across ticks from a change feed, so a build costs the units that moved, joined,
 * left or changed owner, tribe or Anger. Vehicles and the firing marks are appended each build on top.
 * A building's hitpoints are not a key: one felled this tick stays in the layer until cleanup removes it,
 * which only over-counts the presence tallies, and every target filter already rejects a dead target. The
 * cells hold owner bits only, never a stance, so a diplomacy change needs no rebuild. Derived state, never
 * hashed; the registered verifiers re-derive both held layers.
 */
export function combatGridOf(world: World, ctx: SystemContext, terrain: TerrainGraph): CombatGrid {
  const held = grids.get(world);
  if (held !== undefined && held.terrain === terrain && held.content === ctx.content) return held;
  const grid = new CombatGrid(
    terrain,
    ctx.content,
    world.watchChanges(UNIT_MEMBERSHIP, UNIT_VALUES),
    watchNodeMoves(world),
  );
  grids.set(world, grid);
  for (const store of LAYER_STORES) world.journalMembership(store);
  world.journalValueWrites(Building);
  world.registerCacheVerifier('combatBuildingLayer', () => grids.get(world)?.verify(world) ?? []);
  world.registerCacheVerifier('combatUnitLayer', () => grids.get(world)?.verifyUnits(world) ?? []);
  return grid;
}

export class CombatGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: (CoarseCell | undefined)[];
  private readonly builtCells: CoarseCell[] = [];
  private readonly buildings = new Map<Entity, HeldBuilding>();
  /** Members on the deprioritized siege tier, classified by type when the layer is built. */
  private readonly lowPriority = new Set<Entity>();
  /** The {@link LAYER_STORES} membership generations the layer is known current at; null before the first
   *  build. */
  private generations: number[] | null = null;
  private buildingValueGeneration = 0;
  private ownerValueGeneration = 0;
  private readonly units = new Map<Entity, HeldUnit>();
  /** Whether the unit layer was ever built; until then the feed's entries describe nothing held. */
  private unitsBuilt = false;
  /** The coarse cells the stranger neighbourhood spans each way; null until first asked. */
  private nearCells: number | null = null;
  private readonly nearDirtyCells: CoarseCell[] = [];
  /** The cells whose neighbourhood holds an undiscounted member or two owners. */
  private readonly strangerCells = new Set<CoarseCell>();
  private readonly bandScans: BandScan[] = [];

  constructor(
    readonly terrain: TerrainGraph,
    readonly content: ContentSet,
    private readonly unitFeed: ChangeFeed,
    private readonly moveFeed: NodeMoveFeed,
  ) {
    this.cols = Math.ceil(terrain.width / COARSE_CELL_NODES);
    this.rows = Math.ceil(terrain.height / COARSE_CELL_NODES);
    this.cells = new Array<CoarseCell | undefined>(this.cols * this.rows).fill(undefined);
  }

  /** Bring both held layers up to date and drop the previous build's vehicles and firing marks, leaving
   *  the grid ready for this build's admissions. */
  startBuild(world: World, ctx: SystemContext): void {
    for (const scan of this.bandScans) scan.valid = false;
    if (!this.buildingsCurrent(world)) {
      this.rebuildBuildings(world, ctx);
    } else {
      for (const cell of this.builtCells) {
        cell.bodies.count = cell.bodyBase;
        cell.buildTotal = 0;
        cell.buildUndiscounted = 0;
        cell.buildOwnerMask = 0;
        cell.buildThreatMask = 0;
        cell.buildThreatUndiscounted = 0;
        cell.countedLast = null;
        cell.builtOn = false;
        this.refresh(cell);
      }
      this.builtCells.length = 0;
    }
    this.syncUnits(world, ctx.tick);
  }

  /** Append moving body `e` (a vehicle) at each of its nodes for this build; an armed one threatens there
   *  as a firing building does, an unarmed one no more than a plain building. */
  admitBody(e: Entity, nodes: readonly NodeId[], bit: number, armed: boolean): void {
    for (const node of nodes) {
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      const cell = this.touchForBuild(x, y);
      push(cell.bodies, e, x, y, bit);
      if (cell.countedLast !== e) {
        cell.countedLast = e;
        cell.buildTotal++;
        if (bit !== 0) cell.buildOwnerMask |= bit;
        else cell.buildUndiscounted++;
      }
      if (armed) addBuildThreat(cell, bit);
      this.refresh(cell);
    }
  }

  /** Mark held building `b` as able to fire this build, in the threat tallies of the cells its body spans. */
  admitFiring(b: Entity): void {
    const held = this.buildings.get(b);
    if (held === undefined) return;
    for (const node of held.nodes) {
      const cell = this.touchForBuild(this.terrain.xOf(node), this.terrain.yOf(node));
      addBuildThreat(cell, held.bit);
      this.refresh(cell);
    }
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

  /**
   * The cells whose neighbourhood of `radius` map points holds an undiscounted member or two owners: a
   * query of at most `radius` from any node in any other cell sees one owner at most and nothing
   * undiscounted. Kept per change; a new radius re-derives every cell once.
   */
  strangerCellsWithin(radius: number): ReadonlySet<CoarseCell> {
    const reach = Math.ceil(radius / COARSE_CELL_NODES);
    if (reach !== this.nearCells) {
      this.nearCells = reach;
      for (const cell of this.cells) if (cell !== undefined) this.markNearDirty(cell);
    }
    for (const cell of this.nearDirtyCells) {
      const { nearMask, nearUndiscounted } = this.nearOf(cell, reach);
      cell.nearMask = nearMask;
      cell.nearUndiscounted = nearUndiscounted;
      cell.nearDirty = false;
      if (nearUndiscounted || (nearMask & (nearMask - 1)) !== 0) this.strangerCells.add(cell);
      else this.strangerCells.delete(cell);
    }
    this.nearDirtyCells.length = 0;
    return this.strangerCells;
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
        metric: 'manhattan',
        seeker: null,
        count: 0,
        keys: new Float64Array(BAND_SCAN_INITIAL_KEYS),
        met: new Uint32Array(0),
        metEpoch: 0,
      };
      this.bandScans[depth] = scan;
    }
    return scan;
  }

  /** Whether the layer still holds for `world`, advancing the held generations past the changes that
   *  touched no building so the next check replays only newer ones. */
  private buildingsCurrent(world: World): boolean {
    if (this.buildingsChanged(world)) return false;
    this.stampGenerations(world);
    this.buildingValueGeneration = world.componentValueGeneration(Building);
    return true;
  }

  /** Record the {@link LAYER_STORES} membership generations the layer is now current at. */
  private stampGenerations(world: World): void {
    if (this.generations === null) this.generations = [];
    const generations = this.generations;
    for (let i = 0; i < LAYER_STORES.length; i++) {
      const store = LAYER_STORES[i];
      if (store !== undefined) generations[i] = world.componentGeneration(store);
    }
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
      const written = world.valueWritesSince(Building, this.buildingValueGeneration);
      for (const e of written ?? this.buildings.keys()) {
        const held = this.buildings.get(e);
        if (held !== undefined && world.tryGet(e, Building)?.buildingType !== held.type) return true;
      }
    }
    return false;
  }

  /** Re-admit every building, clearing this build's share with the old layer; the units stay. */
  private rebuildBuildings(world: World, ctx: SystemContext): void {
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.bodies.count = 0;
      cell.baseTotal = 0;
      cell.baseUndiscounted = 0;
      cell.baseOwnerMask = 0;
      cell.buildTotal = 0;
      cell.buildUndiscounted = 0;
      cell.buildOwnerMask = 0;
      cell.buildThreatMask = 0;
      cell.buildThreatUndiscounted = 0;
      cell.countedLast = null;
      cell.builtOn = false;
    }
    this.builtCells.length = 0;
    this.buildings.clear();
    this.lowPriority.clear();
    for (const b of world.query(Building, Health, Position)) {
      const held = heldBuilding(world, ctx, this.terrain, b);
      for (const node of held.nodes) {
        const x = this.terrain.xOf(node);
        const y = this.terrain.yOf(node);
        const cell = this.cellFor(x, y);
        push(cell.bodies, b, x, y, held.bit);
        if (cell.countedLast === b) continue;
        cell.countedLast = b;
        cell.baseTotal++;
        if (held.bit !== 0) cell.baseOwnerMask |= held.bit;
        else cell.baseUndiscounted++;
      }
      this.buildings.set(b, held);
      if (isLowPriorityBuildingTarget(world, ctx, b)) this.lowPriority.add(b);
    }
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.bodyBase = cell.bodies.count;
      cell.countedLast = null;
      this.refresh(cell);
    }
    this.stampGenerations(world);
    this.buildingValueGeneration = world.componentValueGeneration(Building);
    this.ownerValueGeneration = world.componentValueGeneration(Owner);
  }

  /** Replay the unit feeds onto the unit layer, or re-admit every unit when a feed lost entries. An Anger
   *  lapses at its `until` tick without a write, so its holders are re-read every build. */
  private syncUnits(world: World, tick: number): void {
    const lost =
      !this.unitsBuilt ||
      this.unitFeed.drain((e) => this.placeUnit(world, tick, e)) ||
      this.moveFeed.drain((e) => this.moveUnit(world, e));
    if (lost) {
      this.unitFeed.drain(() => {});
      this.moveFeed.drain(() => {});
      this.rebuildUnits(world, tick);
    }
    for (const e of world.query(Anger)) this.placeUnit(world, tick, e);
  }

  private rebuildUnits(world: World, tick: number): void {
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.units.count = 0;
      cell.unitPassive = 0;
      cell.unitHostileAnimal = 0;
      cell.unitGame = 0;
      cell.unitUndiscounted = 0;
      cell.unitOwners.fill(0);
      cell.unitOwnerMask = 0;
      this.refresh(cell);
    }
    this.units.clear();
    for (const e of world.query(Settler, Health, Position)) this.placeUnit(world, tick, e);
    this.unitsBuilt = true;
  }

  /** Bring `e`'s unit entry in line with the world: admit, move, re-class or drop it. */
  private placeUnit(world: World, tick: number, e: Entity): void {
    const held = this.units.get(e);
    if (!isCombatant(world, e)) {
      if (held !== undefined) this.dropUnit(e, held);
      return;
    }
    const p = world.get(e, Position);
    const x = this.terrain.clampX(nodeHxOfPosition(p.x, p.y));
    const y = this.terrain.clampY(nodeHyOfPosition(p.y));
    const owner = world.tryGet(e, Owner);
    const bit = owner === undefined ? 0 : playerBit(owner.player);
    const unowned = owner === undefined ? world.get(e, Settler) : undefined;
    const wild = wildClassOf(world, this.content, tick, e, unowned);
    const game = isGame(this.content, unowned);
    if (held !== undefined) {
      const cell = this.cellFor(x, y);
      if (held.cell === cell && held.bit === bit && held.wild === wild && held.game === game) {
        cell.units.x[held.slot] = x;
        cell.units.y[held.slot] = y;
        return;
      }
      this.dropUnit(e, held);
    }
    this.addUnit(e, x, y, bit, wild, game);
  }

  /** Follow held unit `e` to the node its Position now stands on; the membership feed, replayed first,
   *  has already dropped one that left the layer. */
  private moveUnit(world: World, e: Entity): void {
    const held = this.units.get(e);
    if (held === undefined) return;
    // `entityNode`'s clamped coordinates, read without minting the id and dividing it apart again.
    const p = world.get(e, Position);
    const x = this.terrain.clampX(nodeHxOfPosition(p.x, p.y));
    const y = this.terrain.clampY(nodeHyOfPosition(p.y));
    const units = held.cell.units;
    if (units.x[held.slot] === x && units.y[held.slot] === y) return;
    const cell = this.cellFor(x, y);
    if (cell === held.cell) {
      units.x[held.slot] = x;
      units.y[held.slot] = y;
      return;
    }
    this.dropUnit(e, held);
    this.addUnit(e, x, y, held.bit, held.wild, held.game);
  }

  private addUnit(e: Entity, x: number, y: number, bit: number, wild: WildClass, game: boolean): void {
    const cell = this.cellFor(x, y);
    const slot = cell.units.count;
    push(cell.units, e, x, y, bit);
    this.units.set(e, { cell, slot, bit, wild, game });
    tallyUnit(cell, bit, wild, game, 1);
    this.refresh(cell);
  }

  /** Swap-remove `e` from its cell: the cell's last unit takes its slot. */
  private dropUnit(e: Entity, held: HeldUnit): void {
    const { cell, slot } = held;
    const units = cell.units;
    const last = units.count - 1;
    const moved = units.members[last];
    if (slot !== last && moved !== undefined) {
      units.members[slot] = moved;
      units.x[slot] = units.x[last] ?? 0;
      units.y[slot] = units.y[last] ?? 0;
      units.bit[slot] = units.bit[last] ?? 0;
      const movedHeld = this.units.get(moved);
      if (movedHeld !== undefined) movedHeld.slot = slot;
    }
    units.count = last;
    this.units.delete(e);
    tallyUnit(cell, held.bit, held.wild, held.game, -1);
    this.refresh(cell);
  }

  /** Re-derive `cell`'s combined tallies from its layers, and flag the neighbourhood whose stranger test
   *  may have changed with them. */
  private refresh(cell: CoarseCell): void {
    const wasOwners = cell.ownerMask;
    const wasUndiscounted = cell.undiscounted > 0;
    cell.total = cell.baseTotal + cell.units.count + cell.buildTotal;
    cell.passive = cell.unitPassive;
    cell.hostileAnimal = cell.unitHostileAnimal;
    cell.game = cell.unitGame;
    cell.undiscounted = cell.baseUndiscounted + cell.unitUndiscounted + cell.buildUndiscounted;
    cell.ownerMask = cell.baseOwnerMask | cell.unitOwnerMask | cell.buildOwnerMask;
    cell.threatMask = cell.unitOwnerMask | cell.buildThreatMask;
    cell.threatUndiscounted = cell.unitUndiscounted + cell.buildThreatUndiscounted;
    if (cell.ownerMask !== wasOwners || cell.undiscounted > 0 !== wasUndiscounted) this.markNearDirty(cell);
  }

  private markNearDirty(cell: CoarseCell): void {
    const reach = this.nearCells;
    if (reach === null) return;
    const cx = cell.index % this.cols;
    const cy = Math.floor(cell.index / this.cols);
    for (let y = Math.max(0, cy - reach); y <= Math.min(this.rows - 1, cy + reach); y++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(this.cols - 1, cx + reach); x++) {
        const near = this.cells[y * this.cols + x];
        if (near === undefined || near.nearDirty) continue;
        near.nearDirty = true;
        this.nearDirtyCells.push(near);
      }
    }
  }

  private nearOf(cell: CoarseCell, reach: number): { nearMask: number; nearUndiscounted: boolean } {
    const cx = cell.index % this.cols;
    const cy = Math.floor(cell.index / this.cols);
    let nearMask = 0;
    let nearUndiscounted = false;
    for (let y = Math.max(0, cy - reach); y <= Math.min(this.rows - 1, cy + reach); y++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(this.cols - 1, cx + reach); x++) {
        const near = this.cells[y * this.cols + x];
        if (near === undefined) continue;
        nearMask |= near.ownerMask;
        if (near.undiscounted > 0) nearUndiscounted = true;
      }
    }
    return { nearMask, nearUndiscounted };
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

  /** The unit layer's tripwire: every unit the feed does not name as pending sits where a fresh derivation
   *  puts it, and every cell's unit tallies and stranger test match its entries. */
  verifyUnits(world: World): string[] {
    if (!this.unitsBuilt) return [];
    const pending = new Set<Entity>();
    const note = (e: Entity): void => {
      pending.add(e);
    };
    if (this.unitFeed.peek(note) || this.moveFeed.peek(note)) return [];
    for (const e of world.query(Settler, Health, Position)) {
      if (pending.has(e)) continue;
      const held = this.units.get(e);
      if (held === undefined) return [`combatUnitLayer lacks unit ${e}`];
      const node = entityNode(world, this.terrain, e);
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      const owner = world.tryGet(e, Owner);
      const unowned = owner === undefined ? world.get(e, Settler) : undefined;
      const units = held.cell.units;
      if (
        units.members[held.slot] !== e ||
        units.x[held.slot] !== x ||
        units.y[held.slot] !== y ||
        held.cell !== this.cellFor(x, y) ||
        held.bit !== (owner === undefined ? 0 : playerBit(owner.player)) ||
        held.game !== isGame(this.content, unowned) ||
        // An Anger's lapse is re-read at the next build, so the class of its holder may lag until then.
        (!world.has(e, Anger) && held.wild !== wildClassOf(world, this.content, 0, e, unowned))
      ) {
        return [`combatUnitLayer holds a stale entry for unit ${e} - it changed without a feed entry`];
      }
    }
    for (const e of this.units.keys()) {
      if (!pending.has(e) && !isCombatant(world, e))
        return [`combatUnitLayer still holds ${e}, no longer a unit`];
    }
    return this.verifyTallies();
  }

  private verifyTallies(): string[] {
    const fresh = new Map<CoarseCell, { count: number; tallies: UnitTallies }>();
    for (const held of this.units.values()) {
      let tally = fresh.get(held.cell);
      if (tally === undefined) {
        tally = { count: 0, tallies: emptyUnitTallies() };
        fresh.set(held.cell, tally);
      }
      tally.count++;
      tallyUnit(tally.tallies, held.bit, held.wild, held.game, 1);
    }
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      const { count, tallies } = fresh.get(cell) ?? { count: 0, tallies: emptyUnitTallies() };
      if (
        cell.units.count !== count ||
        cell.unitPassive !== tallies.unitPassive ||
        cell.unitHostileAnimal !== tallies.unitHostileAnimal ||
        cell.unitGame !== tallies.unitGame ||
        cell.unitUndiscounted !== tallies.unitUndiscounted ||
        cell.unitOwnerMask !== tallies.unitOwnerMask ||
        cell.unitOwners.some((owned, player) => owned !== tallies.unitOwners[player])
      ) {
        return [`combatUnitLayer cell ${cell.index} tallies drifted from its units`];
      }
      const reach = this.nearCells;
      if (reach === null || cell.nearDirty) continue;
      const { nearMask, nearUndiscounted } = this.nearOf(cell, reach);
      const strange = nearUndiscounted || (nearMask & (nearMask - 1)) !== 0;
      if (
        cell.nearMask !== nearMask ||
        cell.nearUndiscounted !== nearUndiscounted ||
        this.strangerCells.has(cell) !== strange
      ) {
        return [`combatUnitLayer cell ${cell.index} holds a stale stranger neighbourhood`];
      }
    }
    return [];
  }

  /** The cell at node (x, y), listed for the next build's reset. */
  private touchForBuild(x: number, y: number): CoarseCell {
    const cell = this.cellFor(x, y);
    if (!cell.builtOn) {
      cell.builtOn = true;
      this.builtCells.push(cell);
    }
    return cell;
  }

  private cellFor(x: number, y: number): CoarseCell {
    const i = coarseOf(y) * this.cols + coarseOf(x);
    let cell = this.cells[i];
    if (cell === undefined) {
      cell = {
        index: i,
        total: 0,
        passive: 0,
        hostileAnimal: 0,
        game: 0,
        undiscounted: 0,
        ownerMask: 0,
        threatMask: 0,
        threatUndiscounted: 0,
        bodies: memberList(),
        units: memberList(),
        bodyBase: 0,
        baseTotal: 0,
        baseUndiscounted: 0,
        baseOwnerMask: 0,
        unitPassive: 0,
        unitHostileAnimal: 0,
        unitGame: 0,
        unitUndiscounted: 0,
        unitOwners: new Array<number>(MAX_PLAYERS).fill(0),
        unitOwnerMask: 0,
        buildTotal: 0,
        buildUndiscounted: 0,
        buildOwnerMask: 0,
        buildThreatMask: 0,
        buildThreatUndiscounted: 0,
        countedLast: null,
        builtOn: false,
        nearMask: 0,
        nearUndiscounted: false,
        nearDirty: false,
      };
      this.cells[i] = cell;
      if (this.nearCells !== null) {
        cell.nearDirty = true;
        this.nearDirtyCells.push(cell);
      }
    }
    return cell;
  }
}

/** Whether `e` belongs in the building layer: a building with a Position and a Health pool. */
function isLayerMember(world: World, e: Entity): boolean {
  return world.has(e, Building) && world.has(e, Health) && world.has(e, Position);
}

/** Whether `e` is a combatant, and so in the unit layer: a felled one included until cleanup reaps it. */
export function isCombatant(world: World, e: Entity): boolean {
  return world.has(e, Settler) && world.has(e, Health) && world.has(e, Position);
}

function heldBuilding(world: World, ctx: MapContext, terrain: TerrainGraph, b: Entity): HeldBuilding {
  const owner = world.tryGet(b, Owner);
  return {
    type: world.get(b, Building).buildingType,
    bit: owner === undefined ? 0 : playerBit(owner.player),
    nodes: buildingBodyNodes(world, ctx, terrain, b),
  };
}

/**
 * Classify a unit by `unowned`, its Settler when it carries no Owner, or null for anything owned or
 * non-animal. `'passive'` is discounted from the stranger tests and `'hostile'` additionally from the civ
 * test, so neither a grazing herd nor a wolf pack can defeat every gated seeker's early-out. The lapsed-Anger
 * reap stays with the attacker pass; the next build re-reads the class.
 */
function wildClassOf(
  world: World,
  content: ContentSet,
  tick: number,
  e: Entity,
  unowned: { readonly tribe: number } | undefined,
): WildClass {
  if (unowned === undefined || !isAnimalTribe(content, unowned.tribe)) return null;
  if (isAggressiveAnimal(content, unowned.tribe)) return 'hostile';
  const anger = world.tryGet(e, Anger);
  return anger !== undefined && tick < anger.until ? 'hostile' : 'passive';
}

/** Whether an unowned unit counts toward {@link CoarseCell.game}. */
function isGame(content: ContentSet, unowned: { readonly tribe: number } | undefined): boolean {
  return (
    unowned !== undefined &&
    isHuntablePrey(content, unowned.tribe) &&
    !isLastResortPrey(content, unowned.tribe)
  );
}

function memberList(): MemberList {
  return { count: 0, members: [], x: [], y: [], bit: [] };
}

function push(list: MemberList, e: Entity, x: number, y: number, bit: number): void {
  const i = list.count++;
  list.members[i] = e;
  list.x[i] = x;
  list.y[i] = y;
  list.bit[i] = bit;
}

/** A cell's unit layer share. */
type UnitTallies = Pick<
  CoarseCell,
  'unitPassive' | 'unitHostileAnimal' | 'unitGame' | 'unitUndiscounted' | 'unitOwners' | 'unitOwnerMask'
>;

function emptyUnitTallies(): UnitTallies {
  return {
    unitPassive: 0,
    unitHostileAnimal: 0,
    unitGame: 0,
    unitUndiscounted: 0,
    unitOwners: new Array<number>(MAX_PLAYERS).fill(0),
    unitOwnerMask: 0,
  };
}

/** Add (`sign` 1) or remove (-1) one unit's share of `cell`'s unit tallies. */
function tallyUnit(cell: UnitTallies, bit: number, wild: WildClass, game: boolean, sign: 1 | -1): void {
  if (wild === 'passive') cell.unitPassive += sign;
  else if (wild === 'hostile') cell.unitHostileAnimal += sign;
  if (game) cell.unitGame += sign;
  if (bit === 0) {
    if (wild !== 'passive') cell.unitUndiscounted += sign;
    return;
  }
  const player = playerOfBit(bit);
  const owned = (cell.unitOwners[player] ?? 0) + sign;
  cell.unitOwners[player] = owned;
  if (owned > 0) cell.unitOwnerMask |= bit;
  else cell.unitOwnerMask &= ~bit;
}

function addBuildThreat(cell: CoarseCell, bit: number): void {
  if (bit !== 0) cell.buildThreatMask |= bit;
  else cell.buildThreatUndiscounted++;
}

export function coarseOf(node: number): number {
  return Math.floor(node / COARSE_CELL_NODES);
}
