import type { Container } from 'pixi.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../visibility.js';
import type { PooledEntity } from './pooled-entity.js';

/**
 * The sprite pool's half of the portrait inset protocol, serving each inset's second, re-aimed render
 * of the world. `SpritePool.portraitPass` scopes the show/solo borrows so their restores cannot be
 * skipped.
 */

interface HiddenSubject {
  readonly pe: PooledEntity;
  /** Inside a building or aboard a vehicle: the inset then renders it alone, so its cutout drops the
   *  world backdrop instead of reading as standing on top of the building or out on the map. */
  readonly solo: boolean;
}

export class PortraitSubject {
  /** The inset subjects force-hidden on the main map this frame, by ref: those drawn for an inset only. */
  private readonly hidden = new Map<number, HiddenSubject>();
  /** Sprite-layer children hidden during a subject's solo render, with their prior visibility. Reused
   *  rather than re-allocated, since the solo runs every frame such a portrait is open. */
  private readonly solo: StashedVisibility[] = [];

  constructor(private readonly spriteLayer: Container) {}

  /** Un-hide last frame's force-hidden subjects before the pool re-decides this frame's. */
  release(): void {
    for (const subject of this.hidden.values()) subject.pe.container.visible = true;
    this.hidden.clear();
  }

  /** Force-hide `pe` on the main map as an inset subject, so an indoor one does not pop into view at its
   *  door. */
  capture(ref: number, pe: PooledEntity, solo: boolean): void {
    pe.container.visible = false;
    this.hidden.set(ref, { pe, solo });
  }

  /** Reveal one inset's force-hidden subjects so its render can draw them; {@link hide} restores them
   *  for the main stage. Another inset's subjects stay hidden, so an indoor settler never shows at the
   *  door of the house another inset frames. */
  show(refs: readonly number[]): void {
    for (const ref of refs) this.setShown(ref, true);
  }

  hide(refs: readonly number[]): void {
    for (const ref of refs) this.setShown(ref, false);
  }

  private setShown(ref: number, shown: boolean): void {
    const subject = this.hidden.get(ref);
    if (subject !== undefined) subject.pe.container.visible = shown;
  }

  /** Hide the sprite-layer siblings of the first solo subject among `refs` and return the sprite
   *  layer - the one world layer the inset keeps visible - so the subject draws alone over the panel's
   *  backdrop. Null when the subjects render with the world around them. */
  beginSolo(refs: readonly number[]): Container | null {
    for (const ref of refs) {
      const subject = this.hidden.get(ref);
      if (subject?.solo !== true) continue;
      stashHidden(this.spriteLayer.children, subject.pe.container, this.solo);
      return this.spriteLayer;
    }
    return null;
  }

  /** Restore the sprite-layer children {@link beginSolo} hid; a no-op when it declined. */
  endSolo(): void {
    restoreStash(this.solo);
    this.solo.length = 0;
  }
}
