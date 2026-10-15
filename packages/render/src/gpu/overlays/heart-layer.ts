import { Container, Sprite, type TextureSource } from 'pixi.js';
import type { Viewport } from '../../data/projection/index.js';
import type { OverheadColumn } from '../../data/scene/overhead-column.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';
import { type MarkAnchorFrame, type MarkedEntity, markAnchor } from './entity-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The life-heart layer - a gauge over a unit whose life the player tracks, drawn in its owner's player
 * palette. The app's life-heart projection decides who wears one and carries that rule's source basis;
 * this layer draws the list. Retained per on-screen unit and re-minted on return, like the settler
 * bubbles.
 */

/** Frames from full to empty life: `ls_gui_bubbles` bobs 11 to 21, a tenth of life apart. */
export const LIFE_HEART_STEPS = 11;

/** One unit's heart: its owner's colour slot and remaining life as a `[0, 1]` fraction. */
export interface LifeHeart extends MarkedEntity {
  readonly colourSlot: number;
  readonly life: number;
}

/** One colour slot's heart frames, index 0 full to {@link LIFE_HEART_STEPS} - 1 empty, on its page. */
export interface LifeHeartSheet {
  readonly source: TextureSource;
  readonly frames: readonly AtlasFrame[];
}

/** The decoded heart art, indexed by colour slot. */
export interface LifeHeartGfx {
  readonly byPlayer: readonly (LifeHeartSheet | undefined)[];
}

interface HeartGfx extends LifeHeartGfx {
  readonly textures: TextureCache;
}

export interface LifeHeartFrame extends MarkAnchorFrame {
  readonly hearts: readonly LifeHeart[];
  /** Lifts a heart over the weapon star its unit wears; absent = nothing below. */
  readonly column?: OverheadColumn | undefined;
}

/** World-px the heart's tip floats above the unit's back (the sprite-bounds top, or the feet estimate). */
const HEART_GAP = 4;
/** Feet→back estimate (world px) when the pool has no sprite bounds for the unit. */
const BACK_ABOVE_FEET = 26;

/** The heart frame `life` draws, 0 full to {@link LIFE_HEART_STEPS} - 1 empty, at the nearest tenth. */
export function heartStepOf(life: number): number {
  const level = Math.max(0, Math.min(1, life));
  return Math.round((1 - level) * (LIFE_HEART_STEPS - 1));
}

interface HeartNode {
  readonly sprite: Sprite;
  frame: AtlasFrame;
}

export class LifeHeartLayer {
  readonly container = new Container();
  /** One heart per on-screen unit id; its texture swaps on a step or colour change. */
  private readonly hearts = new Map<number, HeartNode>();
  /** Reused scratch of ids drawn this frame, to avoid a per-frame allocation. */
  private readonly seen = new Set<number>();
  private gfx: HeartGfx | undefined;

  /** Provide (or clear) the decoded hearts. Either retires every live heart. */
  setGfx(gfx: HeartGfx | undefined): void {
    this.gfx = gfx;
    for (const node of this.hearts.values()) node.sprite.destroy();
    this.hearts.clear();
  }

  /** Whether hearts draw at all, so the column lifts nothing for a heart no art draws. */
  get drawsHearts(): boolean {
    return this.gfx !== undefined;
  }

  /** Reconcile to `frame.hearts`: build/move one heart per visible unit, retire the rest. */
  draw(frame: LifeHeartFrame, viewport?: Viewport): void {
    this.seen.clear();
    const gfx = this.gfx;
    if (gfx !== undefined) {
      for (const heart of frame.hearts) {
        // A slot past the baked colours, or a failed page, draws slot 0's.
        const sheet = gfx.byPlayer[heart.colourSlot] ?? gfx.byPlayer[0];
        const bob = sheet?.frames[heartStepOf(heart.life)];
        if (sheet === undefined || bob === undefined) continue;
        const top = markAnchor(frame, heart, BACK_ABOVE_FEET, viewport);
        if (top === undefined) continue;
        let node = this.hearts.get(heart.id);
        if (node === undefined) {
          const sprite = new Sprite(gfx.textures.get(sheet.source, bob));
          this.container.addChild(sprite);
          node = { sprite, frame: bob };
          this.hearts.set(heart.id, node);
          placeHotSpot(sprite, bob);
        } else if (node.frame !== bob) {
          node.sprite.texture = gfx.textures.get(sheet.source, bob);
          node.frame = bob;
          placeHotSpot(node.sprite, bob);
        }
        node.sprite.position.set(top.x, top.y - HEART_GAP - (frame.column?.riseOf(heart.id, 'heart') ?? 0));
        this.seen.add(heart.id);
      }
    }
    retireUndrawn(this.hearts, this.seen, (node) => node.sprite.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.hearts.clear();
  }
}

/** Anchors the sprite on the bob's own hot spot, the heart's tip. */
function placeHotSpot(sprite: Sprite, bob: AtlasFrame): void {
  sprite.anchor.set(-bob.offsetX / bob.width, -bob.offsetY / bob.height);
}
