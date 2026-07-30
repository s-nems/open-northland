import type { FogView, WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { FogGhostStore, fogTileVisible } from '../../data/fog/index.js';
import type { Viewport } from '../../data/projection/index.js';
import { FogLayer } from '../overlays/index.js';
import type { PoolFrame } from '../sprite-pool/index.js';

/**
 * The viewer's fog of war as one owner: the wash over the ground ({@link FogLayer}), the statics
 * remembered behind it ({@link FogGhostStore}), and the entities the retained map-object layer draws
 * instead of the sprite pool. They belong together because all three read the same {@link FogView}
 * within a frame, so the wash, the sprite cull and the tall-object gate cannot disagree about a cell.
 */

/** The fog-derived slice of a frame's {@link PoolFrame}: what the sprite pool culls and remembers with. */
export type FogPoolFrame = Pick<PoolFrame, 'staticRefs' | 'fogVisible' | 'ghosts'>;

export class WorldFog {
  private readonly wash = new FogLayer();
  private view: FogView | null = null;
  private readonly ghosts = new FogGhostStore();
  /** Entities the static map-object layer draws (a decoded map's virgin nodes), skipped by the pool's
   *  scene build and by ghost capture, since the retained object on explored ground IS their ghost. */
  private staticRefs: ReadonlySet<number> | undefined;
  /** Bound once: the pool's cull predicate reads the live view, so a frame allocates no closure. */
  private readonly visibleAt = (tileX: number, tileY: number): boolean =>
    this.view === null || fogTileVisible(this.view, tileX, tileY);

  get container(): Container {
    return this.wash.container;
  }

  /** The tall map-object gate: this view's per-cell state, `undefined` while fog is off. */
  get cellStateAt(): FogView['stateAt'] | undefined {
    return this.view?.stateAt;
  }

  setView(view: FogView | null): void {
    this.view = view;
  }

  /** See {@link FogGhostStore.adopt}. */
  adoptGhost(ref: number): void {
    this.ghosts.adopt(ref);
  }

  /** Live view: the caller mutates this same set as nodes are first worked and never re-passes it. Its
   *  event handler runs before the frame's draw, so a mid-frame mutation cannot be observed. */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.staticRefs = refs;
  }

  /** Recomposite the wash for one frame and return the pool's fog inputs. Both passes are keyed on the
   *  mask generation, so a steady frame does no work; fog off drops the memory. */
  update(snapshot: WorldSnapshot, vp: Viewport): FogPoolFrame {
    const view = this.view;
    const staticRefs = this.staticRefs;
    this.wash.update(view, vp);
    if (view === null) {
      this.ghosts.clear();
      return staticRefs === undefined ? {} : { staticRefs };
    }
    const ghosts = this.ghosts.update(snapshot, view, staticRefs);
    return {
      ...(staticRefs !== undefined ? { staticRefs } : {}),
      fogVisible: this.visibleAt,
      ...(ghosts.length > 0 ? { ghosts } : {}),
    };
  }

  destroy(): void {
    this.wash.destroy();
  }
}
