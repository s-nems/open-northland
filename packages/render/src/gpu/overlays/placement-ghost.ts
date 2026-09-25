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
  | { readonly kind: 'palisade'; readonly col: number; readonly row: number; readonly gfxIndex: number }
  | {
      readonly kind: 'palisade-line';
      readonly nodes: readonly { readonly col: number; readonly row: number; readonly valid: boolean }[];
    }
  | {
      readonly kind: 'palisade-gate';
      readonly nodes: readonly { readonly col: number; readonly row: number }[];
      readonly valid: boolean;
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
    if (ghost.kind === 'palisade-line' || ghost.kind === 'palisade-gate') {
      const key = `${ghost.kind}:${ghost.kind === 'palisade-gate' ? ghost.valid : ''}:${ghost.nodes
        .map((node) => `${node.col},${node.row},${'valid' in node ? node.valid : ''}`)
        .join(';')}`;
      if (this.builtForKey !== key) {
        this.builtForKey = key;
        this.rebuildPalisadePlan(ghost, elevation);
      }
      this.container.position.set(0, 0);
      this.container.zIndex = 0;
      this.container.visible = ghost.nodes.length > 0;
      return;
    }
    const key =
      ghost.kind === 'building'
        ? `b:${ghost.tribe}:${ghost.buildingType}`
        : ghost.kind === 'palisade'
          ? `p:${ghost.gfxIndex}`
          : `s:${ghost.player}`;
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

  private rebuildPalisadePlan(
    ghost: Extract<PlacementGhost, { kind: 'palisade-line' | 'palisade-gate' }>,
    elevation: ElevationField,
  ): void {
    for (const child of this.container.removeChildren()) child.destroy();
    const g = new Graphics();
    const points = ghost.nodes.map((node) => {
      const point = halfCellToScreen(node.col, node.row);
      return { x: point.x, y: point.y - terrainLiftAtNode(elevation, node.col, node.row) };
    });
    if (points.length > 1) {
      const first = points[0];
      if (first !== undefined) {
        g.moveTo(first.x, first.y);
        for (const point of points.slice(1)) g.lineTo(point.x, point.y);
        g.stroke({ color: 0x171717, width: 2, alpha: 0.9 });
      }
    }
    // A gate span is one verdict for the whole run; a wall line carries one per node.
    const isGate = ghost.kind === 'palisade-gate';
    const validAt = ghost.kind === 'palisade-gate' ? () => ghost.valid : (i: number) => ghost.nodes[i]?.valid;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (point === undefined) continue;
      const valid = validAt(i) === true;
      const color = isGate ? (valid ? 0x49ff66 : 0xff5353) : valid ? 0xffffff : 0xff5353;
      g.ellipse(point.x, point.y - 1, 6, 3)
        .fill({ color, alpha: 0.95 })
        .stroke({ color: 0x202020, width: 1, alpha: 0.9 });
    }
    this.container.addChild(g);
  }

  private rebuild(ghost: Exclude<PlacementGhost, { kind: 'palisade-line' | 'palisade-gate' }>): void {
    for (const child of this.container.removeChildren()) child.destroy();
    // A minimal DrawItem: position and depth live on the container, and `ref: -1` only feeds
    // head-variation picks, which neither kind has.
    const item: DrawItem =
      ghost.kind === 'building'
        ? { kind: 'building', ref: -1, x: 0, y: 0, depth: 0, typeId: ghost.buildingType, tribe: ghost.tribe }
        : ghost.kind === 'palisade'
          ? { kind: 'palisade', ref: -1, x: 0, y: 0, depth: 0, gfxIndex: ghost.gfxIndex }
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
