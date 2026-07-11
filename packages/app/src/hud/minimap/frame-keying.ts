/**
 * Pixel surgery for the braided frame art (`frame.ts` is the only consumer): keying the removable
 * near-black backdrop out of the baked frame and restoring its silhouette outline. Pure byte-level
 * image ops (no Pixi, no DOM — headlessly unit-tested), split from `model.ts` so the minimap's
 * layout/projection math and the frame-art processing evolve independently.
 */

/**
 * The removable-backdrop band of the GUI art (max channel below ≈28/255) — mirrors the
 * `PalettedSprite` shader's `KEY_NEAR_BLACK`, but applied by CONNECTIVITY here, not colour alone.
 */
const NEAR_BLACK_MAX = 28;

/**
 * Key out (alpha → 0) every near-black pixel CONNECTED to the image edge through other near-black or
 * transparent pixels — the frame art's backdrop treatment. The art fills both the removable outside
 * (margins around the braid + the window hole, which runs flush to two edges) and the braid's own
 * crevice shadows with the same near-black band, so a colour-only key ('full') punches see-through
 * holes in the braid; flood-filling from the edge removes exactly the outside band and keeps every
 * ENCLOSED shadow opaque. In-place over straight (non-premultiplied) RGBA.
 */
export function keyEdgeConnectedNearBlack(rgba: Uint8ClampedArray, w: number, h: number): void {
  const inBand = (i: number): boolean => {
    const o = i * 4;
    const a = rgba[o + 3] ?? 0;
    if (a < 128) return true; // already transparent — a conduit, and re-clearing it is harmless
    return Math.max(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0) < NEAR_BLACK_MAX;
  };
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number): void => {
    if (visited[i] === 0 && inBand(i)) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
    const o = i * 4;
    rgba[o] = 0;
    rgba[o + 1] = 0;
    rgba[o + 2] = 0;
    rgba[o + 3] = 0;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
}

/**
 * Draw an opaque black outline onto the TRANSPARENT side of every opaque↔transparent boundary,
 * `thickness` px deep (4-connected distance). The backdrop keying eats the art's own near-black
 * contour along with the backdrop (they touch, so connectivity can't tell them apart), leaving the
 * silhouette's last pixels frayed against the world — this restores a clean dark rim. In-place over
 * straight RGBA.
 */
export function outlineOpaqueSilhouette(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  thickness: number,
): void {
  const opaque = (i: number): boolean => (rgba[i * 4 + 3] ?? 0) >= 128;
  // Multi-source BFS: ring 1 = transparent px touching the silhouette, ring n ≤ thickness grows out.
  const ring = new Int32Array(w * h); // 0 = unvisited, n = outline ring the px joined
  let frontier: number[] = [];
  const neighbours = (i: number, visit: (j: number) => void): void => {
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  };
  for (let i = 0; i < w * h; i++) {
    if (ring[i] !== 0 || opaque(i)) continue;
    neighbours(i, (j) => {
      if (ring[i] === 0 && opaque(j)) {
        ring[i] = 1;
        frontier.push(i);
      }
    });
  }
  for (let depth = 1; depth <= thickness && frontier.length > 0; depth++) {
    for (const i of frontier) {
      const o = i * 4;
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 255;
    }
    if (depth === thickness) break;
    const next: number[] = [];
    for (const i of frontier) {
      neighbours(i, (j) => {
        if (ring[j] === 0 && !opaque(j)) {
          ring[j] = depth + 1;
          next.push(j);
        }
      });
    }
    frontier = next;
  }
}
