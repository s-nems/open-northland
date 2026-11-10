import type { ContentSet } from '@open-northland/data';
import {
  Anger,
  Building,
  Engagement,
  Health,
  hostileMaskOf,
  isValidPlayer,
  MAX_PLAYERS,
  Owner,
  Person,
  Position,
  Settler,
  settlerTradeLog,
} from '../../components/index.js';
import type { ChangeFeed, Component, Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import {
  isAggressiveAnimal,
  isAnimalTribe,
  isFighterJob,
  isLowPriorityBuildingTarget,
  ranksWithTowers,
} from '../readviews/index.js';
import { moverNode } from '../spatial/mover-node.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { derivedEntityNode } from '../spatial/nodes.js';
import { EpochMarks } from './epoch-marks.js';
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
 *  holds a Settler, a Health pool and a Position, and its Owner, tribe, Anger and Engagement target decide
 *  its tallies. The tribe never changes, and an Anger that lapses without a write is re-read every build. A
 *  Position write only moves a unit, so it has its own feed. */
const UNIT_MEMBERSHIP: readonly Component<unknown>[] = [
  Settler,
  Health,
  Position,
  Owner,
  Anger,
  Engagement,
  Person,
];
const UNIT_VALUES: readonly Component<unknown>[] = [Owner];
/** An Engagement write re-classes only an unowned animal, so its feed skips every other held unit. */
const WILD_VALUES: readonly Component<unknown>[] = [Engagement];

/** {@link MemberList.tier} of a member that may be a first-tier combat target. */
const FIRST_TIER = 1;

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
  /** 1 for a member that may be a first-tier combat target by itself: a fighter, a tower-ranked building,
   *  any vehicle. A building that only shoots this pass is marked on its cells instead. */
  readonly tier: number[];
}

/**
 * One coarse cell: its early-out tallies and its members. Counts are per member, not per node - every
 * query reduces to "does a member of some class exist here?", which no weighting can change. The tallies
 * the queries read are the sum of three layers, re-derived by {@link refresh}: the held buildings, the kept
 * units, and this build's vehicles.
 */
export interface CoarseCell {
  readonly index: number;
  total: number;
  passive: number;
  hostileAnimal: number;
  /** Members no diplomacy can discount: unowned ones other than passive wildlife, and any owned outside the
   *  player slots. */
  undiscounted: number;
  /** The {@link playerBit}s of the players owning a member here. */
  ownerMask: number;
  /** The held buildings at each of their nodes, then this build's vehicles past {@link bodyBase}. */
  readonly bodies: MemberList;
  /** The kept units, one node each. */
  readonly units: MemberList;
  /** The building layer's share. A building is never wildlife. */
  bodyBase: number;
  baseTotal: number;
  baseUndiscounted: number;
  baseOwnerMask: number;
  /** The unit layer's share. */
  unitPassive: number;
  unitHostileAnimal: number;
  unitUndiscounted: number;
  /** Per player slot, the units it owns here, which keep {@link unitOwnerMask} exact as units leave. */
  readonly unitOwners: number[];
  unitOwnerMask: number;
  /** The fighters among the units, as {@link unitOwners} and {@link unitOwnerMask} count the units, and
   *  those with no player bit. */
  readonly unitFighters: number[];
  unitFighterMask: number;
  unitFighterUnowned: number;
  /** The owner bits of the tower-ranked buildings here and whether one has none, current at
   *  {@link bodyTiersAt} of the grid's building layer version. */
  towerMask: number;
  towerUnowned: boolean;
  bodyTiersAt: number;
  /** The same for the other buildings able to shoot, marked for the pass numbered {@link firingAt}. */
  firingMask: number;
  firingUnowned: boolean;
  firingAt: number;
  /** This build's share: the vehicles. */
  buildTotal: number;
  buildUndiscounted: number;
  buildOwnerMask: number;
  /** The last vehicle tallied, so its several nodes in one cell count once. */
  countedLast: Entity | null;
  /** Whether this build admitted a vehicle here, so the next reset visits only such cells. */
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
  /** The members the running query over this scan has met, so a member recurring at a further node is
   *  skipped without a per-query set. */
  readonly met: EpochMarks;
  /** The members a narrowed scan asked its test about, and those it passed. */
  readonly narrowed: EpochMarks;
  readonly passed: EpochMarks;
}

/** A building as the layer admitted it, for the staleness checks and the verifier. */
interface BuildingEntry {
  readonly type: number;
  readonly bit: number;
  readonly nodes: readonly NodeId[];
}

/** A held building with the distinct cells its nodes fall in and how many nodes each holds, so an update
 *  touches each cell once instead of re-deriving every node's cell. */
interface HeldBuilding extends BuildingEntry {
  readonly cells: readonly CoarseCell[];
  readonly cellNodes: readonly number[];
  /** Whether its type ranks with the towers in the first combat priority. */
  readonly towerRanked: boolean;
}

/** A unit as the layer holds it: where in which cell, and the classes its tallies counted. */
interface HeldUnit {
  cell: CoarseCell;
  slot: number;
  readonly bit: number;
  readonly wild: WildClass;
  /** A person of a fighting trade: a first-tier combat target. */
  readonly fighter: boolean;
}

const grids = new WeakMap<World, CombatGrid>();

/**
 * The per-world cell grid under the combat tick's target index. Buildings form a layer held across ticks,
 * updated for each building placed, removed, retyped or gaining or losing its Position or Health pool, and
 * rebuilt when one is re-owned. Units form a layer kept across ticks from a change feed, so a build costs
 * the units that moved, joined, left or changed owner, tribe or Anger. Vehicles are appended each build on
 * top.
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
    world.watchChanges([], WILD_VALUES),
    watchNodeMoves(world),
    settlerTradeLog(world, 'combatUnits'),
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
  /** The cells this build touched, the first {@link builtCount} live: a count rather than a length reset,
   *  which would drop the backing store and regrow it every build. */
  private readonly builtCells: CoarseCell[] = [];
  private builtCount = 0;
  private readonly buildings = new Map<Entity, HeldBuilding>();
  /** Members on the deprioritized siege tier, classified by type when the layer is built. */
  private readonly lowPriority = new Set<Entity>();
  /** The {@link LAYER_STORES} membership generations the layer is known current at; null before the first
   *  build. */
  private generations: number[] | null = null;
  private buildingValueGeneration = 0;
  /** Bumped by every change to the building layer, so a cell's tower tallies are re-read after one. */
  private buildingLayerVersion = 1;
  /** The pass whose shooting buildings the cells are marked for, and the index that marked them. */
  private firingPass = 0;
  private firingMarkedFor: object | null = null;
  private ownerValueGeneration = 0;
  /** The held units by entity id, so a move's lookup is an array read. */
  private readonly units: (HeldUnit | undefined)[] = [];
  /** Whether the unit layer was ever built; until then the feed's entries describe nothing held. */
  private unitsBuilt = false;
  /** The coarse cells the stranger neighbourhood spans each way; null until first asked. */
  private nearCells: number | null = null;
  /** The first {@link nearDirtyCount} are live, as {@link builtCells} counts its own. */
  private readonly nearDirtyCells: CoarseCell[] = [];
  private nearDirtyCount = 0;
  /** The cells whose neighbourhood holds an undiscounted member or two owners. */
  private readonly strangerCells = new Set<CoarseCell>();
  private readonly bandScans: BandScan[] = [];
  private readonly changedScratch: Entity[] = [];
  private readonly touchedScratch: CoarseCell[] = [];

  constructor(
    readonly terrain: TerrainGraph,
    readonly content: ContentSet,
    private readonly unitFeed: ChangeFeed,
    private readonly wildFeed: ChangeFeed,
    private readonly moveFeed: NodeMoveFeed,
    /** The settlers whose trade changed since the last sync: a trade makes or unmakes a fighter. */
    private readonly tradeChanges: Set<Entity>,
  ) {
    this.cols = Math.ceil(terrain.width / COARSE_CELL_NODES);
    this.rows = Math.ceil(terrain.height / COARSE_CELL_NODES);
    this.cells = new Array<CoarseCell | undefined>(this.cols * this.rows).fill(undefined);
  }

  /** Bring both held layers up to date and drop the previous build's vehicles, leaving the grid ready for
   *  this build's admissions. */
  startBuild(world: World, ctx: SystemContext): void {
    for (const scan of this.bandScans) scan.valid = false;
    for (let i = 0; i < this.builtCount; i++) {
      const cell = this.builtCells[i] as CoarseCell;
      cell.bodies.count = cell.bodyBase;
      cell.buildTotal = 0;
      cell.buildUndiscounted = 0;
      cell.buildOwnerMask = 0;
      cell.countedLast = null;
      cell.builtOn = false;
      this.refresh(cell);
    }
    this.builtCount = 0;
    const changed = this.changedBuildings(world);
    if (changed === null) this.rebuildBuildings(world, ctx);
    else {
      if (changed.length > 0) this.updateBuildings(world, ctx, changed);
      this.stampGenerations(world);
      this.buildingValueGeneration = world.componentValueGeneration(Building);
    }
    this.syncUnits(world, ctx.tick);
  }

  /** The node visitor that appends moving body `e` (a vehicle) at each node it is handed for this build.
   *  One visitor serves every body, re-aimed by each call, so admitting a body allocates nothing. */
  bodyAdmitter(e: Entity, bit: number): (x: number, y: number) => void {
    this.body = e;
    this.bodyBit = bit;
    return this.admitBodyNode;
  }

  private body = 0 as Entity;
  private bodyBit = 0;
  private readonly admitBodyNode = (x: number, y: number): void => {
    const e = this.body;
    const bit = this.bodyBit;
    const cell = this.touchForBuild(this.cellFor(x, y));
    push(cell.bodies, e, x, y, bit, FIRST_TIER);
    if (cell.countedLast !== e) {
      cell.countedLast = e;
      cell.buildTotal++;
      if (bit !== 0) cell.buildOwnerMask |= bit;
      else cell.buildUndiscounted++;
    }
    this.refresh(cell);
  };

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
   * Every unit owned by a player among `owners` ({@link playerBit}s) whose node lies in the inclusive node
   * box, ascending id, read after the unit layer catches up on its feeds. Costs the coarse cells the box
   * spans and the units of the cells such an owner holds one in, never the owners' whole rosters.
   */
  ownedUnitsInBox(
    world: World,
    tick: number,
    owners: number,
    box: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number },
  ): Entity[] {
    const found: Entity[] = [];
    if (owners === 0) return found;
    this.syncUnits(world, tick);
    const cx1 = Math.min(this.cols - 1, coarseOf(box.maxX));
    const cy1 = Math.min(this.rows - 1, coarseOf(box.maxY));
    for (let cy = Math.max(0, coarseOf(box.minY)); cy <= cy1; cy++) {
      for (let cx = Math.max(0, coarseOf(box.minX)); cx <= cx1; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        if (cell === undefined || (cell.unitOwnerMask & owners) === 0) continue;
        const { members, x, y, bit } = cell.units;
        for (let i = 0; i < cell.units.count; i++) {
          const e = members[i];
          if (e === undefined || ((bit[i] ?? 0) & owners) === 0) continue;
          const hx = x[i] ?? 0;
          const hy = y[i] ?? 0;
          if (hx >= box.minX && hx <= box.maxX && hy >= box.minY && hy <= box.maxY) found.push(e);
        }
      }
    }
    return found.sort((a, b) => a - b);
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
    for (let i = 0; i < this.nearDirtyCount; i++) {
      const cell = this.nearDirtyCells[i] as CoarseCell;
      const { nearMask, nearUndiscounted } = this.nearOf(cell, reach);
      cell.nearMask = nearMask;
      cell.nearUndiscounted = nearUndiscounted;
      cell.nearDirty = false;
      if (nearUndiscounted || (nearMask & (nearMask - 1)) !== 0) this.strangerCells.add(cell);
      else this.strangerCells.delete(cell);
    }
    this.nearDirtyCount = 0;
    return this.strangerCells;
  }

  /**
   * Whether the stranger neighbourhood {@link strangerCellsWithin} last derived proves that no cell within
   * `radius` nodes of held unit `e` holds an undiscounted member or one of the players its
   * `hostileMasks` entry names. False proves nothing: a unit not held in a player slot, a neighbourhood
   * not derived or narrower than `radius`.
   */
  unitClearOfStrangers(e: Entity, radius: number, hostileMasks: readonly number[]): boolean {
    const held = this.units[e];
    if (held === undefined || held.bit === 0 || this.nearCells === null) return false;
    // The neighbourhood spans whole cells, so from any node of the unit's cell it covers this far.
    if (radius > this.nearCells * COARSE_CELL_NODES) return false;
    const { cell } = held;
    if (cell.nearDirty || cell.nearUndiscounted) return false;
    return (cell.nearMask & hostileMaskOf(hostileMasks, playerOfBit(held.bit))) === 0;
  }

  /**
   * Mark for `index`'s pass the cells of every building of `firing` that is not tower-ranked by type, once
   * per index: with them a cell's first-tier test covers every building able to shoot.
   */
  markFiring(index: object, firing: ReadonlySet<Entity>): void {
    if (this.firingMarkedFor === index) return;
    this.firingMarkedFor = index;
    this.firingPass++;
    firing.forEach(this.markFiringBuilding);
  }

  private readonly markFiringBuilding = (b: Entity): void => {
    const held = this.buildings.get(b);
    if (held === undefined || held.towerRanked) return;
    for (const cell of held.cells) {
      if (cell.firingAt !== this.firingPass) {
        cell.firingAt = this.firingPass;
        cell.firingMask = 0;
        cell.firingUnowned = false;
      }
      if (held.bit !== 0) cell.firingMask |= held.bit;
      else cell.firingUnowned = true;
    }
  };

  /**
   * Whether `cell` may hold a first-tier combat target (`isPriorityCombatTarget`) a search for the
   * `hostile` players is offered: a fighter, a tower-ranked or shooting building, or any vehicle, armed or
   * not, of such a player or of none. False is a proof of absence. Read after {@link markFiring}.
   */
  holdsFirstTier(cell: CoarseCell, hostile: number): boolean {
    if (cell.unitFighterUnowned > 0 || (cell.unitFighterMask & hostile) !== 0) return true;
    if (cell.buildUndiscounted > 0 || (cell.buildOwnerMask & hostile) !== 0) return true;
    if (cell.bodyTiersAt !== this.buildingLayerVersion) this.readTowers(cell);
    if (cell.towerUnowned || (cell.towerMask & hostile) !== 0) return true;
    return cell.firingAt === this.firingPass && (cell.firingUnowned || (cell.firingMask & hostile) !== 0);
  }

  /** Whether a building of `cell` that is first-tier only because it shoots is marked for this pass, so
   *  its body entries carry no {@link MemberList.tier} of their own. Read after {@link markFiring}. */
  holdsShootingBuilding(cell: CoarseCell): boolean {
    return cell.firingAt === this.firingPass;
  }

  /** Re-read `cell`'s tower tallies off its building entries: a building's nodes in one cell sit together. */
  private readTowers(cell: CoarseCell): void {
    const { members, bit } = cell.bodies;
    let mask = 0;
    let unowned = false;
    let last: Entity | undefined;
    for (let i = 0; i < cell.bodyBase; i++) {
      const member = members[i];
      if (member === last || member === undefined) continue;
      last = member;
      if (this.buildings.get(member)?.towerRanked !== true) continue;
      const memberBit = bit[i] ?? 0;
      if (memberBit !== 0) mask |= memberBit;
      else unowned = true;
    }
    cell.towerMask = mask;
    cell.towerUnowned = unowned;
    cell.bodyTiersAt = this.buildingLayerVersion;
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
        met: new EpochMarks(),
        narrowed: new EpochMarks(),
        passed: new EpochMarks(),
      };
      this.bandScans[depth] = scan;
    }
    return scan;
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

  /**
   * The entities to re-admit to the building layer since the last build, ascending and each once: every
   * building that joined, left, changed type or gained or lost a layer store. Null when the layer must be
   * rebuilt instead: before the first build, past a journal's window, or after an Owner write. Pure, so the
   * verifier asks it too; the list lives until the next call.
   */
  private changedBuildings(world: World): readonly Entity[] | null {
    const generations = this.generations;
    if (generations === null) return null;
    const changed = this.changedScratch;
    changed.length = 0;
    const note = (e: Entity): void => {
      if (this.buildings.has(e) || isLayerMember(world, e)) changed.push(e);
    };
    for (let i = 0; i < LAYER_STORES.length; i++) {
      const store = LAYER_STORES[i];
      const since = generations[i];
      if (store === undefined || since === undefined) return null;
      if (world.componentGeneration(store) === since) continue;
      if (!world.replayMembershipSince(store, since, note)) return null;
    }
    // No system writes an Owner in place today; one that does rebuilds rather than going unseen.
    if (world.componentValueGeneration(Owner) !== this.ownerValueGeneration) return null;
    // A Building value write is mostly construction progress; only a type swap moves a body.
    if (world.componentValueGeneration(Building) !== this.buildingValueGeneration) {
      const retyped = (e: Entity): void => {
        const held = this.buildings.get(e);
        if (held !== undefined && world.tryGet(e, Building)?.buildingType !== held.type) changed.push(e);
      };
      if (!world.replayValueWritesSince(Building, this.buildingValueGeneration, retyped)) {
        this.buildings.forEach((_, e) => {
          retyped(e);
        });
      }
    }
    if (changed.length > 1) {
      changed.sort((a, b) => a - b);
      let kept = 1;
      for (let i = 1; i < changed.length; i++) {
        const e = changed[i] as Entity;
        if (e !== changed[kept - 1]) changed[kept++] = e;
      }
      changed.length = kept;
    }
    return changed;
  }

  /** Drop each of `changed` from the building layer and admit it again if it still belongs, leaving every
   *  other building's entries in place. The build share must already be cleared. */
  private updateBuildings(world: World, ctx: SystemContext, changed: readonly Entity[]): void {
    this.buildingLayerVersion++;
    const touched = this.touchedScratch;
    touched.length = 0;
    for (const b of changed) {
      const held = this.buildings.get(b);
      if (held !== undefined) {
        for (const cell of held.cells) {
          dropBodies(cell, b);
          touched.push(cell);
        }
        this.buildings.delete(b);
        this.lowPriority.delete(b);
      }
      if (isLayerMember(world, b)) {
        for (const cell of this.admitBuilding(world, ctx, b).cells) {
          cell.bodyBase = cell.bodies.count;
          touched.push(cell);
        }
      }
    }
    for (const cell of touched) {
      tallyBase(cell);
      this.refresh(cell);
    }
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
      cell.countedLast = null;
      cell.builtOn = false;
    }
    this.builtCount = 0;
    this.buildingLayerVersion++;
    this.buildings.clear();
    this.lowPriority.clear();
    for (const b of world.query(Building, Health, Position)) {
      const { cells, bit } = this.admitBuilding(world, ctx, b);
      for (const cell of cells) {
        cell.baseTotal++;
        if (bit !== 0) cell.baseOwnerMask |= bit;
        else cell.baseUndiscounted++;
      }
    }
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.bodyBase = cell.bodies.count;
      this.refresh(cell);
    }
    this.stampGenerations(world);
    this.buildingValueGeneration = world.componentValueGeneration(Building);
    this.ownerValueGeneration = world.componentValueGeneration(Owner);
  }

  /** Append building `b` at each of its nodes to the building layer and hold its entry, which it returns.
   *  The base tallies of the cells it spans are the caller's. */
  private admitBuilding(world: World, ctx: SystemContext, b: Entity): HeldBuilding {
    const entry = buildingEntry(world, ctx, this.terrain, b);
    const towerRanked = ranksWithTowers(ctx, entry.type);
    const cells: CoarseCell[] = [];
    const cellNodes: number[] = [];
    for (const node of entry.nodes) {
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      const cell = this.cellFor(x, y);
      push(cell.bodies, b, x, y, entry.bit, towerRanked ? FIRST_TIER : 0);
      const at = cells.indexOf(cell);
      if (at >= 0) {
        cellNodes[at] = (cellNodes[at] ?? 0) + 1;
        continue;
      }
      cells.push(cell);
      cellNodes.push(1);
    }
    const held = { ...entry, cells, cellNodes, towerRanked };
    this.buildings.set(b, held);
    if (isLowPriorityBuildingTarget(world, ctx, b)) this.lowPriority.add(b);
    return held;
  }

  /** Replay the unit feeds onto the unit layer, or re-admit every unit when a feed lost entries. An Anger
   *  lapses at its `until` tick without a write, so its holders are re-read every build. */
  private syncUnits(world: World, tick: number): void {
    const lost =
      !this.unitsBuilt ||
      this.unitFeed.drain((e) => this.placeUnit(world, tick, e)) ||
      this.wildFeed.drain((e) => {
        // The membership feed, replayed first, has placed a unit whose stores changed; a held unit the
        // Engagement cannot re-class keeps its entry.
        if (this.units[e]?.wild !== null) this.placeUnit(world, tick, e);
      }) ||
      this.moveFeed.drain((e) => this.moveUnit(e));
    if (lost) {
      this.unitFeed.drain(() => {});
      this.wildFeed.drain(() => {});
      this.moveFeed.drain(() => {});
      this.rebuildUnits(world, tick);
    } else {
      this.tradeChanges.forEach((e) => {
        this.placeUnit(world, tick, e);
      });
    }
    this.tradeChanges.clear();
    for (const e of world.query(Anger)) this.placeUnit(world, tick, e);
  }

  private rebuildUnits(world: World, tick: number): void {
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      cell.units.count = 0;
      cell.unitPassive = 0;
      cell.unitHostileAnimal = 0;
      cell.unitUndiscounted = 0;
      cell.unitOwners.fill(0);
      cell.unitOwnerMask = 0;
      cell.unitFighters.fill(0);
      cell.unitFighterMask = 0;
      cell.unitFighterUnowned = 0;
      this.refresh(cell);
    }
    this.units.length = 0;
    for (const e of world.query(Settler, Health, Position)) this.placeUnit(world, tick, e);
    this.unitsBuilt = true;
  }

  /** Bring `e`'s unit entry in line with the world: admit, move, re-class or drop it. */
  private placeUnit(world: World, tick: number, e: Entity): void {
    const held = this.units[e];
    if (!isCombatant(world, e)) {
      if (held !== undefined) this.dropUnit(e, held);
      return;
    }
    const node = moverNode(world, e, world.get(e, Position));
    const x = this.terrain.clampX(node.hx);
    const y = this.terrain.clampY(node.hy);
    const owner = world.tryGet(e, Owner);
    const bit = owner === undefined ? 0 : playerBit(owner.player);
    const unowned = owner === undefined ? world.get(e, Settler) : undefined;
    const wild = wildClassOf(world, this.content, tick, e, unowned);
    const fighter = isFighterUnit(world, this.content, e);
    if (held !== undefined) {
      const cell = this.cellFor(x, y);
      if (held.cell === cell && held.bit === bit && held.wild === wild && held.fighter === fighter) {
        cell.units.x[held.slot] = x;
        cell.units.y[held.slot] = y;
        return;
      }
      this.dropUnit(e, held);
    }
    this.addUnit(e, x, y, bit, wild, fighter);
  }

  /** Follow held unit `e` to the node it now reads (`moverNode`); the membership feed, replayed first,
   *  has already dropped one that left the layer. */
  private moveUnit(e: Entity): void {
    const held = this.units[e];
    if (held === undefined) return;
    // `entityNode`'s clamped coordinates, read off the node the move feed already derived.
    const x = this.terrain.clampX(this.moveFeed.heldHx(e));
    const y = this.terrain.clampY(this.moveFeed.heldHy(e));
    const units = held.cell.units;
    if (units.x[held.slot] === x && units.y[held.slot] === y) return;
    const cell = this.cellFor(x, y);
    if (cell === held.cell) {
      units.x[held.slot] = x;
      units.y[held.slot] = y;
      return;
    }
    this.unslot(held);
    tallyUnit(held.cell, held.bit, held.wild, held.fighter, -1);
    this.refresh(held.cell);
    held.cell = cell;
    held.slot = cell.units.count;
    push(cell.units, e, x, y, held.bit, held.fighter ? FIRST_TIER : 0);
    tallyUnit(cell, held.bit, held.wild, held.fighter, 1);
    this.refresh(cell);
  }

  private addUnit(e: Entity, x: number, y: number, bit: number, wild: WildClass, fighter: boolean): void {
    const cell = this.cellFor(x, y);
    const slot = cell.units.count;
    push(cell.units, e, x, y, bit, fighter ? FIRST_TIER : 0);
    const units = this.units;
    while (units.length <= e) units.push(undefined);
    units[e] = { cell, slot, bit, wild, fighter };
    tallyUnit(cell, bit, wild, fighter, 1);
    this.refresh(cell);
  }

  private dropUnit(e: Entity, held: HeldUnit): void {
    this.unslot(held);
    this.units[e] = undefined;
    tallyUnit(held.cell, held.bit, held.wild, held.fighter, -1);
    this.refresh(held.cell);
  }

  /** Swap-remove `held` from its cell's members: the cell's last unit takes its slot. */
  private unslot(held: HeldUnit): void {
    const { cell, slot } = held;
    const units = cell.units;
    const last = units.count - 1;
    const moved = units.members[last];
    if (slot !== last && moved !== undefined) {
      units.members[slot] = moved;
      units.x[slot] = units.x[last] ?? 0;
      units.y[slot] = units.y[last] ?? 0;
      units.bit[slot] = units.bit[last] ?? 0;
      units.tier[slot] = units.tier[last] ?? 0;
      const movedHeld = this.units[moved];
      if (movedHeld !== undefined) movedHeld.slot = slot;
    }
    units.count = last;
  }

  /** Re-derive `cell`'s combined tallies from its layers, and flag the neighbourhood whose stranger test
   *  may have changed with them. */
  private refresh(cell: CoarseCell): void {
    const wasOwners = cell.ownerMask;
    const wasUndiscounted = cell.undiscounted > 0;
    cell.total = cell.baseTotal + cell.units.count + cell.buildTotal;
    cell.passive = cell.unitPassive;
    cell.hostileAnimal = cell.unitHostileAnimal;
    cell.undiscounted = cell.baseUndiscounted + cell.unitUndiscounted + cell.buildUndiscounted;
    cell.ownerMask = cell.baseOwnerMask | cell.unitOwnerMask | cell.buildOwnerMask;
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
        this.nearDirtyCells[this.nearDirtyCount++] = near;
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
    // A seen change is applied at the next build, before any query reads the layer.
    if (this.changedBuildings(world)?.length !== 0) return [];
    const ctx = { content: this.content, terrain: this.terrain };
    let live = 0;
    for (const b of world.query(Building, Health, Position)) {
      live++;
      const held = this.buildings.get(b);
      const fresh = buildingEntry(world, ctx, this.terrain, b);
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
    return this.verifyBaseTallies();
  }

  /** Every cell's building share against its held buildings, counted once per cell each, and its body
   *  entries against the held nodes, so an entry a missed drop left behind fails too. */
  private verifyBaseTallies(): string[] {
    const fresh = new Map<CoarseCell, BaseTally>();
    const expectedEntries = new Map<CoarseCell, string[]>();
    this.buildings.forEach((held, b) => {
      held.cells.forEach((cell, i) => {
        let tally = fresh.get(cell);
        if (tally === undefined) {
          tally = emptyBaseTally();
          fresh.set(cell, tally);
        }
        tally.total++;
        tally.nodes += held.cellNodes[i] ?? 0;
        if (held.bit !== 0) tally.ownerMask |= held.bit;
        else tally.undiscounted++;
      });
      for (const node of held.nodes) {
        const x = this.terrain.xOf(node);
        const y = this.terrain.yOf(node);
        const cell = this.cellFor(x, y);
        let entries = expectedEntries.get(cell);
        if (entries === undefined) {
          entries = [];
          expectedEntries.set(cell, entries);
        }
        entries.push(bodyEntryKey(b, x, y));
      }
    });
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      const tally = fresh.get(cell) ?? emptyBaseTally();
      if (
        cell.bodyBase !== tally.nodes ||
        cell.baseTotal !== tally.total ||
        cell.baseUndiscounted !== tally.undiscounted ||
        cell.baseOwnerMask !== tally.ownerMask
      ) {
        return [`combatBuildingLayer cell ${cell.index} building tallies drifted from its buildings`];
      }
      const expected = (expectedEntries.get(cell) ?? []).sort();
      const held: string[] = [];
      const { members, x, y } = cell.bodies;
      for (let i = 0; i < cell.bodyBase; i++) {
        held.push(bodyEntryKey(members[i] as Entity, x[i] ?? 0, y[i] ?? 0));
      }
      held.sort();
      if (held.some((entry, i) => entry !== expected[i])) {
        return [`combatBuildingLayer cell ${cell.index} body entries drifted from its buildings' nodes`];
      }
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
    if (this.unitFeed.peek(note) || this.wildFeed.peek(note) || this.moveFeed.peek(note)) return [];
    this.tradeChanges.forEach(note);
    for (const e of world.query(Settler, Health, Position)) {
      if (pending.has(e)) continue;
      const held = this.units[e];
      if (held === undefined) return [`combatUnitLayer lacks unit ${e}`];
      const node = derivedEntityNode(world, this.terrain, e);
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
        held.fighter !== isFighterUnit(world, this.content, e) ||
        units.tier[held.slot] !== (held.fighter ? FIRST_TIER : 0) ||
        // An Anger's lapse is re-read at the next build, so the class of its holder may lag until then.
        (!world.has(e, Anger) && held.wild !== wildClassOf(world, this.content, 0, e, unowned))
      ) {
        return [`combatUnitLayer holds a stale entry for unit ${e} - it changed without a feed entry`];
      }
    }
    for (let e = 0 as Entity; e < this.units.length; e++) {
      if (this.units[e] !== undefined && !pending.has(e) && !isCombatant(world, e))
        return [`combatUnitLayer still holds ${e}, no longer a unit`];
    }
    return this.verifyTallies();
  }

  private verifyTallies(): string[] {
    const fresh = new Map<CoarseCell, { count: number; tallies: UnitTallies }>();
    for (const held of this.units) {
      if (held === undefined) continue;
      let tally = fresh.get(held.cell);
      if (tally === undefined) {
        tally = { count: 0, tallies: emptyUnitTallies() };
        fresh.set(held.cell, tally);
      }
      tally.count++;
      tallyUnit(tally.tallies, held.bit, held.wild, held.fighter, 1);
    }
    for (const cell of this.cells) {
      if (cell === undefined) continue;
      const { count, tallies } = fresh.get(cell) ?? { count: 0, tallies: emptyUnitTallies() };
      if (
        cell.units.count !== count ||
        cell.unitPassive !== tallies.unitPassive ||
        cell.unitHostileAnimal !== tallies.unitHostileAnimal ||
        cell.unitUndiscounted !== tallies.unitUndiscounted ||
        cell.unitOwnerMask !== tallies.unitOwnerMask ||
        cell.unitFighterMask !== tallies.unitFighterMask ||
        cell.unitFighterUnowned !== tallies.unitFighterUnowned ||
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

  /** `cell`, listed for the next build's reset. */
  private touchForBuild(cell: CoarseCell): CoarseCell {
    if (!cell.builtOn) {
      cell.builtOn = true;
      this.builtCells[this.builtCount++] = cell;
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
        undiscounted: 0,
        ownerMask: 0,
        bodies: memberList(),
        units: memberList(),
        bodyBase: 0,
        baseTotal: 0,
        baseUndiscounted: 0,
        baseOwnerMask: 0,
        unitPassive: 0,
        unitHostileAnimal: 0,
        unitUndiscounted: 0,
        unitOwners: new Array<number>(MAX_PLAYERS).fill(0),
        unitOwnerMask: 0,
        unitFighters: new Array<number>(MAX_PLAYERS).fill(0),
        unitFighterMask: 0,
        unitFighterUnowned: 0,
        towerMask: 0,
        towerUnowned: false,
        bodyTiersAt: 0,
        firingMask: 0,
        firingUnowned: false,
        firingAt: 0,
        buildTotal: 0,
        buildUndiscounted: 0,
        buildOwnerMask: 0,
        countedLast: null,
        builtOn: false,
        nearMask: 0,
        nearUndiscounted: false,
        nearDirty: false,
      };
      this.cells[i] = cell;
      if (this.nearCells !== null) {
        cell.nearDirty = true;
        this.nearDirtyCells[this.nearDirtyCount++] = cell;
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

function buildingEntry(world: World, ctx: MapContext, terrain: TerrainGraph, b: Entity): BuildingEntry {
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
 * reap stays with the attacker pass; the next build re-reads the class. An animal holding a target stays
 * hostile past its anger, as `pressesWildAttack` reads it; one whose target just fell over-counts as hostile,
 * which only costs a seeker its early-out.
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
  if (anger !== undefined && tick < anger.until) return 'hostile';
  return world.tryGet(e, Engagement)?.target !== undefined ? 'hostile' : 'passive';
}

/** Remove every entry of `e` from `cell`'s building share, keeping the others in order. */
function dropBodies(cell: CoarseCell, e: Entity): void {
  const list = cell.bodies;
  let kept = 0;
  for (let i = 0; i < cell.bodyBase; i++) {
    const member = list.members[i];
    if (member === e || member === undefined) continue;
    if (kept !== i) {
      list.members[kept] = member;
      list.x[kept] = list.x[i] ?? 0;
      list.y[kept] = list.y[i] ?? 0;
      list.bit[kept] = list.bit[i] ?? 0;
      list.tier[kept] = list.tier[i] ?? 0;
    }
    kept++;
  }
  list.count = kept;
  cell.bodyBase = kept;
}

/** Re-count `cell`'s building share from its entries: a building's nodes in one cell sit together, so each
 *  run of one member is one building. */
function tallyBase(cell: CoarseCell): void {
  const { members, bit } = cell.bodies;
  let total = 0;
  let undiscounted = 0;
  let ownerMask = 0;
  let last: Entity | undefined;
  for (let i = 0; i < cell.bodyBase; i++) {
    const member = members[i];
    if (member === last) continue;
    last = member;
    total++;
    const memberBit = bit[i] ?? 0;
    if (memberBit !== 0) ownerMask |= memberBit;
    else undiscounted++;
  }
  cell.baseTotal = total;
  cell.baseUndiscounted = undiscounted;
  cell.baseOwnerMask = ownerMask;
}

function bodyEntryKey(e: Entity, x: number, y: number): string {
  return `${e}:${x}:${y}`;
}

/** A cell's building share as {@link CombatGrid.verify} re-derives it. */
interface BaseTally {
  total: number;
  undiscounted: number;
  ownerMask: number;
  nodes: number;
}

function emptyBaseTally(): BaseTally {
  return { total: 0, undiscounted: 0, ownerMask: 0, nodes: 0 };
}

function memberList(): MemberList {
  return { count: 0, members: [], x: [], y: [], bit: [], tier: [] };
}

function push(list: MemberList, e: Entity, x: number, y: number, bit: number, tier: number): void {
  const i = list.count++;
  list.members[i] = e;
  list.x[i] = x;
  list.y[i] = y;
  list.bit[i] = bit;
  list.tier[i] = tier;
}

/** A cell's unit layer share. */
type UnitTallies = Pick<
  CoarseCell,
  | 'unitPassive'
  | 'unitHostileAnimal'
  | 'unitUndiscounted'
  | 'unitOwners'
  | 'unitOwnerMask'
  | 'unitFighters'
  | 'unitFighterMask'
  | 'unitFighterUnowned'
>;

function emptyUnitTallies(): UnitTallies {
  return {
    unitPassive: 0,
    unitHostileAnimal: 0,
    unitUndiscounted: 0,
    unitOwners: new Array<number>(MAX_PLAYERS).fill(0),
    unitOwnerMask: 0,
    unitFighters: new Array<number>(MAX_PLAYERS).fill(0),
    unitFighterMask: 0,
    unitFighterUnowned: 0,
  };
}

/** Add (`sign` 1) or remove (-1) one unit's share of `cell`'s unit tallies. */
function tallyUnit(cell: UnitTallies, bit: number, wild: WildClass, fighter: boolean, sign: 1 | -1): void {
  if (wild === 'passive') cell.unitPassive += sign;
  else if (wild === 'hostile') cell.unitHostileAnimal += sign;
  if (bit === 0) {
    if (wild !== 'passive') cell.unitUndiscounted += sign;
    if (fighter) cell.unitFighterUnowned += sign;
    return;
  }
  const player = playerOfBit(bit);
  const owned = (cell.unitOwners[player] ?? 0) + sign;
  cell.unitOwners[player] = owned;
  if (owned > 0) cell.unitOwnerMask |= bit;
  else cell.unitOwnerMask &= ~bit;
  if (!fighter) return;
  const fighters = (cell.unitFighters[player] ?? 0) + sign;
  cell.unitFighters[player] = fighters;
  if (fighters > 0) cell.unitFighterMask |= bit;
  else cell.unitFighterMask &= ~bit;
}

/** Whether unit `e` is a person of a fighting trade, as `isFighterTarget` reads a first-tier target. */
function isFighterUnit(world: World, content: ContentSet, e: Entity): boolean {
  return world.has(e, Person) && isFighterJob(content, world.get(e, Settler).jobType);
}

export function coarseOf(node: number): number {
  return Math.floor(node / COARSE_CELL_NODES);
}
