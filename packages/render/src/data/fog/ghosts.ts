import {
  type EntitySnapshot,
  entitiesWith,
  entityById,
  FOG_STATE,
  type FogView,
  fogSettings,
  positionedWithin,
  scanChangedBytes,
  TILE_BUCKET_SIZE,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ONE } from '../projection/index.js';
import type { DrawKind, EntityKind, StaticDrawFields } from '../scene/draw-item.js';
import { assignPalisadeFields, palisadeLayoutOf } from '../scene/palisades/connections.js';
import { assignStaticFields, classify, readPosition } from '../scene/snapshot-readers/index.js';
import type { ElevationField } from '../terrain/index.js';
import { fogCellOfTile } from './mask.js';

/**
 * The viewer's remembered statics: a building, wall, resource node, stump, chest, goods heap or vehicle
 * that was once seen keeps drawing on explored ground, frozen at its last-seen state until the player
 * re-sees the cell (a vehicle stays where it was last seen, like a building). Render-side and per local
 * viewer only - the sim reads its own masks, so determinism is untouched. Authored approximation: the
 * original never un-sees ground (the classic map without fog of war), so it has no ghosts.
 */

type FogGhostKind = Extract<
  DrawKind,
  'building' | 'palisade' | 'resource' | 'stump' | 'chest' | 'stockpile' | 'vehicle'
>;

/** One remembered static, frozen at its last sighting. Tile coords are floats in tile units. */
export type FogGhost = Readonly<StaticDrawFields> & {
  readonly ref: number;
  readonly kind: FogGhostKind;
  readonly tileX: number;
  readonly tileY: number;
  /** Screen px a staggered palisade draws beside its node. */
  readonly shiftX?: number;
  /** The `Owner.player` at the sighting, which the minimap colours the memory by. */
  readonly owner?: number;
};

/** One seat's memory as plain data, for a save to carry across a restore. */
export interface FogGhostMemory {
  readonly player: number;
  readonly ghosts: readonly FogGhost[];
  /** Whether the memory already holds the known-terrain seed of natural objects. */
  readonly reconSeeded: boolean;
}

/** The remembered buildings and vehicles, the statics the minimap marks. */
export interface RememberedMarkers {
  /** The drawable remembered buildings and vehicles, appended to `out` in arbitrary order. */
  markers(out: FogGhost[]): FogGhost[];
}

/** The remembered statics a scene build draws: the fog ghost store, or a fixed list in a test. */
export interface GhostSource {
  /** Bumps whenever {@link within} or {@link has} may answer differently. */
  readonly version: number;
  /** The drawable ghosts whose tile may lie in `box` (a superset: the caller culls each), appended to
   *  `out` in arbitrary order; no box = every drawable ghost. */
  within(box: TileBox | undefined, out: FogGhost[]): FogGhost[];
  /** Whether `ref` has a drawable ghost, on screen or not. */
  has(ref: number): boolean;
}

function isGhostKind(kind: EntityKind | null): kind is FogGhostKind {
  return (
    kind === 'building' ||
    kind === 'palisade' ||
    kind === 'resource' ||
    kind === 'stump' ||
    kind === 'chest' ||
    kind === 'stockpile' ||
    kind === 'vehicle'
  );
}

/** A `stockpile` memory is a heap of goods; a delivery flag or an emptied pile names no good and is
 *  no static to remember. A wall keeps its posts and stagger as the snapshot's layout draws them. */
function capture(
  snapshot: WorldSnapshot,
  elevation: ElevationField | undefined,
  id: number,
  kind: FogGhostKind,
  components: Readonly<Record<string, unknown>>,
): FogGhost | null {
  const pos = readPosition(components);
  if (pos === null) return null;
  const ghost: {
    -readonly [K in keyof FogGhost]: FogGhost[K];
  } = { ref: id, kind, tileX: pos.x / ONE, tileY: pos.y / ONE };
  if (kind === 'palisade') {
    const shiftX = assignPalisadeFields(ghost, id, components, palisadeLayoutOf(snapshot, elevation));
    if (shiftX !== 0) ghost.shiftX = shiftX;
  } else assignStaticFields(ghost, kind, components);
  if (kind === 'stockpile' && ghost.goodType === undefined) return null;
  const owner = (components.Owner as { player?: unknown } | undefined)?.player;
  if (typeof owner === 'number') ghost.owner = owner;
  return ghost;
}

/** A known-terrain view's seeded kinds: the map's placed natural objects, never player intel. */
function isSeededKind(kind: FogGhostKind): boolean {
  return kind === 'resource' || kind === 'stump' || kind === 'chest' || kind === 'stockpile';
}

/** Every component {@link classify} reads as a seeded kind. */
const SEEDED_COMPONENTS = ['Resource', 'Stump', 'Chest', 'OpenedChest', 'Stockpile'] as const;

/** Every component {@link classify} reads as a building or a wall. */
const START_COMPONENTS = ['Building', 'Palisade'] as const;

/** The buildings and walls standing in `snapshot`, for a known-terrain view of a multiplayer map to show
 *  at its start: the quarters every seat starts in, as the map lays them out. */
export function startBuildingGhosts(snapshot: WorldSnapshot, elevation?: ElevationField): FogGhost[] {
  const ghosts: FogGhost[] = [];
  for (const name of START_COMPONENTS) {
    for (const entity of entitiesWith(snapshot, name)) {
      const kind = classify(entity.components);
      if (kind !== 'building' && kind !== 'palisade') continue;
      const ghost = capture(snapshot, elevation, entity.id, kind, entity.components);
      if (ghost !== null) ghosts.push(ghost);
    }
  }
  return ghosts;
}

/** Tile columns a fog cell reaches past its own index on either side: the row stagger shifts the cell
 *  grid by up to half a tile against the tile columns (see {@link fogCellOfTile}). */
const CELL_REACH_TILES = 1;

/** The cell index of a tile outside the view's mask, where no ghost ever draws. */
const OFF_MASK = -1;

interface GhostRecord {
  readonly ghost: FogGhost;
  /** Row-major index of the fog cell holding the ghost's tile. */
  readonly cell: number;
}

interface MutableTileBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The viewer's memory, maintained per fog change. A mask rebuild is diffed against the last view: by
 * comparing the two views' mask bytes a word at a time when both carry them, else state by state, so
 * this pass costs the cell count per generation, never the entity count. A cell turning VISIBLE forgets
 * its records, since the live entities draw there; a cell leaving VISIBLE captures the ghost-kind
 * entities standing in it now. Approximation: the memory freezes at the update that lost sight, up to
 * one vision cadence after the last generation that still saw the cell, so a static that changed or died
 * in that span is remembered as it stands at the loss. A draw query walks only the records under its box.
 *
 * The memory is one seat's. A fresh view (the first update, one after `clear`, or a seat switch) only
 * records the cell states: what that seat saw before was never recorded here, so its explored ground
 * stays bare until re-seen (approximation of the original's per-player memory). `FogMemories` keeps
 * one store per seat, so a seat's memory outlives the views of the others. A mode change is an
 * ordinary diff. The start of a known-terrain stretch seeds every natural resource, stump, chest and
 * goods heap wherever it stands, as that view shows the map's placed objects; buildings, walls and
 * vehicles stay intel the player has to see for himself, save a multiplayer map's start buildings
 * ({@link knowStartBuildings}).
 */
export class FogGhostStore implements GhostSource, RememberedMarkers {
  private readonly records = new Map<number, GhostRecord>();
  /** The refs of {@link records} the minimap marks, so a replot never walks the remembered nature. */
  private readonly markerRefs = new Set<number>();
  private buckets = new TileBuckets<GhostRecord>();
  private readonly refsByCell = new Map<number, Set<number>>();
  /** The last view's `FOG_STATE` per cell, row-major. */
  private states = new Uint8Array(0);
  /** The mask bytes {@link states} were read from, when the view carried them. */
  private lastCells: Uint8Array | undefined;
  private cellsWide = 0;
  private cellsHigh = 0;
  private lastGeneration = -1;
  private lastPlayer: number | null = null;
  private lastMode: FogView['mode'] | null = null;
  /** Whether the current known-terrain stretch already seeded natural resources. */
  private reconSeeded = false;
  /** The start buildings the next update remembers (see {@link knowStartBuildings}); outlives `clear`. */
  private startBuildings: readonly FogGhost[] | null = null;
  /** A saved memory waiting for its seat's first view. */
  private pendingRestore: FogGhostMemory | null = null;
  /** Whether a capture keeps the refs the map-object layer draws too (see {@link recordStatics}). */
  private recordsStatics = false;
  /** The map-object layer's refs as of the last update, which draw there instead of here. */
  private staticRefs: ReadonlySet<number> | undefined;
  private contentVersion = 0;
  /** Reused buffers, emptied after each use so they hold nothing past it. */
  private readonly leavingCells = new Set<number>();
  private readonly entityScratch: EntitySnapshot[] = [];
  private readonly recordScratch: GhostRecord[] = [];

  get version(): number {
    return this.contentVersion;
  }

  /** Remember a multiplayer map's start buildings ({@link startBuildingGhosts}) still standing at the
   *  next update, if that view knows the terrain: a memory begun later never shows one already gone.
   *  Spent by the next update under any mode, so a later switch to known terrain shows no buildings
   *  raised since. */
  knowStartBuildings(ghosts: readonly FogGhost[]): void {
    this.startBuildings = ghosts;
  }

  /** Capture the map-object layer's refs as well, drawn here once the layer lets one go. The layer keeps
   *  the drawn seat's memory of the map's placements, so a store kept beside other seats' needs its own
   *  last sight of them: a node another seat saw worked leaves the layer while this one remembers it
   *  whole. A known-terrain seed still leaves them to the layer. */
  recordStatics(): void {
    this.recordsStatics = true;
  }

  /** Start the next view of `memory.player` from a saved memory instead of a blank one. Outlives
   *  `clear`, as {@link knowStartBuildings} does; another seat's first view drops it. */
  restore(memory: FogGhostMemory): void {
    this.pendingRestore = memory;
  }

  /** The memory of the seat last viewed, as plain data; null before any view. */
  memory(): FogGhostMemory | null {
    if (this.lastPlayer === null) return null;
    return {
      player: this.lastPlayer,
      ghosts: [...this.records.values()].map((record) => record.ghost),
      reconSeeded: this.reconSeeded,
    };
  }

  /** Forget the memory and the view it was diffed against, so the next update starts a fresh view. */
  clear(): void {
    this.lastGeneration = -1;
    this.lastPlayer = null;
    this.lastMode = null;
    this.lastCells = undefined;
    this.reconSeeded = false;
    if (this.records.size === 0) return;
    this.records.clear();
    this.markerRefs.clear();
    this.refsByCell.clear();
    this.buckets = new TileBuckets();
    this.contentVersion++;
  }

  /**
   * Advance the memory to `view`; a frame with no mask rebuild, seat switch or mode change is a field
   * compare. Refs in `staticRefs` never draw as ghosts - the retained map-object layer already draws
   * their last-seen state - and are not captured unless {@link recordStatics}. `elevation` is the
   * scene's, so a remembered wall's posts follow the slope its live draw did.
   */
  update(
    snapshot: WorldSnapshot,
    view: FogView,
    staticRefs?: ReadonlySet<number>,
    elevation?: ElevationField,
  ): void {
    const fresh =
      view.player !== this.lastPlayer ||
      view.cellsWide !== this.cellsWide ||
      view.cellsHigh !== this.cellsHigh;
    const remapped = view.generation !== this.lastGeneration || view.mode !== this.lastMode;
    this.staticRefs = staticRefs;
    if (!fresh && !remapped) return;
    if (fresh) {
      this.startView(view);
      const restored = this.pendingRestore;
      this.pendingRestore = null;
      if (restored !== null && restored.player === view.player) {
        for (const ghost of restored.ghosts) this.keep(ghost);
        this.reconSeeded = restored.reconSeeded;
      }
    } else if (remapped) this.diffCells(snapshot, view, staticRefs, elevation);
    this.lastCells = view.cells;

    const terrainKnown = fogSettings(view.mode)?.terrainKnown === true;
    if (!terrainKnown) this.reconSeeded = false;
    else if (!this.reconSeeded) {
      this.seedNature(snapshot, staticRefs, elevation);
      this.reconSeeded = true;
    }
    if (this.startBuildings !== null) {
      if (terrainKnown) {
        for (const ghost of this.startBuildings)
          if (entityById(snapshot, ghost.ref) !== undefined) this.keep(ghost);
      }
      this.startBuildings = null;
    }
    this.lastGeneration = view.generation;
    this.lastPlayer = view.player;
    this.lastMode = view.mode;
  }

  within(box: TileBox | undefined, out: FogGhost[]): FogGhost[] {
    if (box === undefined) {
      for (const record of this.records.values()) if (this.drawable(record)) out.push(record.ghost);
      return out;
    }
    const candidates = this.buckets.within(box, this.recordScratch);
    for (const record of candidates) if (this.drawable(record)) out.push(record.ghost);
    candidates.length = 0;
    return out;
  }

  markers(out: FogGhost[]): FogGhost[] {
    for (const ref of this.markerRefs) {
      const record = this.records.get(ref);
      if (record !== undefined && this.drawable(record)) out.push(record.ghost);
    }
    return out;
  }

  has(ref: number): boolean {
    const record = this.records.get(ref);
    return record !== undefined && this.drawable(record);
  }

  /** Explored ground only: a memory under an unexplored cell stays in the black, and one the map-object
   *  layer still draws stays there. */
  private drawable(record: GhostRecord): boolean {
    return this.states[record.cell] === FOG_STATE.EXPLORED && this.staticRefs?.has(record.ghost.ref) !== true;
  }

  private startView(view: FogView): void {
    this.clear();
    this.cellsWide = view.cellsWide;
    this.cellsHigh = view.cellsHigh;
    const cellCount = view.cellsWide * view.cellsHigh;
    if (this.states.length !== cellCount) this.states = new Uint8Array(cellCount);
    for (let cy = 0; cy < view.cellsHigh; cy++) {
      for (let cx = 0; cx < view.cellsWide; cx++)
        this.states[cy * view.cellsWide + cx] = view.stateAt(cx, cy);
    }
  }

  private diffCells(
    snapshot: WorldSnapshot,
    view: FogView,
    staticRefs: ReadonlySet<number> | undefined,
    elevation: ElevationField | undefined,
  ): void {
    const leaving = this.leavingCells;
    let changed = false;
    const diffCell = (cell: number): void => {
      const cx = cell % this.cellsWide;
      const now = view.stateAt(cx, (cell - cx) / this.cellsWide);
      const was = this.states[cell];
      if (now === was) return;
      this.states[cell] = now;
      changed = true;
      if (now === FOG_STATE.VISIBLE) this.forgetCell(cell);
      else if (was === FOG_STATE.VISIBLE) leaving.add(cell);
    };
    const before = this.lastCells;
    const after = view.cells;
    // Under the same mode only the cells whose bytes moved can read otherwise.
    if (before !== undefined && after !== undefined && view.mode === this.lastMode) {
      scanChangedBytes(before, after, (cell) => {
        diffCell(cell);
        return true;
      });
    } else {
      const cellCount = this.cellsWide * this.cellsHigh;
      for (let cell = 0; cell < cellCount; cell++) diffCell(cell);
    }
    // A cell moving between EXPLORED and UNEXPLORED changes what draws without touching a record.
    if (changed) this.contentVersion++;
    if (leaving.size > 0) this.captureCells(snapshot, staticRefs, elevation);
    leaving.clear();
    this.forgetSightedVehicles(snapshot);
  }

  /** A vehicle's memory stays at the cell it was last seen in, but once the live vehicle stands in sight
   *  anywhere it draws there, so the stale memory goes even while its own cell stays explored. */
  private forgetSightedVehicles(snapshot: WorldSnapshot): void {
    if (this.records.size === 0) return;
    for (const vehicle of entitiesWith(snapshot, 'Vehicle')) {
      if (!this.records.has(vehicle.id)) continue;
      const pos = readPosition(vehicle.components);
      if (pos === null) continue;
      const cell = this.cellOf(pos.x / ONE, pos.y / ONE);
      if (cell !== OFF_MASK && this.states[cell] === FOG_STATE.VISIBLE) this.forget(vehicle.id);
    }
  }

  /** Capture the ghost-kind entities in {@link leavingCells}: one position query per tile bucket of
   *  those cells, over their joint tile box, so a vision edge sweeping a bucket walks it once. */
  private captureCells(
    snapshot: WorldSnapshot,
    staticRefs: ReadonlySet<number> | undefined,
    elevation: ElevationField | undefined,
  ): void {
    const boxes = new Map<number, MutableTileBox>();
    const bucketsWide = Math.ceil(this.cellsWide / TILE_BUCKET_SIZE);
    for (const cell of this.leavingCells) {
      const cx = cell % this.cellsWide;
      const cy = (cell - cx) / this.cellsWide;
      const key = Math.floor(cy / TILE_BUCKET_SIZE) * bucketsWide + Math.floor(cx / TILE_BUCKET_SIZE);
      const minX = cx - CELL_REACH_TILES;
      const maxX = cx + CELL_REACH_TILES;
      const box = boxes.get(key);
      if (box === undefined) boxes.set(key, { minX, minY: cy, maxX, maxY: cy + 1 });
      else {
        box.minX = Math.min(box.minX, minX);
        box.minY = Math.min(box.minY, cy);
        box.maxX = Math.max(box.maxX, maxX);
        box.maxY = Math.max(box.maxY, cy + 1);
      }
    }
    const candidates = this.entityScratch;
    for (const box of boxes.values()) positionedWithin(snapshot, box, candidates);
    // Neighbouring boxes may both return an entity; capturing it twice stores the same record.
    for (const entity of candidates) {
      if (!this.recordsStatics && staticRefs?.has(entity.id)) continue;
      const pos = readPosition(entity.components);
      if (pos === null || !this.leavingCells.has(this.cellOf(pos.x / ONE, pos.y / ONE))) continue;
      const kind = classify(entity.components);
      if (isGhostKind(kind)) this.remember(snapshot, elevation, entity, kind);
    }
    candidates.length = 0;
  }

  /** One walk over the natural kinds' component lists, not over every entity. */
  private seedNature(
    snapshot: WorldSnapshot,
    staticRefs: ReadonlySet<number> | undefined,
    elevation: ElevationField | undefined,
  ): void {
    for (const name of SEEDED_COMPONENTS) {
      for (const entity of entitiesWith(snapshot, name)) {
        if (staticRefs?.has(entity.id)) continue;
        const kind = classify(entity.components);
        if (isGhostKind(kind) && isSeededKind(kind)) this.remember(snapshot, elevation, entity, kind);
      }
    }
  }

  private remember(
    snapshot: WorldSnapshot,
    elevation: ElevationField | undefined,
    entity: EntitySnapshot,
    kind: FogGhostKind,
  ): void {
    const ghost = capture(snapshot, elevation, entity.id, kind, entity.components);
    if (ghost !== null) this.keep(ghost);
  }

  private keep(ghost: FogGhost): void {
    this.forget(ghost.ref);
    const cell = this.cellOf(ghost.tileX, ghost.tileY);
    // On watched ground the live entity draws instead; a record there would double-draw the ref.
    if (cell === OFF_MASK || this.states[cell] === FOG_STATE.VISIBLE) return;
    const record: GhostRecord = { ghost, cell };
    this.records.set(ghost.ref, record);
    if (ghost.kind === 'building' || ghost.kind === 'vehicle') this.markerRefs.add(ghost.ref);
    this.buckets.set(ghost.ref, record, ghost.tileX, ghost.tileY);
    let refs = this.refsByCell.get(cell);
    if (refs === undefined) {
      refs = new Set();
      this.refsByCell.set(cell, refs);
    }
    refs.add(ghost.ref);
    this.contentVersion++;
  }

  private forget(ref: number): void {
    const record = this.records.get(ref);
    if (record === undefined) return;
    this.records.delete(ref);
    this.markerRefs.delete(ref);
    this.buckets.delete(ref);
    const refs = this.refsByCell.get(record.cell);
    refs?.delete(ref);
    if (refs?.size === 0) this.refsByCell.delete(record.cell);
    this.contentVersion++;
  }

  private forgetCell(cell: number): void {
    const refs = this.refsByCell.get(cell);
    if (refs === undefined) return;
    this.refsByCell.delete(cell);
    for (const ref of refs) {
      this.records.delete(ref);
      this.markerRefs.delete(ref);
      this.buckets.delete(ref);
    }
    this.contentVersion++;
  }

  private cellOf(tileX: number, tileY: number): number {
    const { cx, cy } = fogCellOfTile(tileX, tileY);
    if (cx < 0 || cy < 0 || cx >= this.cellsWide || cy >= this.cellsHigh) return OFF_MASK;
    return cy * this.cellsWide + cx;
  }
}
