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

/** A pale blue, deeper than the blessing's range ring: added over green grass, a paler one reads yellow.
 *  Tuned by eye. */
const GLOW_COLOUR = 0x5aa8ff;
/** The glow's strength at the top of its breath. Tuned by eye. */
const GLOW_ALPHA = 0.9;
/** The glow's half-width as a share of the drawn temple's, so its rim shows past the walls. Tuned by eye. */
const GLOW_SPREAD = 1.6;
/** North-south over east-west radius of a patch of flat ground under the projection, as the art's
 *  platforms are drawn. Tuned by eye. */
const GROUND_SQUASH = 0.5;

/**
 * A pale-blue glow breathing on the ground round each temple the viewer sees blessing, every tribe's
 * alike, so a temple with no oil or a wound reads at a glance. Our own effect; the original shows the
 * blessing nowhere. Temples are few, so every blessing one is walked and culled each frame; their additive
 * sprites share one container, one batch break a frame.
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
      const bounds = frame.drawn.boundsOf(id);
      if (anchor === undefined || bounds === undefined) continue;
      // Centred between the feet and the platform's front edge, so most of the glow lies before the walls.
      const rx = ((bounds.maxX - bounds.minX) / 2) * GLOW_SPREAD;
      const glow = this.glowOf(id);
      glow.position.set((bounds.minX + bounds.maxX) / 2, (anchor.y + bounds.maxY) / 2);
      glow.scale.set((2 * rx) / GLOW_TEXTURE_SIZE, (2 * rx * GROUND_SQUASH) / GLOW_TEXTURE_SIZE);
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
