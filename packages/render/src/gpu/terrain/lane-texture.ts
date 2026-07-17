/**
 * CPU-side preparation of the terrain's per-cell byte lanes for their R8 GPU upload — the byte
 * bookkeeping the shaded ground mesh's lane texture needs, kept out of the shader module.
 */

/**
 * Pad a row-major per-cell byte lane so each row is a multiple of `alignment` texels, replicating the
 * last column into the padding. WebGL uploads with the default UNPACK_ALIGNMENT of 4 (Pixi never
 * lowers it), so an unpadded odd-width R8 grid would shear row by row; the replica columns keep the
 * right-edge clamp semantics identical to the CPU sampler (`data/terrain/cell-field.ts` `makeCellSampler`).
 * Pure — exported so the shear regression stays headlessly testable.
 */
export function padLaneRows(
  values: readonly number[],
  width: number,
  height: number,
  alignment: number,
): { readonly data: Uint8Array; readonly paddedWidth: number } {
  const paddedWidth = Math.ceil(width / alignment) * alignment;
  const data = new Uint8Array(paddedWidth * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < paddedWidth; c++) {
      data[r * paddedWidth + c] = values[r * width + Math.min(c, width - 1)] ?? 0;
    }
  }
  return { data, paddedWidth };
}
