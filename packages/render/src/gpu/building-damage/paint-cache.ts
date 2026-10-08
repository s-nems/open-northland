import { blendSurfaces, type Fracture, scarSurface } from './surface.js';

export interface DamageRaster {
  readonly pixels: Uint8ClampedArray;
  readonly backing: Uint8ClampedArray | undefined;
  readonly width: number;
  readonly height: number;
  readonly fractures: readonly Fracture[];
}

interface Endpoint {
  readonly level: number;
  readonly pixels: Uint8ClampedArray;
}

interface Pair {
  readonly lower: Endpoint;
  readonly upper: Endpoint;
  readonly bytes: number;
}

/** Immutable source rasters own their cache keys. Retain only the current pair, under a separate
 * CPU budget, so interpolating health cannot displace another building's original pixels or atlas slot. */
export class DamagePaintCache {
  private readonly pairs = new Map<DamageRaster, Pair>();
  private bytes = 0;
  readonly stats = { endpointPaints: 0, blends: 0, hits: 0, evictions: 0 };

  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}

  get retainedBytes(): number {
    return this.bytes;
  }

  /** The returned endpoint is borrowed: the atlas copies it synchronously and must not modify it. */
  paint(surface: DamageRaster, level: number): Uint8ClampedArray {
    const clamped = Number.isFinite(level) ? Math.max(0, Math.min(6, level)) : 0;
    const lowerLevel = Math.floor(clamped);
    const upperLevel = Math.ceil(clamped);
    const held = this.pairs.get(surface);
    const lower = this.endpoint(surface, lowerLevel, held);
    const upper = lowerLevel === upperLevel ? lower : this.endpoint(surface, upperLevel, held);
    this.forget(surface);
    const bytes = lower.pixels.byteLength + (upper === lower ? 0 : upper.pixels.byteLength);
    if (bytes <= this.maxBytes) {
      while (this.bytes + bytes > this.maxBytes) {
        const oldest = this.pairs.keys().next().value;
        if (oldest === undefined) break;
        this.forget(oldest);
        this.stats.evictions++;
      }
      this.pairs.set(surface, { lower, upper, bytes });
      this.bytes += bytes;
    }
    if (lower === upper) return lower.pixels;
    this.stats.blends++;
    return blendSurfaces(lower.pixels, upper.pixels, clamped - lowerLevel);
  }

  forget(surface: DamageRaster): void {
    const held = this.pairs.get(surface);
    if (held === undefined) return;
    this.bytes -= held.bytes;
    this.pairs.delete(surface);
  }

  private endpoint(surface: DamageRaster, level: number, held: Pair | undefined): Endpoint {
    const cached =
      held?.lower.level === level ? held.lower : held?.upper.level === level ? held.upper : undefined;
    if (cached !== undefined) {
      this.stats.hits++;
      return cached;
    }
    this.stats.endpointPaints++;
    return {
      level,
      pixels: scarSurface(
        surface.pixels,
        surface.width,
        surface.height,
        surface.fractures,
        level,
        surface.backing,
      ),
    };
  }
}
