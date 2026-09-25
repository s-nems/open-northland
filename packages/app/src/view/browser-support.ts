/**
 * Browser capabilities the game needs, probed before the entry boots. A probe that cannot run reports
 * the capability as present, so an unreadable browser still starts the game.
 */

/**
 * Largest per-channel change a read-back pixel may show. Brave's fingerprinting protection shifts some
 * colour channels by one (observed); the worst it does is a neighbouring palette entry on a few pixels
 * of a HUD figure. Firefox `privacy.resistFingerprinting` and canvas-blocking extensions replace the
 * pixels outright.
 */
const READBACK_TOLERANCE = 1;
const PROBE_SIZE = 16;
const RGBA = 4;
const ALPHA = 3;
const CHANNEL_VALUES = 256;
const OPAQUE = CHANNEL_VALUES - 1;
/** Coprime with 256, so neighbouring probe pixels carry distinct channel values. */
const PATTERN_STEPS = [7, 13, 29] as const;

/** Brave reports the same user agent as Chrome; only this property tells it apart. */
export function isBrave(): boolean {
  return (navigator as Navigator & { brave?: unknown }).brave !== undefined;
}

/** The renderer draws only through WebGL; without it the game cannot show a frame. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return true;
  }
}

function probePattern(): ImageData {
  const image = new ImageData(PROBE_SIZE, PROBE_SIZE);
  for (let pixel = 0; pixel < PROBE_SIZE * PROBE_SIZE; pixel++) {
    const at = pixel * RGBA;
    PATTERN_STEPS.forEach((step, channel) => {
      image.data[at + channel] = (pixel * step) % CHANNEL_VALUES;
    });
    image.data[at + ALPHA] = OPAQUE;
  }
  return image;
}

export function readbackMatches(written: Uint8ClampedArray, read: Uint8ClampedArray): boolean {
  if (written.length !== read.length) return false;
  return written.every((value, i) => Math.abs(value - (read[i] ?? 0)) <= READBACK_TOLERANCE);
}

/** Decoded art is recoloured and baked through 2D canvas reads, so altered reads show as broken art. */
export function canvasReadbackIntact(): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PROBE_SIZE;
    canvas.height = PROBE_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return true;
    const written = probePattern();
    ctx.putImageData(written, 0, 0);
    return readbackMatches(written.data, ctx.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data);
  } catch {
    return true;
  }
}
