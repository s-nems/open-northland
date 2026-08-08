import { Container, Sprite, type TextureSource } from 'pixi.js';
import type { Viewport } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';
import { type MarkAnchorFrame, type MarkedEntity, markAnchor } from './entity-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The settler-bubble layer - the decoded `ls_gui_bubbles` thought bubble floating over a settler in a
 * standing family state (a make-child order, a wedding walk) or a pressing need. A client-side
 * projection of the read-only snapshot: the app decides who wears one, this layer draws it in world
 * space above the sprites. Bubbles retire on cull and re-mint on return instead of detaching and
 * retaining like the sprite pool, under the settler-bubble policy in the package contract.
 */

/** Which standing state a bubble marks: a make-child order, a wedding walk, or a pressing need. */
export type SettlerBubbleKind = 'child' | 'partner' | 'hungry' | 'sleepy';

export interface SettlerBubble extends MarkedEntity {
  readonly kind: SettlerBubbleKind;
}

/** The decoded `ls_gui_bubbles` art the app resolves: the shared atlas page + the frame each kind
 *  draws. */
export interface SettlerBubbleGfx {
  readonly source: TextureSource;
  readonly frameByKind: Readonly<Record<SettlerBubbleKind, AtlasFrame>>;
}

/** {@link SettlerBubbleGfx} plus the layer's frame→texture cache. Unset → the layer draws nothing. */
interface BubbleGfx extends SettlerBubbleGfx {
  readonly textures: TextureCache;
}

export interface SettlerBubbleFrame extends MarkAnchorFrame {
  readonly bubbles: readonly SettlerBubble[];
}

/** World-px the bubble's tip floats above the settler's head (the sprite-bounds top, or the feet estimate). */
const BUBBLE_GAP = 6;
/** Feet→head estimate (world px) when the pool has no sprite bounds for the settler (indoors / no pool). */
const HEAD_ABOVE_FEET = 40;
/** Draw scale of the 64×32 bubble frame - shrunk so it reads as a marker over the small settler bob. */
const BUBBLE_SCALE = 0.85;

interface BubbleNode {
  readonly node: Container;
  readonly kind: SettlerBubbleKind;
}

export class SettlerBubbleLayer {
  readonly container = new Container();
  /** One bubble per on-screen settler id; rebuilt only when its kind changes, else repositioned. */
  private readonly bubbles = new Map<number, BubbleNode>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<number>();
  private gfx: BubbleGfx | undefined;

  /** Provide (or clear) the decoded `ls_gui_bubbles` art. Clearing retires every live bubble. */
  setGfx(gfx: BubbleGfx | undefined): void {
    this.gfx = gfx;
    if (gfx === undefined) {
      for (const b of this.bubbles.values()) b.node.destroy({ children: true });
      this.bubbles.clear();
    }
  }

  /** Reconcile to `frame.bubbles`: build/move one bubble per visible settler, retire the rest.
   *  `viewport` bounds the per-frame work to the screen. */
  draw(frame: SettlerBubbleFrame, viewport?: Viewport): void {
    this.seen.clear();
    const gfx = this.gfx;
    if (gfx !== undefined) {
      for (const bubble of frame.bubbles) {
        const head = markAnchor(frame, bubble, HEAD_ABOVE_FEET, viewport);
        if (head === undefined) continue;

        let entry = this.bubbles.get(bubble.id);
        if (entry === undefined || entry.kind !== bubble.kind) {
          entry?.node.destroy({ children: true });
          const node = makeBubble(gfx, bubble.kind);
          this.container.addChild(node);
          entry = { node, kind: bubble.kind };
          this.bubbles.set(bubble.id, entry);
        }
        entry.node.position.set(head.x, head.y - BUBBLE_GAP);
        this.seen.add(bubble.id);
      }
    }
    // Retire bubbles not drawn this frame (order done, wedding over, settler gone or scrolled off-screen).
    retireUndrawn(this.bubbles, this.seen, (entry) => entry.node.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.bubbles.clear();
  }
}

/** One bubble node: the kind's decoded frame, anchored bottom-centre so its tip sits at the head
 *  point. */
function makeBubble(gfx: BubbleGfx, kind: SettlerBubbleKind): Container {
  const c = new Container();
  const sprite = new Sprite(gfx.textures.get(gfx.source, gfx.frameByKind[kind]));
  sprite.anchor.set(0.5, 1);
  sprite.scale.set(BUBBLE_SCALE);
  c.addChild(sprite);
  return c;
}
