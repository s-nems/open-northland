import { Container, Sprite, type TextureSource } from 'pixi.js';
import type { Viewport } from '../../data/projection/index.js';
import { OVERHEAD_BASE_GAP, type OverheadColumn } from '../../data/scene/overhead-column.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';
import { type MarkAnchorFrame, type MarkedEntity, markAnchor } from './entity-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The experience stars over a person's head: one star for fight experience with the weapon class he
 * fights with, one for experience in his trade, each grown in four sizes. The app decides who wears
 * which and carries that rule's source basis; this layer draws the list in the over-head column.
 */

/** The most star sizes the art draws; a tier is a quarter of the experience range. */
export const STAR_TIERS = 4;

/** One person's stars: each tier `1..STAR_TIERS`, 0 when he wears that star not at all. */
export interface ExperienceStar extends MarkedEntity {
  readonly weaponTier: number;
  readonly jobTier: number;
}

/** The decoded star art: the sheet and one frame per tier, index 0 = tier 1, the smallest. */
export interface ExperienceStarGfx {
  readonly source: TextureSource;
  readonly frameByTier: readonly AtlasFrame[];
}

interface StarGfx extends ExperienceStarGfx {
  readonly textures: TextureCache;
}

export interface ExperienceStarFrame extends MarkAnchorFrame {
  readonly stars: readonly ExperienceStar[];
  readonly column: OverheadColumn;
}

/** Feet→head estimate (world px), used only by the anchor's fallback. */
const HEAD_ABOVE_FEET = 40;

interface StarNode {
  readonly sprite: Sprite;
  tier: number;
}

export class ExperienceStarLayer {
  readonly container = new Container();
  private readonly weaponStars = new Map<number, StarNode>();
  private readonly jobStars = new Map<number, StarNode>();
  private readonly seenWeapon = new Set<number>();
  private readonly seenJob = new Set<number>();
  private gfx: StarGfx | undefined;

  /** Provide (or clear) the decoded stars. Either retires every live star. */
  setGfx(gfx: StarGfx | undefined): void {
    this.gfx = gfx;
    this.retireAll();
  }

  /** Whether stars draw at all, so the column lifts nothing for a star no art draws. */
  get drawsStars(): boolean {
    return this.gfx !== undefined;
  }

  draw(frame: ExperienceStarFrame, viewport?: Viewport): void {
    this.seenWeapon.clear();
    this.seenJob.clear();
    const gfx = this.gfx;
    if (gfx !== undefined) {
      for (const star of frame.stars) {
        const head = markAnchor(frame, star, HEAD_ABOVE_FEET, viewport);
        if (head === undefined) continue;
        const baseY = head.y - OVERHEAD_BASE_GAP;
        const weaponY = baseY - frame.column.riseOf(star.id, 'weaponStar');
        if (this.place(gfx, this.weaponStars, star.id, star.weaponTier, head.x, weaponY)) {
          this.seenWeapon.add(star.id);
        }
        const jobY = baseY - frame.column.riseOf(star.id, 'jobStar');
        if (this.place(gfx, this.jobStars, star.id, star.jobTier, head.x, jobY)) this.seenJob.add(star.id);
      }
    }
    retireUndrawn(this.weaponStars, this.seenWeapon, (node) => node.sprite.destroy());
    retireUndrawn(this.jobStars, this.seenJob, (node) => node.sprite.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.weaponStars.clear();
    this.jobStars.clear();
  }

  private place(
    gfx: StarGfx,
    pool: Map<number, StarNode>,
    id: number,
    tier: number,
    x: number,
    y: number,
  ): boolean {
    const frame = tier > 0 ? gfx.frameByTier[Math.min(tier, STAR_TIERS) - 1] : undefined;
    if (frame === undefined) return false;
    let node = pool.get(id);
    if (node === undefined) {
      const sprite = new Sprite(gfx.textures.get(gfx.source, frame));
      this.container.addChild(sprite);
      node = { sprite, tier: 0 };
      pool.set(id, node);
    }
    if (node.tier !== tier) {
      node.sprite.texture = gfx.textures.get(gfx.source, frame);
      // The bob's own hot spot.
      node.sprite.anchor.set(-frame.offsetX / frame.width, -frame.offsetY / frame.height);
      node.tier = tier;
    }
    node.sprite.position.set(x, y);
    return true;
  }

  private retireAll(): void {
    for (const node of this.weaponStars.values()) node.sprite.destroy();
    for (const node of this.jobStars.values()) node.sprite.destroy();
    this.weaponStars.clear();
    this.jobStars.clear();
  }
}
