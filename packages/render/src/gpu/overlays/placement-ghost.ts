import { Container, Graphics, Sprite } from 'pixi.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/elevation.js';
import { depthKey, halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';
import type { DrawItem } from '../../data/scene/index.js';
import { resolveLayers } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';

/**
 * The build-placement cursor ghost — the held building's own sprite, translucent, snapped to the
 * hovered half-cell node (the anchor grid buildings actually place on), exactly the original's
 * build-mode cursor. The app decides where (the hovered node) and whether (it hides the ghost over
 * ground the placement probe rejects — in the original the house icon vanishes over blocked ground);
 * this layer only projects that decision.
 *
 * Lives inside the depth-sorted sprite layer with a feet-anchor depth key, so the ghost occludes and
 * is occluded like the real house would be — sliding it behind a standing tree reads correctly.
 * Retained: the sprite stack is rebuilt only when the building type changes; a hover move just
 * repositions the container. The frame resolution is the exact path a placed building's sprite takes
 * ({@link resolveLayers}), so the ghost always previews what the placement will draw; without a sheet
 * (or an unbound type) it degrades to a translucent placeholder diamond at the same anchor.
 */

/** What the app hands the layer each frame while a placement cursor hovers a placeable node —
 *  `col`/`row` are half-cell coordinates on the `2W×2H` lattice. A held building previews its own
 *  sprite stack; the scout's pending signpost previews the owner's guidepost post. */
export type PlacementGhost =
  | { readonly kind: 'building'; readonly col: number; readonly row: number; readonly buildingType: number }
  | { readonly kind: 'signpost'; readonly col: number; readonly row: number; readonly player: number };

/** Tuned by eye against the original's translucent cursor house (no measurable oracle). */
const GHOST_ALPHA = 0.55;
/** Placeholder tint when no atlas frame resolves (bare checkout / synthetic sheet without the type). */
const PLACEHOLDER_COLOR = 0xc8a04a;

export class PlacementGhostLayer {
  readonly container = new Container();
  private builtForKey: string | null = null;

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
    const key = ghost.kind === 'building' ? `b:${ghost.buildingType}` : `s:${ghost.player}`;
    if (this.builtForKey !== key) {
      this.builtForKey = key;
      this.rebuild(ghost);
    }
    const p = halfCellToScreen(ghost.col, ghost.row);
    const lift = terrainLiftAtNode(elevation, ghost.col, ghost.row);
    this.container.position.set(p.x, p.y - lift);
    // Depth by the pre-lift feet anchor, like every pooled sprite — the ghost interleaves correctly.
    this.container.zIndex = depthKey(p.x, p.y);
    this.container.visible = true;
  }

  /** Rebuild the sprite stack through the placed entity's own resolution path (building or signpost). */
  private rebuild(ghost: PlacementGhost): void {
    for (const child of this.container.removeChildren()) child.destroy();
    // A minimal DrawItem: the resolver keys a building's body frame off `typeId`, a signpost's post off
    // the owner's `player` recolour (position and depth live on the container; ref -1 marks "no entity"
    // and only feeds head-variation picks, which neither kind has).
    const item: DrawItem =
      ghost.kind === 'building'
        ? { kind: 'building', ref: -1, x: 0, y: 0, depth: 0, typeId: ghost.buildingType }
        : { kind: 'signpost', ref: -1, x: 0, y: 0, depth: 0, player: ghost.player };
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
