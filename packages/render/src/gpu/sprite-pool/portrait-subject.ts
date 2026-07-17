import type { Container } from 'pixi.js';
import type { PooledEntity } from './pooled-entity.js';

/**
 * The sprite pool's half of the details-panel portrait protocol — the bookkeeping that exists solely for
 * {@link import('../overlays/portrait-inset.js').PortraitInsetLayer}'s second, re-aimed render of the
 * world: which pooled entity is force-hidden on the main map this frame, whether it is indoors, and the
 * solo pass that blanks its sprite-layer siblings for that render.
 */

/** One child's visibility remembered across a temporary hide, so the restore puts back exactly what the
 *  hide changed rather than making everything visible. */
export interface StashedVisibility {
  readonly child: { visible: boolean };
  readonly wasVisible: boolean;
}

/**
 * Hide every child but `except`, recording each hidden child's prior visibility for {@link restoreStash}.
 * `into` lets a per-frame caller reuse a retained array (cleared up front, so a skipped restore can't
 * corrupt the next one); omitting it mints a fresh stash per call.
 */
export function stashHidden(
  children: readonly { visible: boolean }[],
  except: { visible: boolean },
  into: StashedVisibility[] = [],
): StashedVisibility[] {
  into.length = 0;
  for (const child of children) {
    if (child === except) continue;
    into.push({ child, wasVisible: child.visible });
    child.visible = false;
  }
  return into;
}

/** Restore exactly the visibilities {@link stashHidden} changed. */
export function restoreStash(stash: readonly StashedVisibility[]): void {
  for (const { child, wasVisible } of stash) child.visible = wasVisible;
}

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
   *  {@link endSolo} restores exactly what {@link beginSolo} changed. Retained across frames — this is the
   *  per-frame path. */
  private readonly solo: StashedVisibility[] = [];

  /** @param spriteLayer the pool's shared, depth-sorted entity layer — the children {@link beginSolo} blanks. */
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

  /** Reveal the portrait subject that is force-hidden on the main map (if any), so the portrait's second
   *  render of the world can draw its cutout. Paired with {@link hide}, which the caller runs right after
   *  that render so the subject stays hidden on the main stage. No-op when the subject is drawn normally
   *  or no portrait is open. */
  show(): void {
    if (this.hidden !== null) this.hidden.container.visible = true;
  }

  /** Re-hide the portrait subject after its cutout render (see {@link show}). */
  hide(): void {
    if (this.hidden !== null) this.hidden.container.visible = false;
  }

  /** The pooled container of the force-hidden portrait subject (if any) — the portrait reads it to keep
   *  its parent sprite layer visible while blanking the rest of the world for an indoor solo render. */
  container(): Container | null {
    return this.hidden?.container ?? null;
  }

  /** Whether the force-hidden portrait subject is inside a building, so its cutout should drop the world
   *  backdrop (a frozen settler standing on its own, not on top of the building). */
  isIndoor(): boolean {
    return this.indoor;
  }

  /** Hide every sprite-layer child except the portrait subject, so its second render draws the subject
   *  alone (no other units, no map objects behind it). {@link endSolo} restores them. Paired only with an
   *  indoor portrait render; the world's other layers (terrain, fog…) are blanked by the caller. */
  beginSolo(): void {
    const subject = this.hidden?.container;
    if (subject === undefined) {
      this.solo.length = 0; // start clean, so a skipped endSolo can't corrupt the restore
      return;
    }
    stashHidden(this.spriteLayer.children, subject, this.solo);
  }

  /** Restore the sprite-layer children {@link beginSolo} hid for the indoor portrait render. */
  endSolo(): void {
    restoreStash(this.solo);
    this.solo.length = 0;
  }
}
