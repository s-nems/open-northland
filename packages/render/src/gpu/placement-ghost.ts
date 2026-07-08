import { Container, Graphics, Sprite } from 'pixi.js';
import type { ElevationField } from '../data/elevation.js';
import { TILE_HALF_H, TILE_HALF_W, depthKey, tileToScreen } from '../data/iso.js';
import type { DrawItem } from '../data/scene/index.js';
import type { SpriteSheet } from './pixi-app.js';
import { resolveLayers } from './sprite-pool/index.js';
import type { TextureCache } from './texture-cache.js';

/**
 * The BUILD-PLACEMENT cursor ghost — the held building's own sprite, translucent, snapped to the
 * hovered tile, exactly the original's build-mode cursor. The app decides WHERE (the hovered tile)
 * and WHETHER (it hides the ghost over ground the placement probe rejects — in the original the house
 * icon vanishes over blocked ground); this layer only projects that decision.
 *
 * Lives INSIDE the depth-sorted sprite layer with a feet-anchor depth key, so the ghost occludes and
 * is occluded like the real house would be — sliding it behind a standing tree reads correctly.
 * Retained: the sprite stack is rebuilt only when the building TYPE changes; a hover move just
 * repositions the container. The frame resolution is the exact path a placed building's sprite takes
 * ({@link resolveLayers}), so the ghost always previews what the placement will draw; without a sheet
 * (or an unbound type) it degrades to a translucent placeholder diamond at the same anchor.
 */

/** What the app hands the layer each frame while a building is held over a placeable tile. */
export interface PlacementGhost {
  readonly col: number;
  readonly row: number;
  readonly buildingType: number;
}

/** Tuned by eye against the original's translucent cursor house (no measurable oracle). */
const GHOST_ALPHA = 0.55;
/** Placeholder tint when no atlas frame resolves (bare checkout / synthetic sheet without the type). */
const PLACEHOLDER_COLOR = 0xc8a04a;

export class PlacementGhostLayer {
  readonly container = new Container();
  private builtForType: number | null = null;

  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly textures: TextureCache,
  ) {
    this.container.visible = false;
    this.container.alpha = GHOST_ALPHA;
  }

  /** Show the ghost at a tile (rebuilding the sprite stack only on a type change), or hide on null. */
  set(ghost: PlacementGhost | null, elevation: ElevationField): void {
    if (ghost === null) {
      this.container.visible = false;
      return;
    }
    if (this.builtForType !== ghost.buildingType) {
      this.builtForType = ghost.buildingType;
      this.rebuild(ghost.buildingType);
    }
    const p = tileToScreen(ghost.col, ghost.row);
    const lift = elevation.maxLift > 0 ? elevation.liftAt(ghost.col, ghost.row) : 0;
    this.container.position.set(p.x, p.y - lift);
    // Depth by the PRE-LIFT feet anchor, like every pooled sprite — the ghost interleaves correctly.
    this.container.zIndex = depthKey(p.x, p.y);
    this.container.visible = true;
  }

  /** Rebuild the sprite stack for a building type through the placed-building resolution path. */
  private rebuild(buildingType: number): void {
    for (const child of this.container.removeChildren()) child.destroy();
    // A minimal building DrawItem: the resolver keys the body frame off `typeId` alone (position and
    // depth live on the container; ref -1 marks "no entity" and only feeds head-variation picks,
    // which buildings don't have).
    const item: DrawItem = { kind: 'building', ref: -1, x: 0, y: 0, depth: 0, typeId: buildingType };
    const layers = resolveLayers(this.sheet, item, 0);
    if (layers === null) {
      const g = new Graphics();
      g.poly([0, -TILE_HALF_H, TILE_HALF_W, 0, 0, TILE_HALF_H, -TILE_HALF_W, 0]).fill(PLACEHOLDER_COLOR);
      this.container.addChild(g);
      return;
    }
    for (const layer of layers) {
      const spr = new Sprite(this.textures.get(layer.source, layer.frame));
      spr.position.set(layer.frame.offsetX * layer.scale, layer.frame.offsetY * layer.scale);
      spr.scale.set(layer.scale);
      this.container.addChild(spr);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
