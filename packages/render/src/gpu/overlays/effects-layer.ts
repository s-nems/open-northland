import type { SimEvent } from '@open-northland/sim';
import { Container, Graphics, Sprite, type TextureSource } from 'pixi.js';
import {
  type CombatEffect,
  type CombatEffectKind,
  effectAlpha,
  foldCombatEffects,
  frac,
} from '../../data/effects/index.js';
import { isVisible, TILE_HALF_H, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
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

/** Bones and wreckage linger at the event's ground anchor. Decoded sprites replace procedural
 * fallbacks when available; retained nodes live for the capped mark's lifetime. */

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

export class CombatEffectsLayer {
  /** Added below the sprite layer by the renderer, so a fighter walks over the bones. */
  readonly groundContainer = new Container();
  /** The live marks - the fold's output, replaced on each ingest. */
  private effects: readonly CombatEffect[] = [];
  /** One retained node per mark. */
  private readonly nodes = new Map<CombatEffect, Container>();
  /** Reused per-frame scratch of the marks drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<CombatEffect>();
  /** Unset draws the procedural pile. */
  private bones: MarkGfx | undefined;
  /** Unset draws the procedural planks. */
  private wreck: MarkGfx | undefined;

  setBonesGfx(bones: MarkGfx | undefined): void {
    this.bones = bones;
  }

  setWreckGfx(wreck: MarkGfx | undefined): void {
    this.wreck = wreck;
  }

  /** Fold this frame's events, across every sim sub-step, into the live mark list. */
  ingest(events: readonly SimEvent[], tick: number): void {
    this.effects = foldCombatEffects(this.effects, events, tick);
  }

  /** Reposition and fade every live mark, hiding off-screen ones, and retire nodes whose mark expired or
   *  was capped out. */
  draw(elevation: ElevationField, viewport: Viewport, tick: number): void {
    this.seen.clear();
    for (const effect of this.effects) {
      const alpha = effectAlpha(effect, tick);
      if (alpha <= 0) continue; // retired below, since it never enters `seen`
      // The lifted feet point (`projectNode`, unboxed).
      const x = effect.hx * TILE_HALF_W;
      const feetY = (effect.hy * TILE_HALF_H) / 2 - terrainLiftAtNode(elevation, effect.hx, effect.hy);
      // Cull by the ground anchor.
      let node = this.nodes.get(effect);
      if (!isVisible(viewport, x, feetY)) {
        retainOffscreen(node, effect, this.seen);
        continue;
      }
      if (node === undefined) {
        node = this.makeMark(effect.kind, effect.seed);
        this.groundContainer.addChild(node);
        this.nodes.set(effect, node);
      }
      node.visible = true;
      node.position.set(x, feetY);
      node.alpha = alpha;
      this.seen.add(effect);
    }
    // Retire nodes whose mark is gone (expired / capped out this frame).
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy({ children: true }));
  }

  destroy(): void {
    this.groundContainer.destroy({ children: true });
    this.nodes.clear();
  }

  /** A mark's node, minted once at its feet anchor. */
  private makeMark(kind: CombatEffectKind, seed: number): Container {
    const gfx = kind === 'bones' ? this.bones : this.wreck;
    if (gfx !== undefined && gfx.frames.length > 0) return makeMarkSprite(gfx, seed);
    return kind === 'bones' ? drawBones(new Graphics(), seed) : drawPlanks(new Graphics(), seed);
  }
}

/** A seed-picked decoded frame, wrapped so the container origin is the feet: the frame's own
 *  `offsetX/offsetY` place its top-left relative to that anchor, like the map-object layer. */
function makeMarkSprite(gfx: MarkGfx, seed: number): Container {
  const c = new Container();
  const frame = gfx.frames[seed % gfx.frames.length];
  if (frame === undefined) return c;
  const sprite = new Sprite(gfx.textures.get(gfx.source, frame));
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
