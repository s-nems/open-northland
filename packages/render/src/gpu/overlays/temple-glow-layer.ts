import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Sprite, type Texture } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { blessingTemplesOf, templeGlowPulse } from '../../data/scene/temple-glow.js';
import { readPosition } from '../../data/snapshot/index.js';
import { bakeGlow, GLOW_TEXTURE_SIZE } from '../lighting/glow-texture.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

export interface TempleGlowFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  readonly viewport: Viewport;
  /** Whether the viewer sees a tile now; unset while the fog is off. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** Game seconds, so a pause holds the glow's breath. */
  readonly seconds: number;
}

/** The pale blue of the blessing's range ring. */
const GLOW_COLOUR = 0xc5edff;
/** The glow's strength at the top of its breath. Tuned by eye. */
const GLOW_ALPHA = 0.75;
/** How far the glow spreads past the building's ground ellipse, as a share of its radii. Tuned by eye. */
const GLOW_SPREAD = 1.5;
/** The ground ellipse's radii, world px, for a temple whose art gives none. */
const FALLBACK_RX = 80;
const FALLBACK_RY = 40;

/**
 * A pale-blue glow breathing on the ground round each temple the viewer sees blessing, every tribe's
 * alike, so a temple with no oil or a wound reads at a glance. Our own effect; the original shows the
 * blessing nowhere. Temples are few, so every blessing one is walked and culled each frame.
 */
export class TempleGlowLayer {
  readonly container = new Container();
  private readonly glows = new Map<number, Sprite>();
  private readonly seen = new Set<number>();
  /** Baked when the first temple blesses. */
  private texture: Texture | null = null;

  draw(frame: TempleGlowFrame): void {
    this.seen.clear();
    for (const id of blessingTemplesOf(frame.snapshot)) {
      const at = readPosition(entityById(frame.snapshot, id)?.components ?? {});
      if (at === null) continue;
      const tileX = at.x / ONE;
      const tileY = at.y / ONE;
      const feet = tileToScreen(tileX, tileY);
      if (!isVisible(frame.viewport, feet.x, feet.y) || frame.fogVisible?.(tileX, tileY) === false) continue;
      const anchor = frame.drawn.anchorOf(id);
      if (anchor === undefined) continue;
      const ellipse = frame.drawn.selectionOf?.(id);
      const glow = this.glowOf(id);
      glow.position.set(anchor.x + (ellipse?.cx ?? 0), anchor.y + (ellipse?.cy ?? 0));
      glow.scale.set(
        (2 * GLOW_SPREAD * (ellipse?.rx ?? FALLBACK_RX)) / GLOW_TEXTURE_SIZE,
        (2 * GLOW_SPREAD * (ellipse?.ry ?? FALLBACK_RY)) / GLOW_TEXTURE_SIZE,
      );
      glow.alpha = GLOW_ALPHA * templeGlowPulse(frame.seconds, id);
      this.seen.add(id);
    }
    retireUndrawn(this.glows, this.seen, (glow) => glow.destroy());
  }

  private glowOf(id: number): Sprite {
    let glow = this.glows.get(id);
    if (glow === undefined) {
      this.texture ??= bakeGlow();
      glow = new Sprite(this.texture);
      glow.anchor.set(0.5);
      glow.tint = GLOW_COLOUR;
      glow.blendMode = 'add';
      this.container.addChild(glow);
      this.glows.set(id, glow);
    }
    return glow;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.texture?.destroy(true);
  }
}
