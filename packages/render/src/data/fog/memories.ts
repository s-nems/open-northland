import type { FogView, WorldSnapshot } from '@open-northland/sim';
import type { RoadChanges } from '../scene/road-shards.js';
import type { ElevationField } from '../terrain/index.js';
import {
  type FogGhost,
  type FogGhostMemory,
  FogGhostStore,
  type RememberedMarkers,
  startBuildingGhosts,
} from './ghosts.js';
import { type SeenRoadNetwork, SeenRoads } from './seen-roads.js';
import { ViewSight } from './sight.js';

/** One seat's fog memory as plain data: its remembered statics, whose `player` names the seat (the
 *  players' sight together as `SHARED_SIGHT_VIEWER`), and the road nodes it believes laid. */
export interface SeatFogMemory {
  readonly statics: FogGhostMemory;
  readonly roads: readonly number[];
}

/** The viewer's fog memory as plain data: every seat it remembers, drawn or not. */
export interface ViewerFogMemory {
  readonly memories: readonly SeatFogMemory[];
}

/** One seat's memory, keyed by its views' `FogView.player`. */
interface SeatMemory {
  readonly ghosts: FogGhostStore;
  readonly roads: SeenRoads;
  /** The sight the road memory waits on. */
  readonly sight: ViewSight;
  view: FogView;
  /** Whether the road memory has taken the network as it stood at its start. */
  roadsStarted: boolean;
}

/**
 * Every viewed seat's memory of the fog, kept apart: its remembered statics and the road network it
 * believes laid. A memory advances whenever its seat's view is given, drawn or not, so a spectator who
 * switches to a seat sees what that seat remembers. One view at a time is drawn; with none drawn (fog
 * off, or a spectator's whole map) the ground shows the live network. Render-side only, like the
 * memories it holds.
 *
 * The map-object layer stays one, deferring its changes to the drawn view's sight, so once other seats
 * are remembered a seat's memory also keeps the layer's nodes (`FogGhostStore.recordStatics`).
 * Approximation: the layer follows the drawn view alone. A node worked out of the drawn view's sight
 * keeps its whole quad for every seat until a drawn view sees it; one a seat never saw, on terrain it
 * knows from the start, leaves that seat's view once a drawn view saw it worked; scenery cleared under a
 * building goes the same way.
 */
export class FogMemories implements SeenRoadNetwork {
  private readonly bySeat = new Map<number, SeatMemory>();
  private drawn: SeatMemory | null = null;
  /** The drawn memory changed since the last road sync, so the ground swaps networks wholesale. */
  private switched = true;
  /** The road network as it stands. */
  private readonly live = new Set<number>();
  /** The road nodes the ground draws, which {@link nodes} answers. */
  private readonly shown = new Set<number>();
  private revisionValue = 0;
  /** Saved memories waiting for their seat's first view, by `FogView.player`. */
  private readonly restored = new Map<number, SeatFogMemory>();
  private startBuildingsPending = false;
  /** A multiplayer map's start buildings, captured at the first update for every memory to know. */
  private startBuildings: readonly FogGhost[] | null = null;
  private nodeWidthValue: number;
  /** Whether other seats' views were given beside the drawn one. */
  private watching = false;

  /** The drawn memory's remembered buildings and vehicles, for the minimap to show what the world
   *  shows: the same object across switches. */
  readonly markers: RememberedMarkers = {
    markers: (out) => this.drawn?.ghosts.markers(out) ?? out,
  };

  constructor(nodeWidth: number) {
    this.nodeWidthValue = nodeWidth;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get nodes(): ReadonlySet<number> {
    return this.shown;
  }

  /** The drawn memory's statics, for the scene build; null while none is drawn. */
  get drawnGhosts(): FogGhostStore | null {
    return this.drawn?.ghosts ?? null;
  }

  /** Another map's lattice starts every memory over, a restored one too; a terrain edit keeps them. */
  setNodeWidth(nodeWidth: number): void {
    if (nodeWidth === this.nodeWidthValue) return;
    this.nodeWidthValue = nodeWidth;
    this.forget();
    this.restored.clear();
    this.startBuildings = null;
    this.live.clear();
    this.shown.clear();
    this.revisionValue++;
  }

  /** Capture a multiplayer map's start buildings at the first update, for every seat's memory to know;
   *  see {@link FogGhostStore.knowStartBuildings}. */
  knowStartBuildings(): void {
    this.startBuildingsPending = true;
  }

  /** Start each saved seat's memory from `memory` at that seat's first view; call before the game's
   *  first frame. */
  restore(memory: ViewerFogMemory): void {
    for (const seat of memory.memories) this.restored.set(seat.statics.player, seat);
  }

  /** Every memory as plain data, a restored one whose seat was not viewed since as it was saved. */
  saved(): ViewerFogMemory {
    const memories: SeatFogMemory[] = [...this.restored.values()];
    for (const memory of this.bySeat.values()) {
      const statics = memory.ghosts.memory();
      if (statics !== null) memories.push({ statics, roads: [...memory.roads.nodes] });
    }
    return { memories };
  }

  /**
   * Take the frame's views: `drawn` the one shown, `remembered` the others whose memories advance
   * unseen (it may repeat the drawn one). No view at all is fog off, which starts every memory over.
   */
  setViews(drawn: FogView | null, remembered: readonly FogView[]): void {
    if (drawn === null && remembered.length === 0) {
      this.forget();
      return;
    }
    if (remembered.length > 0 && !this.watching) {
      this.watching = true;
      for (const memory of this.bySeat.values()) memory.ghosts.recordStatics();
    }
    for (const view of remembered) this.take(view);
    const next = drawn === null ? null : this.take(drawn);
    if (next !== this.drawn) {
      this.drawn = next;
      this.switched = true;
    }
  }

  /** Advance every memory's statics to its last view. A steady view is a field compare. */
  updateGhosts(
    snapshot: WorldSnapshot,
    staticRefs: ReadonlySet<number> | undefined,
    elevation: ElevationField | undefined,
  ): void {
    if (this.startBuildingsPending) {
      this.startBuildingsPending = false;
      this.startBuildings = startBuildingGhosts(snapshot, elevation);
      for (const memory of this.bySeat.values()) memory.ghosts.knowStartBuildings(this.startBuildings);
    }
    for (const memory of this.bySeat.values())
      memory.ghosts.update(snapshot, memory.view, staticRefs, elevation);
  }

  /** Take the live network's `changes` into every memory; answers what the drawn network gains and
   *  loses, or null when it holds. */
  syncRoads(changes: RoadChanges | null): RoadChanges | null {
    for (const node of changes?.removed ?? []) this.live.delete(node);
    for (const node of changes?.added ?? []) this.live.add(node);
    let drawnChanges = changes;
    for (const memory of this.bySeat.values()) {
      // A memory begun mid-game knows the network as it stands, as a game start knows its own.
      const given = memory.roadsStarted ? changes : { added: [...this.live], removed: [] };
      memory.roadsStarted = true;
      const shown = memory.roads.update(given, memory.sight);
      if (memory === this.drawn) drawnChanges = shown;
    }
    const answer = this.switched ? this.swapTo(this.drawn?.roads.nodes ?? this.live) : drawnChanges;
    this.switched = false;
    if (answer === null || (answer.added.length === 0 && answer.removed.length === 0)) return null;
    for (const node of answer.removed) this.shown.delete(node);
    for (const node of answer.added) this.shown.add(node);
    this.revisionValue++;
    return answer;
  }

  private take(view: FogView): SeatMemory {
    let memory = this.bySeat.get(view.player);
    if (memory === undefined) {
      memory = this.start(view);
      this.bySeat.set(view.player, memory);
    }
    memory.view = view;
    memory.sight.set(view);
    return memory;
  }

  private start(view: FogView): SeatMemory {
    const memory: SeatMemory = {
      ghosts: new FogGhostStore(),
      roads: new SeenRoads(this.nodeWidthValue),
      sight: new ViewSight(),
      view,
      roadsStarted: false,
    };
    if (this.watching) memory.ghosts.recordStatics();
    if (this.startBuildings !== null) memory.ghosts.knowStartBuildings(this.startBuildings);
    const restored = this.restored.get(view.player);
    if (restored !== undefined) {
      this.restored.delete(view.player);
      memory.ghosts.restore(restored.statics);
      memory.roads.restore(restored.roads);
    }
    return memory;
  }

  /** The changes that turn the drawn network into `target`. */
  private swapTo(target: ReadonlySet<number>): RoadChanges {
    const added: number[] = [];
    const removed: number[] = [];
    for (const node of this.shown) if (!target.has(node)) removed.push(node);
    for (const node of target) if (!this.shown.has(node)) added.push(node);
    return { added, removed };
  }

  private forget(): void {
    if (this.bySeat.size === 0) return;
    this.bySeat.clear();
    this.drawn = null;
    this.switched = true;
  }
}
