import type { SimEvent } from '@open-northland/sim';
import { Container, Graphics, Sprite, type TextureSource } from 'pixi.js';
import {
  BLOOD_RISE,
  bloodDroplet,
  type CombatEffect,
  type CombatEffectKind,
  effectAlpha,
  effectKey,
  foldCombatEffects,
  frac,
} from '../../data/effects/index.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
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

/**
 * The combat-feedback layer - the transient marks a fight leaves: a blood spurt where a blow lands, a
 * bone pile where a unit falls, debris where a cart or catapult is wrecked. A client-side projection of
 * the sim's one-shot events, never sim state, with one world-space node per mark keyed by `effectKey`.
 * Blood is a named procedural approximation; bones and debris draw the decoded sprites when supplied.
 */

/** Blood: dark and bright red droplets, with a dark rim so a drop reads on any ground. */
const BLOOD_DARK = 0x6b0f0f;
const BLOOD_BRIGHT = 0xb51818;
const BLOOD_RIM = 0x2a0505;
/** Bone: off-white shafts with a dark outline so a pile reads on grass, dirt, or snow. */
const BONE_FILL = 0xe8e0cf;
const BONE_OUTLINE = 0x4a4436;

/** Number of droplets in a blood spray, and their base radius range (world px). */
const BLOOD_DROPS = 6;
const BLOOD_MIN_R = 1.0;
const BLOOD_MAX_R = 2.2;
/** Seed-index offset for a droplet's radius, clear of `bloodDroplet`'s `i*3+{0,1,2}` motion band (max
 *  index 17 at 6 droplets) so radius and motion seeds never collide. */
const BLOOD_RADIUS_SEED = 100;
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
  /** Added above the sprite layer by the renderer, so the spurt shows on the struck body. */
  readonly overlayContainer = new Container();
  /** The live marks - the fold's output, replaced on each ingest. */
  private effects: CombatEffect[] = [];
  /** One retained node per mark key. */
  private readonly nodes = new Map<string, Container>();
  /** Reused per-frame scratch of keys drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<string>();
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
      const key = effectKey(effect);
      // The lifted feet point; blood then rides up onto the body.
      const p = projectNode(elevation, effect.hx, effect.hy);
      const y = p.y - (effect.kind === 'blood' ? BLOOD_RISE : 0);
      // Cull by the feet point, so a body-lifted spurt near the top edge still shows.
      let node = this.nodes.get(key);
      if (!isVisible(viewport, p.x, p.y)) {
        retainOffscreen(node, key, this.seen);
        continue;
      }
      if (node === undefined) {
        node = this.makeMark(effect.kind, effect.seed);
        (effect.kind === 'blood' ? this.overlayContainer : this.groundContainer).addChild(node);
        this.nodes.set(key, node);
      }
      node.visible = true;
      node.position.set(p.x, y);
      node.alpha = alpha;
      // `tick` is interpolated render time, so the fall stays smooth at any frame rate.
      if (effect.kind === 'blood') animateBlood(node, effect, tick);
      this.seen.add(key);
    }
    // Retire nodes whose mark is gone (expired / capped out this frame).
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy());
  }

  destroy(): void {
    this.groundContainer.destroy({ children: true });
    this.overlayContainer.destroy({ children: true });
    this.nodes.clear();
  }

  /** A mark's node, minted once. Its origin is the anchor the layer positions: the wound for blood, the
   *  feet for bones and debris. */
  private makeMark(kind: CombatEffectKind, seed: number): Container {
    if (kind === 'blood') return makeBlood(seed);
    const gfx = kind === 'bones' ? this.bones : this.wreck;
    if (gfx !== undefined && gfx.frames.length > 0) return makeMarkSprite(gfx, seed);
    return kind === 'bones' ? drawBones(new Graphics(), seed) : drawPlanks(new Graphics(), seed);
  }
}

/** A blood spray: seeded droplet blobs, all minted stacked at the wound origin. */
function makeBlood(seed: number): Container {
  const c = new Container();
  for (let i = 0; i < BLOOD_DROPS; i++) {
    const g = new Graphics();
    const r = BLOOD_MIN_R + frac(seed, i + BLOOD_RADIUS_SEED) * (BLOOD_MAX_R - BLOOD_MIN_R);
    const color = i % 2 === 0 ? BLOOD_DARK : BLOOD_BRIGHT;
    g.circle(0, 0, r + 0.5).fill({ color: BLOOD_RIM, alpha: 0.5 });
    g.circle(0, 0, r).fill({ color });
    c.addChild(g);
  }
  return c;
}

/** Advance a blood node's droplets to their `tick` positions; child order is droplet index. */
function animateBlood(node: Container, effect: CombatEffect, tick: number): void {
  const age = tick - effect.spawnTick;
  const drops = node.children;
  for (let i = 0; i < drops.length; i++) {
    const d = bloodDroplet(effect.seed, i, age);
    const drop = drops[i];
    if (drop === undefined) continue;
    drop.position.set(d.x, d.y);
    drop.scale.set(d.stretchX, d.stretchY);
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
