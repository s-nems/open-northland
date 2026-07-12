import {
  buildSpriteScene,
  type Camera,
  cameraViewport,
  type ElevationField,
  SPRITE_CULL_MARGIN,
  type WorldRenderer,
} from '@vinland/render';
import type { WorldSnapshot } from '@vinland/sim';
import type { Application } from 'pixi.js';
import { type Pickable, pickTopAt, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';

/**
 * The ground-pile NAME-ON-HOVER tooltip: a cursor label naming the loose good pile (with its count) under
 * the pointer, so a dropped heap the eye can't always tell apart — one bottle from another, one ring from
 * another — reads its good + how many units. Keyed by the sim goodType the pile's `DrawItem` carries.
 *
 * Screen-bounded (golden rule 6): its hit-target set comes from `buildSpriteScene` culled to the camera
 * viewport, so it only ever considers on-screen piles, and it re-picks a cached set while the tick and
 * camera hold still. Owns its own {@link createTooltip} element (distinct from the details panel's Magazyn
 * stock-row tooltip — the two hover surfaces are mutually exclusive by cursor and must not share one DOM
 * node). The impure game-view runtime drives {@link GroundPileTooltip.update} once per frame.
 */

export interface GroundPileTooltipOptions {
  readonly app: Application;
  readonly renderer: WorldRenderer;
  readonly camera: () => Camera;
  /** client (CSS) px → screen px — the shared camera-space conversion the world pickers use. */
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  /** The map's terrain-height field, so the viewport cull margin covers a lifted hill. Optional. */
  readonly elevation?: ElevationField | undefined;
  /** Whether the viewer currently SEES a fractional tile — a fogged pile must not hit-test (its tooltip
   *  would read hidden stock through the fog). */
  readonly fogVisible: (tileX: number, tileY: number) => boolean;
  /** The good's localized display name; a `#id` fallback is used when this returns undefined. */
  readonly goodLabel: (goodType: number) => string | undefined;
  /** The current cursor position (client coords), or null when the pointer left the canvas. */
  readonly pointer: () => { readonly clientX: number; readonly clientY: number } | null;
  /**
   * Whether the world tooltip must YIELD the pointer this frame — build placement is active, or the HUD
   * (a tool-panel window, the details panel) owns the cursor. The tooltip names WORLD piles, not chrome.
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

  // Pile hit-targets, rebuilt only when the sim tick OR the camera moves. buildSpriteScene is culled to the
  // camera viewport (same margin the renderer draws with), so this is a SCREEN-bounded pass, not a whole-map
  // one — the tooltip only names piles under the cursor, which are on-screen (golden rule 6). The set is
  // camera-dependent now (culled), so the cache keys on the camera too; a still cursor over a still frame
  // re-picks the cached set. Empty flags (no dominant good) carry nothing to name and are skipped.
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
    const vp = cameraViewport(
      cam,
      opts.app.screen.width,
      opts.app.screen.height,
      SPRITE_CULL_MARGIN + (opts.elevation?.maxLift ?? 0),
    );
    // fogVisible: a fogged pile must not hit-test (its tooltip would read hidden stock through the fog).
    for (const it of buildSpriteScene(snap, {
      viewport: vp,
      elevation: opts.elevation,
      fogVisible: opts.fogVisible,
    })) {
      if (it.kind !== 'stockpile' && it.kind !== 'grounddrop') continue;
      if (it.goodType === undefined) continue; // an empty delivery flag — nothing to name
      hoverTargets.push({ ref: it.ref, x: it.x, y: it.y, box: opts.renderer.entityBounds(it.ref) });
      hoverInfo.set(it.ref, { goodType: it.goodType, amount: it.fill ?? 0 });
    }
    return hoverTargets;
  };

  return {
    update(snap: WorldSnapshot): void {
      // Suppress while placing a building and whenever the HUD owns the pointer (a tool-panel window, the
      // details panel) — the tooltip names WORLD piles, not HUD chrome.
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
