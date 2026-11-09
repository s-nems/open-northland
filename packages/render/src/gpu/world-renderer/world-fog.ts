import type { FogView, WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import {
  FogMemories,
  fogTileExplored,
  fogTileVisible,
  type RememberedMarkers,
  type SeenRoadNetwork,
  type Sight,
  type ViewerFogMemory,
  ViewSight,
} from '../../data/fog/index.js';
import type { Viewport } from '../../data/projection/index.js';
import type { RoadChanges } from '../../data/scene/road-shards.js';
import type { ElevationField } from '../../data/terrain/index.js';
import { FogLayer, type FogWashMask } from '../overlays/index.js';
import type { PoolFrame } from '../sprite-pool/index.js';

/**
 * The viewer's fog as one owner: every consumer reads the same `FogView` within a frame, so they cannot
 * disagree about a cell.
 */

export type FogPoolFrame = Pick<PoolFrame, 'staticRefs' | 'fogVisible' | 'fogEpoch' | 'ghosts'>;

export class WorldFog {
  private readonly wash = new FogLayer();
  private view: FogView | null = null;
  private readonly drawnSight = new ViewSight();
  private readonly memories = new FogMemories(0);
  private staticRefs: ReadonlySet<number> | undefined;
  /** Bumped when the cull's answers may change: a mask rebuild (`generation`), a seat switch
   *  (`player`) or a mode remap of `stateAt`. Consumers key their per-frame caches on it instead of
   *  re-probing a steady mask. */
  private epoch = 0;
  private lastGeneration = -1;
  private lastPlayer: number | null = null;
  private lastMode: FogView['mode'] | null = null;
  /** Bound once: the pool's cull predicate reads the live view, so a frame allocates no closure. */
  private readonly visibleAt = (tileX: number, tileY: number): boolean =>
    this.view === null || fogTileVisible(this.view, tileX, tileY);

  private readonly exploredAt = (tileX: number, tileY: number): boolean =>
    this.view === null || fogTileExplored(this.view, tileX, tileY);

  /** The explored-ground gate for marks that lie on the land like its objects; unset while fog is off. */
  get exploredGate(): ((tileX: number, tileY: number) => boolean) | undefined {
    return this.view === null ? undefined : this.exploredAt;
  }

  get container(): Container {
    return this.wash.container;
  }

  /** The wash's texture and band, rewritten in place as the fog redraws. */
  get washMask(): FogWashMask {
    return this.wash.mask;
  }

  /** The drawn view's sight, whichever seat it is. */
  get sight(): Sight {
    return this.drawnSight;
  }

  /** The tall map-object gate: this view's per-cell state, `undefined` while fog is off. */
  get cellStateAt(): FogView['stateAt'] | undefined {
    return this.view?.stateAt;
  }

  /** `view` is drawn; `remembered` are the other seats' views, whose memories advance unseen. */
  setView(view: FogView | null, remembered: readonly FogView[] = []): void {
    this.drawnSight.set(view);
    this.view = view;
    this.memories.setViews(view, remembered);
  }

  /** Another map's lattice starts the memories over. */
  setRoadLattice(nodeWidth: number): void {
    this.memories.setNodeWidth(nodeWidth);
  }

  knowStartBuildings(): void {
    this.memories.knowStartBuildings();
  }

  restoreMemory(memory: ViewerFogMemory): void {
    this.memories.restore(memory);
  }

  savedMemory(): ViewerFogMemory {
    return this.memories.saved();
  }

  /** The drawn memory's remembered statics, as of the last {@link update}. */
  get markers(): RememberedMarkers {
    return this.memories.markers;
  }

  /** The road network as the drawn view last saw it. */
  get roads(): SeenRoadNetwork {
    return this.memories;
  }

  /** Take the live network's changes; answers what the drawn network gains and loses, or null. */
  syncRoads(changes: RoadChanges | null): RoadChanges | null {
    return this.memories.syncRoads(changes);
  }

  /** Live view: the caller keeps shrinking this same set as nodes are first worked and never
   *  re-passes it (the handover seam's shrink-only contract). */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.staticRefs = refs;
  }

  /** Recomposite the wash for one frame and return the pool's fog inputs. Both passes cache on the mask
   *  generation, so a steady frame does no work. */
  update(snapshot: WorldSnapshot, vp: Viewport, elevation?: ElevationField): FogPoolFrame {
    const view = this.view;
    const staticRefs = this.staticRefs;
    this.wash.update(view, vp, elevation);
    this.memories.updateGhosts(snapshot, staticRefs, elevation);
    const ghosts = this.memories.drawnGhosts;
    if (view === null || ghosts === null) return staticRefs === undefined ? {} : { staticRefs };
    if (
      view.generation !== this.lastGeneration ||
      view.player !== this.lastPlayer ||
      view.mode !== this.lastMode
    ) {
      this.epoch++;
      this.lastGeneration = view.generation;
      this.lastPlayer = view.player;
      this.lastMode = view.mode;
    }
    return {
      ...(staticRefs !== undefined ? { staticRefs } : {}),
      fogVisible: this.visibleAt,
      fogEpoch: this.epoch,
      ghosts,
    };
  }

  destroy(): void {
    this.wash.destroy();
  }
}
