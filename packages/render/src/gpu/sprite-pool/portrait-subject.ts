import type { Container } from 'pixi.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../visibility.js';
import type { PooledEntity } from './pooled-entity.js';

/**
 * The sprite pool's half of the details-panel portrait protocol, serving the portrait layer's second,
 * re-aimed render of the world. `SpritePool.portraitPass` scopes the show/solo borrows so their restores
 * cannot be skipped.
 */

export class PortraitSubject {
  /** The portrait subject force-hidden on the main map this frame; null when the subject draws normally
   *  or no portrait is open. */
  private hidden: PooledEntity | null = null;
  /** Whether {@link hidden} is inside a building; the portrait then renders it alone, so its cutout
   *  drops the world backdrop instead of reading as standing on top of the building. */
  private indoor = false;
  /** Sprite-layer children hidden during an indoor portrait's solo render, with their prior visibility.
   *  Retained across frames: this is a per-frame path. */
  private readonly solo: StashedVisibility[] = [];

  constructor(private readonly spriteLayer: Container) {}

  /** Un-hide last frame's force-hidden subject before the pool re-decides this frame's. */
  release(): void {
    if (this.hidden !== null) {
      this.hidden.container.visible = true;
      this.hidden = null;
    }
    this.indoor = false;
  }

  /** Force-hide `pe` on the main map as this frame's portrait subject, so an indoor one does not pop
   *  into view at its door. */
  capture(pe: PooledEntity, indoor: boolean): void {
    pe.container.visible = false;
    this.hidden = pe;
    this.indoor = indoor;
  }

  /** Reveal the force-hidden subject so the portrait's render can draw its cutout; {@link hide} restores
   *  it for the main stage. */
  show(): void {
    if (this.hidden !== null) this.hidden.container.visible = true;
  }

  hide(): void {
    if (this.hidden !== null) this.hidden.container.visible = false;
  }

  /** Hide an indoor subject's sprite-layer siblings and return the sprite layer - the one world layer the
   *  portrait keeps visible - so the subject draws alone over the panel's backdrop. Null when the subject
   *  renders with the world around it. */
  beginSoloIfIndoor(): Container | null {
    const subject = this.hidden?.container;
    if (!this.indoor || subject === undefined) return null;
    stashHidden(this.spriteLayer.children, subject, this.solo);
    return this.spriteLayer;
  }

  /** Restore the sprite-layer children {@link beginSoloIfIndoor} hid; a no-op when it declined. */
  endSolo(): void {
    restoreStash(this.solo);
    this.solo.length = 0;
  }
}
