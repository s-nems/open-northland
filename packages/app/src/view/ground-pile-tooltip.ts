import type { Camera, WorldRenderer } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { isHitTarget, type Pickable, pickTopAt, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';

/**
 * Cursor tooltip naming the loose good pile under the pointer. Hit targets are filtered from the
 * renderer's already-culled `drawnItems`, so the work follows the screen, not the map. Owns its own
 * tooltip element; the details panel's stock-row tooltip must not share that DOM node.
 */

export interface GroundPileTooltipOptions {
  readonly renderer: WorldRenderer;
  readonly camera: () => Camera;
  /** client (CSS) px to screen px. */
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  /** The good's localized display name. */
  readonly goodLabel: (goodType: number) => string | undefined;
  /** Cursor position in client coords, or null when the pointer left the canvas. */
  readonly pointer: () => { readonly clientX: number; readonly clientY: number } | null;
  /** Whether the world tooltip must yield the pointer this frame, because placement or HUD chrome owns it. */
  readonly suppressed: (clientX: number, clientY: number) => boolean;
}

export interface GroundPileTooltip {
  update(snapshot: WorldSnapshot): void;
}

export function createGroundPileTooltip(opts: GroundPileTooltipOptions): GroundPileTooltip {
  const tooltip = createTooltip();

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const p = opts.clientToScreen(clientX, clientY);
    return screenToWorld(opts.camera(), p.x, p.y);
  };

  // The drawn list is culled to the viewport, so the hit-target cache keys on the camera as well as
  // the tick.
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
