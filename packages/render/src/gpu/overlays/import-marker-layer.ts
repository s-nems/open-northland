import { Container, Sprite, type TextureSource } from 'pixi.js';
import type { Viewport } from '../../data/projection/index.js';
import type { ImportMarker } from '../../data/scene/import-markers.js';
import { OVERHEAD_BASE_GAP, type OverheadColumn } from '../../data/scene/overhead-column.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';
import { type MarkAnchorFrame, markAnchor } from './entity-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The scripted import marker - the icon a campaign hangs over the person it sends the player to. The
 * art is decoded from the over-head icon sheet the app binds; this layer draws it over each marked
 * person the sprite pool drew this frame, so fog, a roof or the screen edge hides it with him.
 *
 * The icon tops the over-head column (`OverheadColumn`), over the stars, the life heart and the need
 * bubble he wears.
 */

/** The decoded icon and the jobs that never wear it. */
export interface ImportMarkerGfx {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly exemptJobs: ReadonlySet<number>;
}

interface MarkerGfx extends ImportMarkerGfx {
  readonly textures: TextureCache;
}

export interface ImportMarkerFrame extends MarkAnchorFrame {
  /** The marked people outside the exempt jobs (`importMarkersOf`). */
  readonly markers: readonly ImportMarker[];
  readonly column?: OverheadColumn | undefined;
}
/** Feet→head estimate (world px), used only by the anchor's fallback. */
const HEAD_ABOVE_FEET = 40;

export class ImportMarkerLayer {
  readonly container = new Container();
  /** One marker per drawn person; never rebuilt, only moved. */
  private readonly markers = new Map<number, Sprite>();
  private readonly seen = new Set<number>();
  private gfx: MarkerGfx | undefined;

  /** The jobs that never wear the marker; undefined while no icon draws. */
  get exemptJobs(): ReadonlySet<number> | undefined {
    return this.gfx?.exemptJobs;
  }

  /** Provide (or clear) the decoded icon. Clearing retires every live marker. */
  setGfx(gfx: MarkerGfx | undefined): void {
    this.gfx = gfx;
    for (const sprite of this.markers.values()) sprite.destroy();
    this.markers.clear();
  }

  draw(frame: ImportMarkerFrame, viewport?: Viewport): void {
    this.seen.clear();
    const gfx = this.gfx;
    if (gfx !== undefined) {
      for (const marker of frame.markers) {
        // Drawn only over a person the pool drew: the bounds exist for this frame's sprites alone.
        if (frame.drawn?.boundsOf(marker.id) === undefined) continue;
        const head = markAnchor(frame, marker, HEAD_ABOVE_FEET, viewport);
        if (head === undefined) continue;
        let sprite = this.markers.get(marker.id);
        if (sprite === undefined) {
          sprite = new Sprite(gfx.textures.get(gfx.source, gfx.frame));
          // The bob's own hot spot, which sits at its tail.
          sprite.anchor.set(-gfx.frame.offsetX / gfx.frame.width, -gfx.frame.offsetY / gfx.frame.height);
          this.container.addChild(sprite);
          this.markers.set(marker.id, sprite);
        }
        sprite.position.set(
          head.x,
          head.y - OVERHEAD_BASE_GAP - (frame.column?.riseOf(marker.id, 'marker') ?? 0),
        );
        this.seen.add(marker.id);
      }
    }
    retireUndrawn(this.markers, this.seen, (sprite) => sprite.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.markers.clear();
  }
}
