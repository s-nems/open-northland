import type { Container } from 'pixi.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../visibility.js';
import type { PooledEntity } from './pooled-entity.js';

/**
 * The sprite pool's half of the details-panel portrait protocol — the bookkeeping that exists solely for
 * {@link import('../overlays/portrait-inset.js').PortraitInsetLayer}'s second, re-aimed render of the
 * world: which pooled entity is force-hidden on the main map this frame, and the solo pass that blanks
 * an indoor subject's sprite-layer siblings for that render. `SpritePool.portraitPass` scopes the
 * show/solo borrows so their restores cannot be skipped.
 */

export class PortraitSubject {
  /** The portrait subject kept hidden on the main map this frame (off-screen/indoor — {@link
   *  import('../../data/scene/index.js').DrawItem.portraitOnly}); the portrait's second render reveals it
   *  via {@link show}. Null when the subject draws normally or no portrait is open. */
  private hidden: PooledEntity | null = null;
  /** Whether {@link hidden} is inside a building (drawn frozen — `DrawItem.frozen`); the portrait then
   *  renders it alone so its cutout drops the world backdrop and it doesn't read as standing on top of
   *  the building. */
  private indoor = false;
  /** Sprite-layer children hidden during an indoor portrait's solo render, with their prior visibility so
   *  {@link endSolo} restores exactly what {@link beginSoloIfIndoor} changed. Retained across frames —
   *  this is the per-frame path. */
  private readonly solo: StashedVisibility[] = [];

  /** @param spriteLayer the pool's shared, depth-sorted entity layer — the children the solo pass blanks. */
  constructor(private readonly spriteLayer: Container) {}

  /** Drop last frame's force-hidden subject (un-hiding it) before the pool re-decides this frame's — the
   *  subject may have scrolled back on-screen (drawn normally) or the portrait may have closed. */
  release(): void {
    if (this.hidden !== null) {
      this.hidden.container.visible = true;
      this.hidden = null;
    }
    this.indoor = false;
  }

  /** Force-hide `pe` on the main map as this frame's portrait subject: an off-screen one is off-canvas
   *  anyway, and an indoor one must not pop into view at its door. */
  capture(pe: PooledEntity, indoor: boolean): void {
    pe.container.visible = false;
    this.hidden = pe;
    this.indoor = indoor;
  }

  /** Reveal the force-hidden portrait subject (if any) so the portrait's second render of the world can
   *  draw its cutout; {@link hide} re-hides it for the main stage. No-op when the subject is drawn
   *  normally or no portrait is open. */
  show(): void {
    if (this.hidden !== null) this.hidden.container.visible = true;
  }

  /** Re-hide the portrait subject after its cutout render (see {@link show}). */
  hide(): void {
    if (this.hidden !== null) this.hidden.container.visible = false;
  }

  /** Begin an indoor subject's solo render: hide its sprite-layer siblings and return the sprite layer —
   *  the one world layer the portrait keeps visible while blanking the rest (terrain, fog…), so the
   *  subject draws alone over the panel's backdrop. Null when the subject renders with the world around
   *  it (not indoor, or no force-hidden subject). {@link endSolo} restores the siblings. */
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
