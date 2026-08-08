import type { FogView, WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { FogGhostStore, fogTileVisible } from '../../data/fog/index.js';
import type { Viewport } from '../../data/projection/index.js';
import { FogLayer } from '../overlays/index.js';
import type { PoolFrame } from '../sprite-pool/index.js';

/**
 * The viewer's fog as one owner: every consumer reads the same `FogView` within a frame, so they cannot
 * disagree about a cell.
 */

export type FogPoolFrame = Pick<PoolFrame, 'staticRefs' | 'fogVisible' | 'ghosts'>;

export class WorldFog {
  private readonly wash = new FogLayer();
  private view: FogView | null = null;
  private readonly ghosts = new FogGhostStore();
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

  adoptGhost(ref: number): void {
    this.ghosts.adopt(ref);
  }

  /** Live view: the caller keeps mutating this same set as nodes are first worked and never re-passes it. */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.staticRefs = refs;
  }

  /** Recomposite the wash for one frame and return the pool's fog inputs. Both passes cache on the mask
   *  generation, so a steady frame does no work. */
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
