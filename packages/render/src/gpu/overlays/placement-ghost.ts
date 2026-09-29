import { Container, Graphics } from 'pixi.js';
import { depthKey, halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { type PalisadeLayout, planShiftX } from '../../data/scene/palisade-connections.js';
import { palisadeStaggerX } from '../../data/scene/palisade-stagger.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import { drawPlotCross, mintPlanRoad, type PlanRoadTextures, plotRim } from '../plan-road.js';
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
 * The placement cursor ghost - the held building's, signpost's or work flag's own sprite, translucent,
 * snapped to the hovered half-cell node, the anchor grid buildings place on. The app decides where it
 * hovers and whether it shows at all (the original's house icon vanishes over ground the placement
 * probe rejects).
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
      /** `road` plans outlined pegged plots joined by a band on the ground, on the plain lattice;
       *  `roadCancel` crosses out the road sites a cancel line withdraws (its `open` nodes) along a red
       *  band. A wall's stakes stagger with the walls they will stand in. Defaults to `stake`. */
      readonly marker?: LineMarker;
    }
  /** A gatherer's work flag about to be planted: the delivery-flag sprite, unowned. */
  | { readonly kind: 'flag'; readonly col: number; readonly row: number };

export type LineMarker = 'stake' | 'road' | 'roadCancel';

/** `open` gets a stake, `built` already holds a piece the string only passes, `blocked` a red stake. */
export interface PlanNode {
  readonly col: number;
  readonly row: number;
  readonly state: 'open' | 'built' | 'blocked';
}

/** A line node on screen, lifted onto the ground it stands on. */
interface PlanPoint {
  readonly x: number;
  readonly y: number;
  readonly state: PlanNode['state'];
}

/** The ghosts drawn as one sprite; a line is stakes and string, built apart. */
type SpriteGhost = Exclude<PlacementGhost, { readonly kind: 'line' }>;

function ghostKey(ghost: SpriteGhost): string {
  switch (ghost.kind) {
    case 'building':
      return `b:${ghost.tribe}:${ghost.buildingType}`;
    case 'signpost':
      return `s:${ghost.player}`;
    case 'gate':
      return `g:${ghost.gfxIndex}:${ghost.ok}`;
    case 'flag':
      return 'f';
    default: {
      const unreachable: never = ghost;
      throw new Error(`unhandled ghost: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** A minimal DrawItem: position and depth live on the container, and `ref: -1` only feeds
 *  head-variation picks, which no ghost kind has. */
function ghostItem(ghost: SpriteGhost): DrawItem {
  switch (ghost.kind) {
    case 'building':
      return {
        kind: 'building',
        ref: -1,
        x: 0,
        y: 0,
        depth: 0,
        typeId: ghost.buildingType,
        tribe: ghost.tribe,
      };
    case 'signpost':
      return { kind: 'signpost', ref: -1, x: 0, y: 0, depth: 0, player: ghost.player };
    case 'gate':
      return { kind: 'palisade', ref: -1, x: 0, y: 0, depth: 0, gfxIndex: ghost.gfxIndex };
    case 'flag':
      return { kind: 'stockpile', ref: -1, x: 0, y: 0, depth: 0, isFlag: true };
    default: {
      const unreachable: never = ghost;
      throw new Error(`unhandled ghost: ${JSON.stringify(unreachable)}`);
    }
  }
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
/** A planned road plot's outline, which sets the plan apart from the sites already ordered. Tuned by eye. */
const ROAD_PLAN_RIM = 0xfff4d0;
const ROAD_PLAN_RIM_GROW = 1.5;
const ROAD_PLAN_RIM_WIDTH = 1.5;
/** The band a planned road lies along on the ground, over a darker underlay. Tuned by eye. */
const ROAD_BAND = 0xf0e2b8;
const ROAD_BAND_WIDTH = 4;
const ROAD_BAND_ALPHA = 0.5;
const BAND_SHADOW = 0x000000;
const BAND_SHADOW_WIDTH = 6;
const BAND_SHADOW_ALPHA = 0.2;

/** {@link PlacementGhostLayer}'s built key while it shows a line, whose plan it tracks by value. */
const LINE_KEY = 'line';

function samePlanNodes(a: readonly PlanNode[], b: readonly PlanNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.col !== y.col || x.row !== y.row || x.state !== y.state) {
      return false;
    }
  }
  return true;
}

function sameShifts(a: readonly number[], b: readonly number[]): boolean {
  return a === b || (a.length === b.length && a.every((shift, i) => shift === b[i]));
}

export class PlacementGhostLayer {
  readonly container = new Container();
  private builtForKey: string | null = null;
  /** The line plan and wall layout the memoized `lineShifts` were worked out for. The app hands a new
   *  node list every frame, so the plan compares by value. */
  private readonly shiftsFor: {
    nodes: readonly PlanNode[] | null;
    anchored: boolean;
    walls: PalisadeLayout | undefined;
    marker: LineMarker;
  } = { nodes: null, anchored: false, walls: undefined, marker: 'stake' };
  private lineShifts: readonly number[] = [];

  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly textures: TextureCache,
    private readonly stakes?: PlanStakeTextures,
    private readonly roads?: PlanRoadTextures,
  ) {
    this.container.visible = false;
    this.container.alpha = GHOST_ALPHA;
  }

  /** `walls` is the scene's palisade layout, which a line plan staggers with. */
  set(ghost: PlacementGhost | null, elevation: ElevationField, walls?: PalisadeLayout): void {
    if (ghost === null) {
      this.container.visible = false;
      return;
    }
    if (ghost.kind === 'line') {
      const planned = this.shiftsFor;
      const marker = ghost.marker ?? 'stake';
      const road = marker !== 'stake';
      const samePlan =
        planned.nodes !== null &&
        planned.anchored === ghost.anchored &&
        planned.marker === marker &&
        samePlanNodes(planned.nodes, ghost.nodes);
      let shifts = this.lineShifts;
      if (!samePlan || planned.walls !== walls) {
        shifts = road
          ? ghost.nodes.map(() => 0)
          : planShiftX(
              ghost.nodes.map((node) => ({ hx: node.col, hy: node.row })),
              walls,
            );
      }
      if (!samePlan || this.builtForKey !== LINE_KEY || !sameShifts(shifts, this.lineShifts)) {
        this.builtForKey = LINE_KEY;
        this.rebuildLine(ghost, shifts, elevation);
      }
      this.lineShifts = shifts;
      planned.nodes = ghost.nodes;
      planned.anchored = ghost.anchored;
      planned.walls = walls;
      planned.marker = marker;
      this.container.position.set(0, 0);
      // A plan is a cursor mark: it reads over the settlers and walls standing on its nodes.
      this.container.zIndex = Number.MAX_SAFE_INTEGER;
      this.container.alpha = 1;
      this.container.visible = ghost.nodes.length > 0;
      return;
    }
    this.container.alpha = ghost.kind === 'gate' ? GATE_GHOST_ALPHA : GHOST_ALPHA;
    const key = ghostKey(ghost);
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

  private rebuildLine(
    ghost: Extract<PlacementGhost, { kind: 'line' }>,
    shifts: readonly number[],
    elevation: ElevationField,
  ): void {
    for (const child of this.container.removeChildren()) child.destroy();
    const g = new Graphics();
    const points = ghost.nodes.map((node, i): PlanPoint => {
      const point = halfCellToScreen(node.col, node.row);
      return {
        x: point.x + (shifts[i] ?? 0),
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
    const marker = ghost.marker ?? 'stake';
    if (marker !== 'stake') {
      this.drawRoadPlan(g, points, marker);
      return;
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
    // Back to front, so a nearer marker covers the one behind it.
    const stakes = points.filter((point) => point.state !== 'built').sort((a, b) => a.y - b.y);
    for (const point of stakes) {
      const stake = mintPlanStake(this.stakes, point.state === 'open' ? 'open' : 'blocked');
      stake.position.set(point.x, point.y);
      this.container.addChild(stake);
    }
  }

  /**
   * A road line lies on the ground: a band joins each accepted node to the next, so the plan reads as one
   * road, and every plot it would order wears an outline the ordered sites lack. A cancel line runs red
   * and crosses out the sites it withdraws.
   */
  private drawRoadPlan(ring: Graphics, points: readonly PlanPoint[], marker: 'road' | 'roadCancel'): void {
    const cancel = marker === 'roadCancel';
    const colour = cancel ? STRING_BLOCKED : ROAD_BAND;
    const band = new Graphics();
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined || from.state === 'blocked' || to.state === 'blocked')
        continue;
      band
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({ color: BAND_SHADOW, width: BAND_SHADOW_WIDTH, alpha: BAND_SHADOW_ALPHA, cap: 'round' })
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({ color: colour, width: ROAD_BAND_WIDTH, alpha: ROAD_BAND_ALPHA, cap: 'round' });
    }
    // The start ring over the band, under the plots.
    this.container.addChild(band, ring);
    // Back to front, so a nearer marker covers the one behind it.
    const plots = points.filter((point) => point.state !== 'built').sort((a, b) => a.y - b.y);
    for (const point of plots) {
      if (cancel) {
        // A cancel line's open node is a site it withdraws: the site already draws its plot.
        const mark = plotRim(new Graphics(), point.x, point.y, ROAD_PLAN_RIM_GROW).stroke({
          color: STRING_BLOCKED,
          width: ROAD_PLAN_RIM_WIDTH,
        });
        this.container.addChild(drawPlotCross(mark, point.x, point.y));
        continue;
      }
      const plot = mintPlanRoad(this.roads, point.state === 'open' ? 'open' : 'blocked');
      plot.position.set(point.x, point.y);
      this.container.addChild(plot);
      if (point.state === 'open') {
        const rim = plotRim(new Graphics(), point.x, point.y, ROAD_PLAN_RIM_GROW).stroke({
          color: ROAD_PLAN_RIM,
          width: ROAD_PLAN_RIM_WIDTH,
        });
        this.container.addChild(rim);
      }
    }
  }

  private rebuild(ghost: Exclude<PlacementGhost, { kind: 'line' }>): void {
    for (const child of this.container.removeChildren()) child.destroy();
    const item = ghostItem(ghost);
    const layers = resolveLayers(this.sheet, item, 0);
    if (layers === null) {
      const g = new Graphics();
      g.poly([0, -TILE_HALF_H, TILE_HALF_W, 0, 0, TILE_HALF_H, -TILE_HALF_W, 0]).fill(PLACEHOLDER_COLOR);
      this.container.addChild(g);
      return;
    }
    for (const layer of layers) {
      // The ghost floats over the ground it is judged against; it draws no contact shade.
      if (layer.groundFoot === 'shade' || layer.groundFoot === 'cover') continue;
      const sprite = mintLayerSprite(this.textures, layer);
      if (ghost.kind === 'gate' && !ghost.ok) sprite.tint = STRING_BLOCKED;
      this.container.addChild(sprite);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
