import type { Camera, WorldRenderer } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { isHitTarget, type Pickable, pickTopAt, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';

/**
 * The ground-pile name-on-hover tooltip: a cursor label naming the loose good pile (with its count) under
 * the pointer, so a dropped heap the eye can't always tell apart reads its good + how many units. Keyed
 * by the sim goodType the pile's `DrawItem` carries.
 *
 * Screen-bounded (golden rule 6): its hit-target set is filtered from the renderer's already-culled
 * `drawnItems` list (the frame's own scene - never a second scene build from the snapshot), and it
 * re-picks a cached set while the tick and camera hold still. Owns its own {@link createTooltip} element
 * (distinct from the details panel's Magazyn stock-row tooltip - the two hover surfaces are mutually
 * exclusive by cursor and must not share one DOM node). The impure game-view runtime drives
 * {@link GroundPileTooltip.update} once per frame, after the renderer's update drew the frame it reads.
 */

export interface GroundPileTooltipOptions {
  readonly renderer: WorldRenderer;
  readonly camera: () => Camera;
  /** client (CSS) px → screen px - the shared camera-space conversion the world pickers use. */
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  /** The good's localized display name; a `#id` fallback is used when this returns undefined. */
  readonly goodLabel: (goodType: number) => string | undefined;
  /** The current cursor position (client coords), or null when the pointer left the canvas. */
  readonly pointer: () => { readonly clientX: number; readonly clientY: number } | null;
  /**
   * Whether the world tooltip must yield the pointer this frame - build placement is active, or the HUD
   * (a tool-panel window, the details panel) owns the cursor. The tooltip names world piles, not chrome.
   */
  readonly suppressed: (clientX: number, clientY: number) => boolean;
}

export interface GroundPileTooltip {
  /** Per-frame: show/hide the tooltip for the good pile under the cursor, using this frame's snapshot. */
  update(snapshot: WorldSnapshot): void;
}

export function createGroundPileTooltip(opts: GroundPileTooltipOptions): GroundPileTooltip {
  const tooltip = createTooltip();

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const p = opts.clientToScreen(clientX, clientY);
    return screenToWorld(opts.camera(), p.x, p.y);
  };

  // Pile hit-targets, refiltered only when the sim tick or the camera moves - the drawn list is
  // camera-dependent (culled to the viewport), so the cache keys on the camera too; a still cursor
  // over a still frame re-picks the cached set. The renderer's frame cull and fog gate already
  // dropped off-screen and fogged piles, so filtering its drawn list inherits both.
  let hoverKey = '';
  let hoverTargets: Pickable[] = [];
  const hoverInfo = new Map<number, { goodType: number; amount: number }>();
  const pileTargets = (snap: WorldSnapshot): Pickable[] => {
    const cam = opts.camera();
    const key = `${snap.tick}:${cam.offsetX}:${cam.offsetY}:${cam.scale ?? 1}`;
    if (key === hoverKey) return hoverTargets;
    hoverKey = key;
    hoverTargets = [];
    hoverInfo.clear();
    for (const it of opts.renderer.drawnItems()) {
      if (it.kind !== 'stockpile' && it.kind !== 'grounddrop') continue;
      if (it.goodType === undefined) continue; // an empty delivery flag - nothing to name
      if (!isHitTarget(it)) continue;
      hoverTargets.push({ ref: it.ref, x: it.x, y: it.y, box: opts.renderer.entityBounds(it.ref) });
      hoverInfo.set(it.ref, { goodType: it.goodType, amount: it.fill ?? 0 });
    }
    return hoverTargets;
  };

  return {
    update(snap: WorldSnapshot): void {
      // Suppress while placing a building or when the HUD owns the pointer (see `suppressed`).
      const p = opts.pointer();
      if (p === null || opts.suppressed(p.clientX, p.clientY)) {
        tooltip.hide();
        return;
      }
      const w = toWorld(p.clientX, p.clientY);
      const ref = pickTopAt(pileTargets(snap), w.x, w.y);
      const info = ref === null ? undefined : hoverInfo.get(ref);
      if (info === undefined) {
        tooltip.hide();
        return;
      }
      const label = opts.goodLabel(info.goodType) ?? `#${info.goodType}`;
      tooltip.show(p.clientX, p.clientY, info.amount > 1 ? `${label} ×${info.amount}` : label);
    },
  };
}
