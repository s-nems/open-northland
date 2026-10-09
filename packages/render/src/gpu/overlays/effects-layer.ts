import type { EntitySnapshot, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics, type TextureSource } from 'pixi.js';
import {
  boneAlpha,
  bonePileOf,
  collectBonePiles,
  foldWreckMarks,
  frac,
  type WreckMark,
  wreckAlpha,
} from '../../data/effects/index.js';
import {
  isVisible,
  rowStagger,
  TILE_HALF_H,
  TILE_HALF_W,
  type Viewport,
} from '../../data/projection/index.js';
import { anchorTileBox } from '../../data/scene/entity-source.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import { BloodSurfaceSprite } from '../blood-surface.js';
import type { TextureCache } from '../texture-cache.js';
import { worldBatched } from '../world-batcher.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * Decoded still art for a ground mark, as the shared atlas page plus a few interchangeable frames: the
 * bone pile of a death (the original's `cadaver human bones` objects from `ls_skeletons.bmd`) or the
 * debris of a wreck. Unset (a checkout with no `content/`) falls back to the procedural mark.
 */
interface MarkGfx {
  readonly source: TextureSource;
  readonly frames: readonly AtlasFrame[];
  readonly textures: TextureCache;
  /** World-scale the bob is drawn at (1 = the map's native landscape-object scale). */
  readonly scale: number;
}

export interface GroundMarksFrame {
  readonly snapshot: WorldSnapshot;
  readonly elevation: ElevationField;
  readonly viewport: Viewport;
  /** Integer-or-interpolated sim tick the marks age against. */
  readonly renderTime: number;
  /** The viewer's explored ground by tile, unset while fog is off. */
  readonly fogExplored?: ((tileX: number, tileY: number) => boolean) | undefined;
}

/** Bone: off-white shafts with a dark outline so a pile reads on grass, dirt, or snow. */
const BONE_FILL = 0xe8e0cf;
const BONE_OUTLINE = 0x4a4436;

/** World-px length and thickness of one bone shaft in a pile. */
const BONE_LEN = 9;
const BONE_THICK = 2.4;
/** Wreck debris: splintered cart wood, drawn as a few dark planks when no decoded debris is supplied. */
const PLANK_FILL = 0x6b4a2a;
const PLANK_OUTLINE = 0x2e1f10;
const PLANK_LEN = 11;
const PLANK_THICK = 2.6;
const PLANKS_PER_WRECK = 3;

/**
 * Bones and wreckage at their ground anchors. Bone piles are saved sim state read off the snapshot and
 * faded here by age, so a loaded game shows the bones it was saved with; like the land's objects they show
 * on any explored ground. Wreck debris folds from events. A bone node lives while its pile is on screen,
 * a wreck node for its capped mark's lifetime.
 */
export class CombatEffectsLayer {
  /** Added below the sprite layer by the renderer, so a fighter walks over the bones. */
  readonly groundContainer = new Container();
  private wrecks: readonly WreckMark[] = [];
  private readonly wreckNodes = new Map<WreckMark, Container>();
  private readonly drawnWrecks = new Set<WreckMark>();
  private readonly boneNodes = new Map<number, Container>();
  private readonly drawnBones = new Set<number>();
  /** Reused query output for the piles near the screen. */
  private readonly candidates: EntitySnapshot[] = [];
  /** Off keeps every pile whole for good. */
  private bonesFade = true;
  /** Unset draws the procedural pile. */
  private bones: MarkGfx | undefined;
  /** Unset draws the procedural planks. */
  private wreck: MarkGfx | undefined;

  constructor(
    private readonly surface?: (
      sprite: BloodSurfaceSprite,
      id: number,
      groundY: number,
      lift: number,
    ) => void,
  ) {}

  setBonesGfx(bones: MarkGfx | undefined): void {
    this.bones = bones;
  }

  setWreckGfx(wreck: MarkGfx | undefined): void {
    this.wreck = wreck;
  }

  setBonesFade(fades: boolean): void {
    this.bonesFade = fades;
  }

  /** Fold this frame's events, across every sim sub-step, into the live wreck list. */
  ingest(events: readonly SimEvent[], tick: number): void {
    this.wrecks = foldWreckMarks(this.wrecks, events, tick);
  }

  draw(frame: GroundMarksFrame): void {
    this.drawBones(frame);
    this.drawWrecks(frame.elevation, frame.viewport, frame.renderTime);
  }

  destroy(): void {
    this.groundContainer.destroy({ children: true });
    this.wreckNodes.clear();
    this.boneNodes.clear();
  }

  /** Place and fade the piles near the screen, retiring the nodes of piles that left it or faded out. */
  private drawBones(frame: GroundMarksFrame): void {
    const { snapshot, elevation, viewport, renderTime, fogExplored } = frame;
    this.drawnBones.clear();
    const count = collectBonePiles(snapshot, anchorTileBox(viewport), this.candidates);
    for (let i = 0; i < count; i++) {
      const entity = this.candidates[i];
      const pile = entity === undefined ? null : bonePileOf(entity);
      if (pile === null) continue;
      const alpha = boneAlpha(renderTime - pile.tick, this.bonesFade);
      if (alpha <= 0) continue;
      if (fogExplored !== undefined && !fogExplored((pile.hx - rowStagger(pile.hy / 2)) / 2, pile.hy / 2))
        continue;
      const node = this.placeMark(pile.hx, pile.hy, elevation, viewport, this.boneNodes.get(pile.id), () =>
        this.makeMark(this.bones, pile.id, drawBones),
      );
      if (node === undefined) continue;
      const sprite = node.children[0];
      if (sprite instanceof BloodSurfaceSprite)
        this.surface?.(
          sprite,
          pile.id,
          (pile.hy * TILE_HALF_H) / 2,
          terrainLiftAtNode(elevation, pile.hx, pile.hy),
        );
      this.boneNodes.set(pile.id, node);
      node.alpha = alpha;
      this.drawnBones.add(pile.id);
    }
    retireUndrawn(this.boneNodes, this.drawnBones, (node) => node.destroy({ children: true }));
  }

  /** Reposition and fade every live wreck mark, hiding off-screen ones, and retire nodes whose mark
   *  expired or was capped out. */
  private drawWrecks(elevation: ElevationField, viewport: Viewport, tick: number): void {
    this.drawnWrecks.clear();
    for (const mark of this.wrecks) {
      const alpha = wreckAlpha(mark, tick);
      if (alpha <= 0) continue; // retired below, since it never enters `drawnWrecks`
      const held = this.wreckNodes.get(mark);
      const node = this.placeMark(mark.hx, mark.hy, elevation, viewport, held, () =>
        this.makeMark(this.wreck, mark.seed, drawPlanks),
      );
      if (node === undefined) {
        retainOffscreen(held, mark, this.drawnWrecks);
        continue;
      }
      this.wreckNodes.set(mark, node);
      node.alpha = alpha;
      this.drawnWrecks.add(mark);
    }
    retireUndrawn(this.wreckNodes, this.drawnWrecks, (node) => node.destroy({ children: true }));
  }

  /** The node of a mark at node `(hx, hy)` shown at its lifted feet point, minted on first sight;
   *  `undefined` when that point is off screen. */
  private placeMark(
    hx: number,
    hy: number,
    elevation: ElevationField,
    viewport: Viewport,
    held: Container | undefined,
    mint: () => Container,
  ): Container | undefined {
    const x = hx * TILE_HALF_W;
    const feetY = (hy * TILE_HALF_H) / 2 - terrainLiftAtNode(elevation, hx, hy);
    if (!isVisible(viewport, x, feetY)) return undefined;
    const node = held ?? mint();
    if (held === undefined) this.groundContainer.addChild(node);
    node.visible = true;
    node.position.set(x, feetY);
    return node;
  }

  private makeMark(
    gfx: MarkGfx | undefined,
    seed: number,
    fallback: (g: Graphics, seed: number) => Graphics,
  ): Container {
    if (gfx !== undefined && gfx.frames.length > 0) return makeMarkSprite(gfx, seed);
    return fallback(new Graphics(), seed);
  }
}

/** A seed-picked decoded frame, wrapped so the container origin is the feet: the frame's own
 *  `offsetX/offsetY` place its top-left relative to that anchor, like the map-object layer. */
function makeMarkSprite(gfx: MarkGfx, seed: number): Container {
  const c = new Container();
  const frame = gfx.frames[seed % gfx.frames.length];
  if (frame === undefined) return c;
  const sprite = worldBatched(new BloodSurfaceSprite(gfx.textures.get(gfx.source, frame)));
  sprite.scale.set(gfx.scale);
  sprite.position.set(frame.offsetX * gfx.scale, frame.offsetY * gfx.scale);
  c.addChild(sprite);
  return c;
}

/** A few splintered planks at seeded angles, squashed onto the ground plane - a stand-in for the debris. */
function drawPlanks(g: Graphics, seed: number): Graphics {
  for (let i = 0; i < PLANKS_PER_WRECK; i++) {
    const a = frac(seed, i) * Math.PI;
    const hx = (Math.cos(a) * PLANK_LEN) / 2;
    const hy = (Math.sin(a) * 0.6 * PLANK_LEN) / 2;
    const ox = (frac(seed, i + PLANKS_PER_WRECK) - 0.5) * PLANK_LEN;
    g.moveTo(ox - hx, -hy)
      .lineTo(ox + hx, hy)
      .stroke({ width: PLANK_THICK + 1.4, color: PLANK_OUTLINE, cap: 'square' });
    g.moveTo(ox - hx, -hy)
      .lineTo(ox + hx, hy)
      .stroke({ width: PLANK_THICK, color: PLANK_FILL, cap: 'square' });
  }
  return g;
}

/** A small bone pile: two crossed shafts at a seeded angle plus a skull dot - a stand-in for the skeleton. */
function drawBones(g: Graphics, seed: number): Graphics {
  const base = frac(seed, 0) * Math.PI;
  for (const off of [0, Math.PI / 2.4]) {
    const a = base + off;
    const hx = (Math.cos(a) * BONE_LEN) / 2;
    const hy = (Math.sin(a) * 0.6 * BONE_LEN) / 2; // squashed onto the ground plane
    // Outline first, wider, so each shaft reads on any ground.
    g.moveTo(-hx, -hy)
      .lineTo(hx, hy)
      .stroke({ width: BONE_THICK + 1.4, color: BONE_OUTLINE, cap: 'round' });
    g.moveTo(-hx, -hy).lineTo(hx, hy).stroke({ width: BONE_THICK, color: BONE_FILL, cap: 'round' });
  }
  g.circle(0, -1, 2.2).fill({ color: BONE_FILL }).stroke({ width: 0.9, color: BONE_OUTLINE });
  return g;
}
