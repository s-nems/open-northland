import { Container, Graphics } from 'pixi.js';
import { depthKey, halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import {
  palisadeStaggerX,
  staggeredNodeKeys,
  type WallNode,
  wallNodeKey,
} from '../../data/scene/palisade-stagger.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import {
  mintPlanStake,
  type PlanStakeTextures,
  STAKE_TIE_HEIGHT,
  STRING_BLOCKED,
  STRING_OPEN,
} from '../plan-stake.js';
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
      /** A gate cut into a wall run, drawn as the gate itself at its centre node; `ok` false tints it red. */
      readonly kind: 'gate';
      readonly col: number;
      readonly row: number;
      readonly gfxIndex: number;
      readonly ok: boolean;
    }
  | {
      /** A planned line of stakes, or a gate span; `anchored` marks the first node as the line's start. */
      readonly kind: 'line';
      readonly nodes: readonly PlanNode[];
      readonly anchored: boolean;
    };

/** `open` gets a stake, `built` already holds a piece the string only passes, `blocked` a red stake. */
export interface PlanNode {
  readonly col: number;
  readonly row: number;
  readonly state: 'open' | 'built' | 'blocked';
}

/** Tuned by eye against the original's translucent cursor house (no measurable oracle). */
const GHOST_ALPHA = 0.55;
/** A gate stands over the posts it replaces, so it needs more cover to read as the gate. Tuned by eye. */
const GATE_GHOST_ALPHA = 0.85;
/** Placeholder tint when no atlas frame resolves (bare checkout / synthetic sheet without the type). */
const PLACEHOLDER_COLOR = 0xc8a04a;
/** The ring on the ground under a started line's first node. */
const ANCHOR_RING = 0xf2c14e;
const ANCHOR_RING_RADIUS = { x: 9, y: 4.5 } as const;

export class PlacementGhostLayer {
  readonly container = new Container();
  private builtForKey: string | null = null;

  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly textures: TextureCache,
    private readonly stakes?: PlanStakeTextures,
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
      const key = `line:${ghost.anchored}:${ghost.nodes.map((node) => `${node.col},${node.row},${node.state}`).join(';')}`;
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
    this.container.alpha = ghost.kind === 'gate' ? GATE_GHOST_ALPHA : GHOST_ALPHA;
    const key =
      ghost.kind === 'building'
        ? `b:${ghost.tribe}:${ghost.buildingType}`
        : ghost.kind === 'gate'
          ? `g:${ghost.gfxIndex}:${ghost.ok}`
          : `s:${ghost.player}`;
    if (this.builtForKey !== key) {
      this.builtForKey = key;
      this.rebuild(ghost);
    }
    const p = halfCellToScreen(ghost.col, ghost.row);
    const lift = terrainLiftAtNode(elevation, ghost.col, ghost.row);
    // A gate draws staggered with the wall it stands in.
    const shift = ghost.kind === 'gate' ? palisadeStaggerX(ghost.row) : 0;
    this.container.position.set(p.x + shift, p.y - lift);
    // Depth by the pre-lift feet anchor, like every pooled sprite - the ghost interleaves correctly. A gate
    // stands on the walls it replaces, so it reads over them instead.
    this.container.zIndex = ghost.kind === 'gate' ? Number.MAX_SAFE_INTEGER : depthKey(p.x, p.y);
    this.container.visible = true;
  }

  private rebuildLine(ghost: Extract<PlacementGhost, { kind: 'line' }>, elevation: ElevationField): void {
    for (const child of this.container.removeChildren()) child.destroy();
    const g = new Graphics();
    // The plan staggers as the walls it lays will.
    const planNodes = new Map<string, WallNode>(
      ghost.nodes.map((node) => [wallNodeKey(node.col, node.row), { hx: node.col, hy: node.row }]),
    );
    const staggered = staggeredNodeKeys(planNodes, new Set());
    const points = ghost.nodes.map((node) => {
      const point = halfCellToScreen(node.col, node.row);
      const shift = staggered.has(wallNodeKey(node.col, node.row)) ? palisadeStaggerX(node.row) : 0;
      return {
        x: point.x + shift,
        y: point.y - terrainLiftAtNode(elevation, node.col, node.row),
        state: node.state,
      };
    });
    // The start ring also marks a standing piece under the cursor, which takes no stake of its own.
    const first = points[0];
    if (first !== undefined && (ghost.anchored || first.state === 'built')) {
      g.ellipse(first.x, first.y, ANCHOR_RING_RADIUS.x, ANCHOR_RING_RADIUS.y).stroke({
        color: ANCHOR_RING,
        width: 2,
        alpha: 0.95,
      });
    }
    // The string runs knot to knot under the stakes, coloured by the node it leads to, with a dark
    // underline that keeps it readable over pale ground.
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;
      const color = to.state === 'blocked' ? STRING_BLOCKED : STRING_OPEN;
      g.moveTo(from.x, from.y - STAKE_TIE_HEIGHT + 1)
        .lineTo(to.x, to.y - STAKE_TIE_HEIGHT + 1)
        .stroke({ color: 0x000000, width: 2, alpha: 0.35 })
        .moveTo(from.x, from.y - STAKE_TIE_HEIGHT)
        .lineTo(to.x, to.y - STAKE_TIE_HEIGHT)
        .stroke({ color, width: 1.5, alpha: 0.95 });
    }
    this.container.addChild(g);
    // Back to front, so a nearer stake covers the one behind it.
    const stakes = points.filter((point) => point.state !== 'built').sort((a, b) => a.y - b.y);
    for (const point of stakes) {
      const stake = mintPlanStake(this.stakes, point.state === 'open' ? 'open' : 'blocked');
      stake.position.set(point.x, point.y);
      this.container.addChild(stake);
    }
  }

  private rebuild(ghost: Exclude<PlacementGhost, { kind: 'line' }>): void {
    for (const child of this.container.removeChildren()) child.destroy();
    // A minimal DrawItem: position and depth live on the container, and `ref: -1` only feeds
    // head-variation picks, which neither kind has.
    const item: DrawItem =
      ghost.kind === 'building'
        ? { kind: 'building', ref: -1, x: 0, y: 0, depth: 0, typeId: ghost.buildingType, tribe: ghost.tribe }
        : ghost.kind === 'gate'
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
      const sprite = mintLayerSprite(this.textures, layer);
      if (ghost.kind === 'gate' && !ghost.ok) sprite.tint = STRING_BLOCKED;
      this.container.addChild(sprite);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
