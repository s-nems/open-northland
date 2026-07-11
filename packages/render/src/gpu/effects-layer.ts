import type { SimEvent } from '@vinland/sim';
import { Container, Graphics, Sprite, type TextureSource } from 'pixi.js';
import {
  type CombatEffect,
  type CombatEffectKind,
  effectAlpha,
  effectKey,
  foldCombatEffects,
} from '../data/effects.js';
import type { ElevationField } from '../data/elevation.js';
import { halfCellToScreen } from '../data/iso.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { type Viewport, isVisible } from '../data/viewport.js';
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
 * per-frame work skips any mark culled off-screen (its pooled node hidden, not repositioned). The mark
 * ART is a NAMED procedural approximation (the original's HIT particle + cadaver skeleton gfx are unbound
 * here — see `data/effects.ts`); the decay, projection, and event fold are the real behaviour.
 */

/** Blood: dark and bright red droplets over a dried base, with a dark rim so it reads on any ground. */
const BLOOD_DARK = 0x6b0f0f;
const BLOOD_BRIGHT = 0xb51818;
const BLOOD_RIM = 0x2a0505;
/** Bone: off-white shafts with a dark outline so a pile reads on grass, dirt, or snow. */
const BONE_FILL = 0xe8e0cf;
const BONE_OUTLINE = 0x4a4436;

/** World-px spread of a blood splatter's droplets around the hit node, and the droplet radius range. */
const BLOOD_SPREAD = 7;
const BLOOD_MIN_R = 1.1;
const BLOOD_MAX_R = 2.6;
const BLOOD_DROPS = 5;
/** World-px length / thickness of a single bone shaft in a pile (two crossed shafts + a skull dot). */
const BONE_LEN = 9;
const BONE_THICK = 2.4;
/** World-px a blood spurt is lifted UP from the victim's feet node onto its torso, so the mark reads on
 *  the body (over the sprite) rather than hiding as a puddle under the standing victim's feet. A viking
 *  body is ~32 world units tall; ~40% up puts the spurt on the chest. Named eye-calibrated approximation. */
const BLOOD_RISE = 13;

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
   *  procedural pile), or the procedural blood splatter. The node's origin is the feet anchor; the layer
   *  positions/fades it thereafter. */
  private makeMark(kind: CombatEffectKind, seed: number): Container {
    if (kind === 'bones' && this.bones !== undefined && this.bones.frames.length > 0) {
      return makeBonesSprite(this.bones, seed);
    }
    const g = new Graphics();
    return kind === 'blood' ? drawBlood(g, seed) : drawBones(g, seed);
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

/** A deterministic float in [0, 1) from a mark's seed and a droplet/shaft index — no `Math.random`, so a
 *  screenshot reproduces the exact splatter. A small integer hash mixed down to a unit fraction. */
function rand(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

/** A small blood splatter: a few seeded droplets (dark + bright) over the node, dark-rimmed for contrast. */
function drawBlood(g: Graphics, seed: number): Graphics {
  for (let i = 0; i < BLOOD_DROPS; i++) {
    const ang = rand(seed, i * 2) * Math.PI * 2;
    const dist = rand(seed, i * 2 + 1) * BLOOD_SPREAD;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.6; // squashed onto the iso ground plane
    const r = BLOOD_MIN_R + rand(seed, i + 100) * (BLOOD_MAX_R - BLOOD_MIN_R);
    const color = i % 2 === 0 ? BLOOD_DARK : BLOOD_BRIGHT;
    g.circle(dx, dy, r + 0.5).fill({ color: BLOOD_RIM, alpha: 0.5 });
    g.circle(dx, dy, r).fill({ color });
  }
  return g;
}

/** A small bone pile: two crossed shafts at a seeded angle plus a skull dot — a stand-in for the skeleton. */
function drawBones(g: Graphics, seed: number): Graphics {
  const base = rand(seed, 0) * Math.PI; // seeded orientation
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
