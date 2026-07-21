import { Container, Sprite, type TextureSource } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import type { TextureCache } from '../texture-cache.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * The settler-bubble layer — the decoded thought bubble (`ls_gui_bubbles`) floating over a settler's
 * head while it is in a standing family state (a make-child order, a wedding walk) or a pressing need
 * (too hungry / too sleepy to keep working). A client-side projection of the read-only snapshot (never sim
 * state): the app scans each settler's `ChildOrder` / `Wedding` / need components and hands over the
 * {@link SettlerBubble} list, and this layer draws one bubble sprite per settler above its head, panning/
 * zooming with the world (a child of the camera's `worldLayer`, above the sprites).
 *
 * Anchored like the selection rings, not the door badges: a settler moves (a wedding walk), so the bubble
 * rides the sprite pool's drawn, inter-tick-lerped bounds — its top edge and horizontal centre — so it
 * glides with the interpolated bob and sits just over the head. A settler the pool didn't draw this frame
 * (culled off-screen, or inside a house) falls back to the raw snapshot projection of its `Position`.
 *
 * Retained like the badge / effects layers: one bubble {@link Container} per settler id (a stable key),
 * rebuilt only when the bubble's kind changes, otherwise just repositioned each frame; a bubble whose
 * settler left the list (order done, wedding over, settler retired) is destroyed. Cost tracks the screen —
 * an off-screen bubble keeps its pooled node (it scrolls back) but is neither repositioned nor rebuilt.
 * With no decoded art supplied (a checkout without `content/`) the layer draws nothing.
 */

/** Which standing state a bubble marks — the make-child order, a wedding in progress, or a pressing
 *  hunger/sleep need. Each kind selects its own frame from the bubble sheet. */
export type SettlerBubbleKind = 'child' | 'partner' | 'hungry' | 'sleepy';

/** One settler's bubble: its entity id (the retained-pool key) and the snapshot `Position` (fixed-point
 *  units) the layer projects when the pool didn't draw the settler, plus the state it marks. */
export interface SettlerBubble {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly kind: SettlerBubbleKind;
}

/** The decoded bubble art the app resolves and hands the renderer: the shared `ls_gui_bubbles` atlas page
 *  + the frame each kind draws. */
export interface SettlerBubbleGfx {
  readonly source: TextureSource;
  readonly frameByKind: Readonly<Record<SettlerBubbleKind, AtlasFrame>>;
}

/** {@link SettlerBubbleGfx} plus the layer's frame→texture cache. Unset → the layer draws nothing. */
interface BubbleGfx extends SettlerBubbleGfx {
  readonly textures: TextureCache;
}

/**
 * The frame's projection seams. Both are optional: without a drawn entity the layer falls back to the raw
 * snapshot projection plus the terrain lift.
 */
export interface SettlerBubbleFrame {
  readonly bubbles: readonly SettlerBubble[];
  /** The pool's drawn sprites — the head is the sprite box's top edge, so a bubble glides with the
   *  interpolated bob. */
  readonly drawn?: DrawnGeometry;
  /** The terrain height field — lifts the raw-projection fallback onto sloped ground. */
  readonly elevation?: ElevationField;
}

/** World-px the bubble's tip floats above the settler's head (the sprite-bounds top, or the feet estimate). */
const BUBBLE_GAP = 6;
/** Feet→head estimate (world px) when the pool has no sprite bounds for the settler (culled / indoors). */
const HEAD_ABOVE_FEET = 40;
/** Draw scale of the 64×32 bubble frame — shrunk so it reads as a marker over the small settler bob. */
const BUBBLE_SCALE = 0.85;

interface BubbleNode {
  readonly node: Container;
  readonly kind: SettlerBubbleKind;
}

export class SettlerBubbleLayer {
  readonly container = new Container();
  /** One persistent bubble per settler id; rebuilt only when its kind changes, else repositioned. */
  private readonly bubbles = new Map<number, BubbleNode>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<number>();
  /** The decoded bubble art, when the app has resolved it; unset → the layer draws nothing. */
  private gfx: BubbleGfx | undefined;

  /** Provide (or clear) the decoded `ls_gui_bubbles` art. Clearing retires every live bubble. */
  setGfx(gfx: BubbleGfx | undefined): void {
    this.gfx = gfx;
    if (gfx === undefined) {
      for (const b of this.bubbles.values()) b.node.destroy({ children: true });
      this.bubbles.clear();
    }
  }

  /**
   * Reconcile the bubbles to `frame.bubbles`: (re)build one per settler whose kind changed, move it above
   * the settler's head (the pool's lerped bounds, else the raw-projected `Position`), then retire bubbles
   * for settlers no longer in the list. An empty list (or unset art) retires every bubble. A `viewport`
   * bounds the per-frame work to the screen.
   */
  draw(frame: SettlerBubbleFrame, viewport?: Viewport): void {
    this.seen.clear();
    const gfx = this.gfx;
    if (gfx !== undefined) {
      for (const bubble of frame.bubbles) {
        const head = this.headOf(bubble, frame);

        let entry = this.bubbles.get(bubble.id);
        // Off-screen: retain the pooled node (hidden) so it isn't retired, but skip the reposition/rebuild.
        if (viewport !== undefined && !isVisible(viewport, head.x, head.y)) {
          retainOffscreen(entry?.node, bubble.id, this.seen);
          continue;
        }

        if (entry === undefined || entry.kind !== bubble.kind) {
          entry?.node.destroy({ children: true });
          const node = makeBubble(gfx, bubble.kind);
          this.container.addChild(node);
          entry = { node, kind: bubble.kind };
          this.bubbles.set(bubble.id, entry);
        }
        entry.node.visible = true;
        entry.node.position.set(head.x, head.y - BUBBLE_GAP);
        this.seen.add(bubble.id);
      }
    }
    // Retire bubbles not drawn this frame (order done, wedding over, settler left the snapshot).
    retireUndrawn(this.bubbles, this.seen, (entry) => entry.node.destroy({ children: true }));
  }

  /** The head point the bubble's tip sits over: the pool's lerped sprite-bounds top+centre when the settler
   *  was drawn this frame, else the lerped feet anchor lifted by a head estimate, else the raw-projected
   *  `Position` lifted the same way (culled off-screen, or standing inside a house). */
  private headOf(bubble: SettlerBubble, frame: SettlerBubbleFrame): { x: number; y: number } {
    const bounds = frame.drawn?.boundsOf(bubble.id);
    if (bounds !== undefined) return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
    const feet = frame.drawn?.anchorOf(bubble.id);
    if (feet !== undefined) return { x: feet.x, y: feet.y - HEAD_ABOVE_FEET };
    const tileX = bubble.x / ONE;
    const tileY = bubble.y / ONE;
    const p = tileToScreen(tileX, tileY);
    return { x: p.x, y: p.y - terrainLiftAt(frame.elevation, tileX, tileY) - HEAD_ABOVE_FEET };
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.bubbles.clear();
  }
}

/** One bubble node: the kind's decoded frame, anchored bottom-centre at the container origin so the
 *  bubble's tip sits at the head point and the balloon reads above the settler. */
function makeBubble(gfx: BubbleGfx, kind: SettlerBubbleKind): Container {
  const c = new Container();
  const sprite = new Sprite(gfx.textures.get(gfx.source, gfx.frameByKind[kind]));
  sprite.anchor.set(0.5, 1);
  sprite.scale.set(BUBBLE_SCALE);
  c.addChild(sprite);
  return c;
}
