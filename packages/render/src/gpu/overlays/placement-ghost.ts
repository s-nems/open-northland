import { Container, Graphics } from 'pixi.js';
import { depthKey, halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import { resolveLayers } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { mintLayerSprite } from './layer-sprite.js';

/**
 * The build-placement cursor ghost - the held building's own sprite, translucent, snapped to the hovered
 * half-cell node, the anchor grid buildings actually place on. The app decides where it hovers and
 * whether it shows at all (the original's house icon vanishes over ground the placement probe rejects);
 * this layer only projects that decision.
 *
 * It lives inside the depth-sorted sprite layer with a feet-anchor depth key, so the ghost occludes and
 * is occluded like the placed house would be. The sprite stack is rebuilt only on a building-type
 * change, through the same {@link resolveLayers} path a placed building takes, so the ghost always
 * previews what the placement will draw; without a sheet it degrades to a translucent placeholder
 * diamond at the same anchor.
 */

/** The hovered placement, with `col`/`row` as half-cell coordinates on the `2W×2H` lattice. */
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
    // Depth by the pre-lift feet anchor, like every pooled sprite - the ghost interleaves correctly.
    this.container.zIndex = depthKey(p.x, p.y);
    this.container.visible = true;
  }

  private rebuild(ghost: PlacementGhost): void {
    for (const child of this.container.removeChildren()) child.destroy();
    // A minimal DrawItem: position and depth live on the container, and `ref: -1` only feeds
    // head-variation picks, which neither kind has.
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
      this.container.addChild(mintLayerSprite(this.textures, layer));
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
