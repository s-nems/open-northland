import { Container, Graphics } from 'pixi.js';
import { depthKey, halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import { drawPlanStake, STAKE_TIE_HEIGHT, TAPE_BLOCKED, TAPE_OPEN } from '../plan-stake.js';
import { resolveLayers } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { mintLayerSprite } from './layer-sprite.js';

/**
 * The build-placement cursor ghost - the held building's own sprite, translucent, snapped to the hovered
 * half-cell node, the anchor grid buildings place on. The app decides where it hovers and whether it
 * shows at all (the original's house icon vanishes over ground the placement probe rejects).
 */

/** The hovered placement, with `col`/`row` as half-cell coordinates on the `2W×2H` lattice. */
export type PlacementGhost =
  | {
      readonly kind: 'building';
      readonly col: number;
      readonly row: number;
      readonly buildingType: number;
      /** The civilization raising it, so the cursor previews the body the placement will actually put
       *  down rather than the base tribe's. */
      readonly tribe: number;
    }
  | { readonly kind: 'signpost'; readonly col: number; readonly row: number; readonly player: number }
  | {
      /** A planned line of stakes, or a gate span; `anchored` marks the first node as the line's start. */
      readonly kind: 'line';
      readonly nodes: readonly { readonly col: number; readonly row: number; readonly valid: boolean }[];
      readonly anchored: boolean;
    };

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
    if (ghost.kind === 'line') {
      const key = `line:${ghost.anchored}:${ghost.nodes.map((node) => `${node.col},${node.row},${node.valid}`).join(';')}`;
      if (this.builtForKey !== key) {
        this.builtForKey = key;
        this.rebuildLine(ghost, elevation);
      }
      this.container.position.set(0, 0);
      // A plan is a cursor mark: it reads over the settlers and walls standing on its nodes.
      this.container.zIndex = Number.MAX_SAFE_INTEGER;
      this.container.alpha = 1;
      this.container.visible = ghost.nodes.length > 0;
      return;
    }
    this.container.alpha = GHOST_ALPHA;
    const key = ghost.kind === 'building' ? `b:${ghost.tribe}:${ghost.buildingType}` : `s:${ghost.player}`;
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

  private rebuildLine(ghost: Extract<PlacementGhost, { kind: 'line' }>, elevation: ElevationField): void {
    for (const child of this.container.removeChildren()) child.destroy();
    const g = new Graphics();
    const points = ghost.nodes.map((node) => {
      const point = halfCellToScreen(node.col, node.row);
      return { x: point.x, y: point.y - terrainLiftAtNode(elevation, node.col, node.row), valid: node.valid };
    });
    // The string runs knot to knot under the stakes, coloured by the stake it leads to.
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;
      g.moveTo(from.x, from.y - STAKE_TIE_HEIGHT)
        .lineTo(to.x, to.y - STAKE_TIE_HEIGHT)
        .stroke({ color: to.valid ? TAPE_OPEN : TAPE_BLOCKED, width: 1.25, alpha: 0.9 });
    }
    // Back to front, so a nearer stake covers the one behind it.
    const order = points.map((point, index) => ({ point, index })).sort((a, b) => a.point.y - b.point.y);
    for (const { point, index } of order) {
      drawPlanStake(g, point.x, point.y, { open: point.valid, anchor: ghost.anchored && index === 0 });
    }
    this.container.addChild(g);
  }

  private rebuild(ghost: Exclude<PlacementGhost, { kind: 'line' }>): void {
    for (const child of this.container.removeChildren()) child.destroy();
    // A minimal DrawItem: position and depth live on the container, and `ref: -1` only feeds
    // head-variation picks, which neither kind has.
    const item: DrawItem =
      ghost.kind === 'building'
        ? { kind: 'building', ref: -1, x: 0, y: 0, depth: 0, typeId: ghost.buildingType, tribe: ghost.tribe }
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
