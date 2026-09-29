import type { ElevationField, WaterField } from '../../data/terrain/index.js';

const BYTE_MAX = 255;
/** RG8 rows pad to WebGL's default 4-byte unpack alignment: two texels. */
const ROW_ALIGN_TEXELS = 2;

/** One byte pair per map cell: r its water surface 0..1, g its lift over the map's highest lift. */
export interface GroundMask {
  readonly data: Uint8Array;
  /** The padded texture width in texels; the map's own width is `width`. */
  readonly texWidth: number;
  readonly width: number;
  readonly height: number;
  /** World px that a full `g` byte lifts. */
  readonly maxLift: number;
}

/** The ground reactions' per-cell lookup: where water lies, and how far the ground there is raised. */
export function buildGroundMask(
  width: number,
  height: number,
  water: WaterField,
  elevation: ElevationField,
): GroundMask {
  const texWidth = Math.ceil(Math.max(1, width) / ROW_ALIGN_TEXELS) * ROW_ALIGN_TEXELS;
  const rows = Math.max(1, height);
  const data = new Uint8Array(texWidth * rows * 2);
  const maxLift = elevation.maxLift;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * texWidth + col) * 2;
      data[i] = Math.round(water.surfaceCell(col, row) * BYTE_MAX);
      data[i + 1] = maxLift > 0 ? Math.round((elevation.liftAt(col, row) / maxLift) * BYTE_MAX) : 0;
    }
  }
  return { data, texWidth, width, height, maxLift };
}
