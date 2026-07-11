import type { SimEvent } from '@vinland/sim';
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
} from '../data/effects.js';
import type { ElevationField } from '../data/elevation.js';
import { halfCellToScreen } from '../data/iso.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { isVisible, type Viewport } from '../data/viewport.js';
import type { TextureCache } from './texture-cache.js';

/**
 * The decoded bone-pile art the layer draws for a death (the original's `cadaver human bones` landscape
 * objects from `ls_skeletons.bmd`): the shared atlas page + a few interchangeable frames the app resolves
 * and hands over. When set, a death draws a REAL bone sprite (a seed-picked variant); absent (a checkout
 * with no `content/`), it falls back to the procedural pile. `textures` memoizes the per-frame sub-texture.
 */
export interface BonesGfx {
  readonly source: TextureSource;
  readonly frames: readonly AtlasFrame[];
  readonly textures: TextureCache;
  /** World-scale the bob is drawn at (1 = the map's native landscape-object scale). */
  readonly scale: number;
}

/**
 * The COMBAT-FEEDBACK layer — the transient marks a fight leaves: a BLOOD spurt where a blow lands, a
 * BONE pile where a unit falls. A client-side projection of the sim's one-shot events (never sim state),
 * RETAINED like the badge/selection layers: one {@link Graphics} per mark keyed by {@link effectKey} — its
 * static shape is drawn ONCE on first sight, then only repositioned / re-alpha'd / culled each frame; a
 * mark that expired (or was capped out) is destroyed. All marks are WORLD-space (children of the camera's
 * `worldLayer`) and split across TWO containers by role: BONES go in {@link groundContainer} BELOW the
 * sprite layer (ground litter a surviving fighter walks over), BLOOD in {@link overlayContainer} ABOVE it
 * and lifted onto the body ({@link BLOOD_RISE}) so the spurt reads ON the struck unit — a hidden splatter
 * under the standing victim's feet would be a poor "the blow landed" marker.
 *
 * Cost tracks the screen (golden rule 7): the live list is bounded by `MAX_ACTIVE_EFFECTS` and the
 * per-frame work skips any mark culled off-screen (its pooled node hidden, not repositioned). Blood is a
 * NAMED procedural approximation — droplets that spray from the wound and FALL to the feet each frame
 * ({@link bloodDroplet}, in `data/effects.ts`); bones draw the REAL decoded cadaver sprite when supplied.
 * The decay, projection, droplet motion, and event fold are the real behaviour.
 */

/** Blood: dark and bright red droplets, with a dark rim so a drop reads on any ground. */
const BLOOD_DARK = 0x6b0f0f;
const BLOOD_BRIGHT = 0xb51818;
const BLOOD_RIM = 0x2a0505;
/** Bone: off-white shafts with a dark outline so a pile reads on grass, dirt, or snow. */
const BONE_FILL = 0xe8e0cf;
const BONE_OUTLINE = 0x4a4436;

/** Number of droplets in a blood spray, and their base radius range (world px). Each is a small blob the
 *  layer stretches into a falling streak / a flat pool per frame (see {@link bloodDroplet}). */
const BLOOD_DROPS = 6;
const BLOOD_MIN_R = 1.0;
const BLOOD_MAX_R = 2.2;
/** Seed-index offset for a droplet's radius — kept clear of {@link bloodDroplet}'s `i*3+{0,1,2}` motion band
 *  (max index `5*3+2 = 17` at {@link BLOOD_DROPS} 6) so the radius seed never collides with the motion seeds. */
const BLOOD_RADIUS_SEED = 100;
/** World-px length / thickness of a single bone shaft in a pile (two crossed shafts + a skull dot). */
const BONE_LEN = 9;
const BONE_THICK = 2.4;

export class CombatEffectsLayer {
  /** Bones — ground litter, added BELOW the sprite layer by the renderer (a fighter walks over them). */
  readonly groundContainer = new Container();
  /** Blood — added ABOVE the sprite layer, so the spurt shows ON the struck body. */
  readonly overlayContainer = new Container();
  /** The live marks (pure fold output); replaced each ingest, iterated each draw. */
  private effects: CombatEffect[] = [];
  /** One retained node per mark key — shape drawn once, then only moved / faded / culled. */
  private readonly nodes = new Map<string, Container>();
  /** Reused per-frame scratch of keys drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<string>();
  /** The decoded bone art, when the app has resolved it; unset → procedural bones. */
  private bones: BonesGfx | undefined;

  /** Provide the decoded `cadaver human bones` art so deaths draw the REAL bone pile; unset → procedural. */
  setBonesGfx(bones: BonesGfx | undefined): void {
    this.bones = bones;
  }

  /** Fold this frame's events (across every sim sub-step) into the live mark list — see {@link foldCombatEffects}. */
  ingest(events: readonly SimEvent[], tick: number): void {
    this.effects = foldCombatEffects(this.effects, events, tick);
  }

  /**
   * Reposition + fade every live mark, culling off-screen ones, and retire nodes whose mark expired or was
   * dropped. Each mark's shape is minted ONCE (keyed by {@link effectKey}); thereafter only its position
   * (projected half-cell node, terrain-lifted), alpha (decay), and visibility (viewport cull) change.
   */
  draw(elevation: ElevationField, viewport: Viewport, tick: number): void {
    this.seen.clear();
    for (const effect of this.effects) {
      const alpha = effectAlpha(effect, tick);
      if (alpha <= 0) continue; // fully faded — its node is retired below (not in `seen`)
      const key = effectKey(effect);
      const p = halfCellToScreen(effect.hx, effect.hy);
      const lift = elevation.maxLift > 0 ? elevation.liftAtNode(effect.hx, effect.hy) : 0;
      // Blood rides UP onto the body (over the sprite); bones sit at the feet on the ground.
      const y = p.y - lift - (effect.kind === 'blood' ? BLOOD_RISE : 0);
      // Cull by the feet point (the mark's own anchor), so a body-lifted spurt near the top edge still shows.
      let node = this.nodes.get(key);
      if (!isVisible(viewport, p.x, p.y - lift)) {
        if (node !== undefined) node.visible = false;
        this.seen.add(key); // retain it — it's live, just not on screen
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
      // Blood is animated: its droplets spray from the wound and fall to the feet over the mark's life
      // (bones are static). `tick` is interpolated render time, so the fall reads smoothly at any frame rate.
      if (effect.kind === 'blood') animateBlood(node, effect, tick);
      this.seen.add(key);
    }
    // Retire nodes whose mark is gone (expired / capped out this frame).
    if (this.nodes.size > this.seen.size) {
      for (const [key, node] of this.nodes) {
        if (this.seen.has(key)) continue;
        node.destroy();
        this.nodes.delete(key);
      }
    }
  }

  destroy(): void {
    this.groundContainer.destroy({ children: true });
    this.overlayContainer.destroy({ children: true });
    this.nodes.clear();
  }

  /** Build a mark's node once: a seed-picked REAL bone sprite when the decoded art is set (else a
   *  procedural pile), or a blood spray (a container of droplet blobs the layer then animates). The node's
   *  origin is the wound (blood) / feet (bones) anchor; the layer positions/fades it thereafter. */
  private makeMark(kind: CombatEffectKind, seed: number): Container {
    if (kind === 'blood') return makeBlood(seed);
    if (this.bones !== undefined && this.bones.frames.length > 0) {
      return makeBonesSprite(this.bones, seed);
    }
    return drawBones(new Graphics(), seed);
  }
}

/** A blood spray: {@link BLOOD_DROPS} seeded droplet blobs, all stacked at the wound origin. The layer then
 *  moves/stretches each per frame via {@link bloodDroplet} so they fall to the feet and pool. */
function makeBlood(seed: number): Container {
  const c = new Container();
  for (let i = 0; i < BLOOD_DROPS; i++) {
    const g = new Graphics();
    const r = BLOOD_MIN_R + frac(seed, i + BLOOD_RADIUS_SEED) * (BLOOD_MAX_R - BLOOD_MIN_R);
    const color = i % 2 === 0 ? BLOOD_DARK : BLOOD_BRIGHT;
    // A small rimmed blob at the child's own origin; the layer scales it into a streak / pool each frame.
    g.circle(0, 0, r + 0.5).fill({ color: BLOOD_RIM, alpha: 0.5 });
    g.circle(0, 0, r).fill({ color });
    c.addChild(g);
  }
  return c;
}

/** Advance a blood node's droplets to their `tick` positions: each child (in mint order = droplet index)
 *  falls from the wound to the feet and stretches into a streak, then flattens into a pool — see
 *  {@link bloodDroplet}. Called every frame for a live blood mark; bones are static and skip this. */
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

/** A real decoded bone pile: a seed-picked `cadaver human bones` frame, anchored at the feet (the frame's
 *  own `offsetX/offsetY` place its top-left relative to the anchor, mirroring the map-object layer). Wrapped
 *  in a Container so its ORIGIN is the feet — the layer positions every node the same way. */
function makeBonesSprite(bones: BonesGfx, seed: number): Container {
  const c = new Container();
  const frame = bones.frames[seed % bones.frames.length];
  if (frame === undefined) return c;
  const sprite = new Sprite(bones.textures.get(bones.source, frame));
  sprite.scale.set(bones.scale);
  sprite.position.set(frame.offsetX * bones.scale, frame.offsetY * bones.scale);
  c.addChild(sprite);
  return c;
}

/** A small bone pile: two crossed shafts at a seeded angle plus a skull dot — a stand-in for the skeleton. */
function drawBones(g: Graphics, seed: number): Graphics {
  const base = frac(seed, 0) * Math.PI; // seeded orientation
  for (const off of [0, Math.PI / 2.4]) {
    const a = base + off;
    const hx = (Math.cos(a) * BONE_LEN) / 2;
    const hy = (Math.sin(a) * 0.6 * BONE_LEN) / 2; // squashed onto the ground plane
    // Dark outline first (wider), then the off-white bone on top, so each shaft reads on any ground.
    g.moveTo(-hx, -hy)
      .lineTo(hx, hy)
      .stroke({ width: BONE_THICK + 1.4, color: BONE_OUTLINE, cap: 'round' });
    g.moveTo(-hx, -hy).lineTo(hx, hy).stroke({ width: BONE_THICK, color: BONE_FILL, cap: 'round' });
  }
  g.circle(0, -1, 2.2).fill({ color: BONE_FILL }).stroke({ width: 0.9, color: BONE_OUTLINE });
  return g;
}
